-- Closes the one remaining gap disclosed in 20260829010000: Phone
-- Screen generation's hand-written credit deduction did not write a
-- credit_transactions ledger row, because that table's exact schema
-- was described narratively at the time, not handed over as DDL.
--
-- Verified live schema (obtained via a read-only connection to the
-- production project - not reproduced from guesswork):
--
--   public.credit_transactions:
--     id uuid not null default uuid_generate_v4(), org_id uuid not
--     null references organizations(id) on delete cascade, amount
--     integer not null, reason text not null, candidate_id uuid null
--     references candidates(id) on delete set null, stripe_event_id
--     text null, created_at timestamptz not null default now().
--     Primary key (id).
--
--   The original RPC writes its ledger entry exactly as:
--     insert into public.credit_transactions (org_id, amount, reason)
--     values (p_org_id, -1, 'interview_question_generation');
--   No candidate_id or stripe_event_id is required for this operation.
--
-- This migration is additive on top of 20260829010000, which is left
-- unmodified - it replaces consume_qc_and_add_interview_questions
-- again (same exact signature/return type/security/volatility/
-- search_path/owner/grants) so the fresh, non-replay Phone Screen
-- branch inserts this same ledger row, in the same transaction as its
-- question inserts and credit deduction, immediately before building
-- its response. Every other branch (the idempotent-replay short
-- circuit, the partial-batch rejection, and the Structured Interview/
-- legacy path that calls the preserved, still-unmodified
-- _consume_qc_and_add_interview_questions_v1) is unchanged from
-- 20260829010000 - Structured Interview's ledger row still comes only
-- from that preserved original function, never a second one added
-- here, and a replay or partial-batch rejection still returns/raises
-- before any credit or ledger mutation, exactly as before.
create or replace function public.consume_qc_and_add_interview_questions(
  p_org_id uuid,
  p_requisition_id uuid,
  p_questions jsonb
)
returns jsonb
language plpgsql
security invoker
volatile
set search_path to public
as $function$
declare
  v_question jsonb;
  v_request_ids text[];
  v_request_id uuid;
  v_stages text[];
  v_stage text;
  v_existing_count integer;
  v_credits integer;
  v_result jsonb;
  v_row_count integer;
  v_inserted_count integer := 0;
begin
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) <> 5 then
    raise exception 'p_questions must be a JSON array of exactly five questions';
  end if;

  -- A batch is entirely one generation request (or entirely legacy
  -- callers with no request id at all) - never a mix, since a mixed
  -- batch has no single request identity to serialize or replay.
  select array_agg(distinct nullif(btrim(coalesce(value->>'requestId', '')), ''))
    into v_request_ids
    from jsonb_array_elements(p_questions) as value;
  if array_length(v_request_ids, 1) > 1 then
    raise exception 'All questions in a batch must share the same generation request identifier';
  end if;
  v_request_id := case when v_request_ids[1] is not null then v_request_ids[1]::uuid else null end;

  -- Likewise, a batch is entirely one stage.
  select array_agg(distinct nullif(btrim(coalesce(value->>'stage', '')), ''))
    into v_stages
    from jsonb_array_elements(p_questions) as value;
  if array_length(v_stages, 1) > 1 then
    raise exception 'All questions in a batch must share the same stage';
  end if;
  v_stage := v_stages[1];

  if v_request_id is not null then
    -- Transaction-scoped: released automatically at commit or
    -- rollback. Serializes only concurrent attempts sharing this exact
    -- request id - a second, unrelated generation is never blocked by
    -- it, and a rolled-back attempt releases it immediately, leaving
    -- nothing behind for the next attempt to see.
    perform pg_advisory_xact_lock(hashtext(v_request_id::text)::bigint);

    select count(*) into v_existing_count
    from public.phase1_interview_question_bank
    where generation_request_id = v_request_id
      and requisition_id = p_requisition_id;

    if v_existing_count = 5 then
      -- A confirmed-successful retry: return exactly what was already
      -- persisted and the current balance, without touching credits or
      -- writing a second ledger row. This branch runs, and returns,
      -- before either the Phone Screen or Structured path below ever
      -- reaches a credit or ledger statement.
      select jsonb_build_object(
        'creditsRemaining', (select credits_remaining from public.organizations where id = p_org_id),
        'questions', coalesce(jsonb_agg(jsonb_build_object(
          'id', question_key,
          'text', question_text,
          'areas', to_jsonb(areas),
          'stage', stage,
          'questionType', question_type,
          'responseKind', response_kind,
          'responseOptions', to_jsonb(response_options),
          'responseUnit', response_unit,
          'responseQualifying', to_jsonb(response_qualifying),
          'requestId', generation_request_id
        ) order by question_key), '[]'::jsonb)
      )
      into v_result
      from public.phase1_interview_question_bank
      where generation_request_id = v_request_id
        and requisition_id = p_requisition_id;
      return v_result;
    elsif v_existing_count between 1 and 4 then
      -- Should not be reachable under normal operation - the insert
      -- below is one all-or-nothing transaction - but a corrupted or
      -- pre-existing partial state must never be charged or built on.
      raise exception 'A partial batch already exists for generation request %, refusing to charge or insert an inconsistent batch', v_request_id;
    end if;
  end if;

  if not exists (select 1 from public.phase1_requisitions where id = p_requisition_id and archived_at is null) then
    raise exception 'Requisition not found or archived';
  end if;

  if v_stage = 'phone-screen' then
    select credits_remaining into v_credits
      from public.organizations
     where id = p_org_id
       for update;
    if not found then
      raise exception 'Organization not found';
    end if;
    if v_credits < 1 then
      raise exception 'INSUFFICIENT_QC';
    end if;

    for v_question in select value from jsonb_array_elements(p_questions) as value loop
      if cardinality(array(select jsonb_array_elements_text(coalesce(v_question->'areas', '[]'::jsonb)))) <> 0 then
        raise exception 'Phone Screen questions must not carry Areas of Evaluation';
      end if;

      insert into public.phase1_interview_question_bank (
        requisition_id, question_key, question_text, areas, stage,
        question_type, response_kind, response_options, response_unit, response_qualifying,
        generation_request_id
      )
      values (
        p_requisition_id,
        v_question->>'id',
        btrim(v_question->>'text'),
        '{}'::text[],
        'phone-screen',
        nullif(btrim(coalesce(v_question->>'questionType', '')), ''),
        nullif(btrim(coalesce(v_question->>'responseKind', '')), ''),
        case when jsonb_typeof(v_question->'responseOptions') = 'array'
          then array(select btrim(x) from jsonb_array_elements_text(v_question->'responseOptions') x where nullif(btrim(x), '') is not null)
          else null end,
        nullif(btrim(coalesce(v_question->>'responseUnit', '')), ''),
        case when jsonb_typeof(v_question->'responseQualifying') = 'array'
          then array(select btrim(x) from jsonb_array_elements_text(v_question->'responseQualifying') x where nullif(btrim(x), '') is not null)
          else null end,
        v_request_id
      );
      v_inserted_count := v_inserted_count + 1;
    end loop;

    if v_inserted_count <> 5 then
      raise exception 'Expected exactly five inserted Phone Screen questions, got %', v_inserted_count;
    end if;

    update public.organizations set credits_remaining = credits_remaining - 1 where id = p_org_id;

    -- The one piece this migration adds: the same ledger entry the
    -- original (preserved) RPC writes for Structured Interview
    -- generation, now also written for a fresh Phone Screen batch, in
    -- this same transaction. Any failure here - a constraint violation,
    -- a dropped connection - rolls back the five inserts and the
    -- credit deduction above it too, since nothing has committed yet.
    insert into public.credit_transactions (org_id, amount, reason)
    values (p_org_id, -1, 'interview_question_generation');

    select jsonb_build_object(
      'creditsRemaining', (select credits_remaining from public.organizations where id = p_org_id),
      'questions', jsonb_agg(jsonb_build_object(
        'id', question_key,
        'text', question_text,
        'areas', to_jsonb(areas),
        'stage', stage,
        'questionType', question_type,
        'responseKind', response_kind,
        'responseOptions', to_jsonb(response_options),
        'responseUnit', response_unit,
        'responseQualifying', to_jsonb(response_qualifying),
        'requestId', generation_request_id
      ) order by question_key)
    )
    into v_result
    from public.phase1_interview_question_bank
    where requisition_id = p_requisition_id
      and question_key in (select value->>'id' from jsonb_array_elements(p_questions) as value);

    return v_result;
  end if;

  -- Structured Interview (or a legacy caller with no stage at all):
  -- the original, unmodified function still does the real work,
  -- including its own credit_transactions insert - never duplicated
  -- here.
  select public._consume_qc_and_add_interview_questions_v1(p_org_id, p_requisition_id, p_questions) into v_result;

  -- Backfill Question Type/response metadata onto the rows it just
  -- inserted, in the SAME transaction: any failure here - including a
  -- row not matching exactly once - rolls back that insert, its credit
  -- deduction, and its credit transaction too, since a nested plpgsql
  -- call shares its caller's transaction rather than committing
  -- independently.
  for v_question in select value from jsonb_array_elements(p_questions) as value loop
    update public.phase1_interview_question_bank
       set stage = nullif(btrim(coalesce(v_question->>'stage', '')), ''),
           question_type = nullif(btrim(coalesce(v_question->>'questionType', '')), ''),
           response_kind = nullif(btrim(coalesce(v_question->>'responseKind', '')), ''),
           response_options = case when jsonb_typeof(v_question->'responseOptions') = 'array'
             then array(select btrim(x) from jsonb_array_elements_text(v_question->'responseOptions') x where nullif(btrim(x), '') is not null)
             else null end,
           response_unit = nullif(btrim(coalesce(v_question->>'responseUnit', '')), ''),
           response_qualifying = case when jsonb_typeof(v_question->'responseQualifying') = 'array'
             then array(select btrim(x) from jsonb_array_elements_text(v_question->'responseQualifying') x where nullif(btrim(x), '') is not null)
             else null end,
           generation_request_id = v_request_id
     where requisition_id = p_requisition_id
       and question_key = v_question->>'id';
    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then
      raise exception 'Metadata backfill did not match exactly one row for question_key %', v_question->>'id';
    end if;
  end loop;

  -- Re-read the enriched rows so the response reflects the metadata
  -- just written, not the original function's bare {id,text,areas}.
  select jsonb_build_object(
    'creditsRemaining', v_result->'creditsRemaining',
    'questions', jsonb_agg(jsonb_build_object(
      'id', question_key,
      'text', question_text,
      'areas', to_jsonb(areas),
      'stage', stage,
      'questionType', question_type,
      'responseKind', response_kind,
      'responseOptions', to_jsonb(response_options),
      'responseUnit', response_unit,
      'responseQualifying', to_jsonb(response_qualifying),
      'requestId', generation_request_id
    ))
  )
  into v_result
  from public.phase1_interview_question_bank
  where requisition_id = p_requisition_id
    and question_key in (select value->>'id' from jsonb_array_elements(p_questions) as value);

  return v_result;
end;
$function$;

alter function public.consume_qc_and_add_interview_questions(uuid, uuid, jsonb) owner to postgres;
revoke all on function public.consume_qc_and_add_interview_questions(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.consume_qc_and_add_interview_questions(uuid, uuid, jsonb) to postgres, service_role;
