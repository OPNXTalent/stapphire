-- Makes generated-question persistence (QC deduction + question insert
-- + Question Type/response metadata) one atomic database transaction
-- instead of the separate application-level metadata UPDATE added in
-- 20260828120000, fixes the Phone Screen Areas-of-Evaluation
-- constraint (which currently rejects every Phone Screen generation
-- outright - the bank's areas check requires 1-4 elements
-- unconditionally, and Phone Screen questions have none by design),
-- and adds a database-enforced idempotency mechanism for the
-- generation request itself, so an uncertain network failure can be
-- retried without risking a duplicate QC charge or a duplicate batch.
--
-- Verified live definitions this migration builds on (obtained via a
-- read-only connection to the production project - not reproduced
-- from guesswork):
--
--   consume_qc_and_add_interview_questions(p_org_id uuid, p_requisition_id uuid, p_questions jsonb) returns jsonb
--     language plpgsql, security invoker, volatile, search_path=public,
--     owner postgres, execute granted to postgres/service_role only.
--     Behavior: validates p_questions is a 5-element JSON array;
--     confirms the requisition exists and is not archived; locks the
--     organization's credit row FOR UPDATE; confirms at least one
--     credit remains; inserts five rows into
--     phase1_interview_question_bank (question_key = q->>'id',
--     question_text = btrim(q->>'text'), areas from
--     jsonb_array_elements_text(q->'areas')); requires exactly five
--     rows inserted; deducts one credit; inserts a credit transaction
--     record; returns {creditsRemaining, questions:[{id,text,areas}]}.
--
--   phase1_interview_question_bank: id uuid pk default gen_random_uuid(),
--     requisition_id uuid not null fk -> phase1_requisitions(id) on
--     delete cascade, question_key text not null UNIQUE (globally),
--     question_text text not null (1-1000 trimmed chars), areas text[]
--     not null default '{}' (currently checked to have 1-4 elements
--     unconditionally), created_at timestamptz not null default now().
--     RLS enabled, no row policies, service_role has full table
--     privileges. question_key's uniqueness and its equality to the
--     id this route sends the RPC are both now confirmed, not
--     inferred - the follow-up UPDATE approach from 20260828120000
--     was safe on that specific point; its actual defect (see
--     lib/questionCustomization's sibling round) was that it was a
--     second, non-transactional statement, not that question_key was
--     unreliable.
--
-- What is NOT reproduced here, and why: the exact schema of whatever
-- table RPC step "insert the credit transaction" writes to was
-- described narratively when this was verified, not handed over as
-- DDL - no table name, no columns. Fabricating it here would risk
-- shipping a function that only fails on its first real invocation
-- (a plpgsql body is not checked against the catalog at CREATE time),
-- against a real credit-accounting table, which is a worse failure
-- mode than leaving a narrow, disclosed gap. Rather than guess it,
-- this migration preserves that exact, unmodified logic by renaming
-- the existing function to an internal name and calling it, verbatim,
-- as a nested statement for every case that can still use it: any
-- batch whose areas satisfy the ORIGINAL unconditional 1-4 check, i.e.
-- every Structured Interview generation - all pre-existing traffic,
-- unregressed. Phone Screen generation (0 areas) cannot use that
-- insert at all regardless of this migration, because Postgres CHECK
-- constraints are not deferrable: the row's stage must be present in
-- the very same INSERT statement the new stage-aware constraint below
-- validates, and the original insert has no notion of stage. Phone
-- Screen's credit deduction is therefore implemented directly here,
-- against only the two organizations columns already read elsewhere
-- in this codebase (id, credits_remaining) - it does not write a
-- credit transaction record. This is a narrower, disclosed gap than
-- the one this migration closes: Phone Screen QC is still deducted
-- exactly once, atomically with its questions and metadata, rolls
-- back completely on any failure, and is never double-deducted on
-- retry (see the idempotency mechanism below) - it is just not yet
-- recorded in whatever ledger table the original function's step 8
-- writes to. Closing that specific remaining gap requires that
-- table's exact schema.
--
-- This migration must still be verified transactionally against the
-- connected database before rollout - see the accompanying report for
-- the exact verification steps. No live database connection was
-- available while writing it.

alter table public.phase1_interview_question_bank
  add column if not exists generation_request_id uuid;

create index if not exists phase1_interview_question_bank_generation_request_idx
  on public.phase1_interview_question_bank (generation_request_id)
  where generation_request_id is not null;

-- Replace the unconditional "1 to 4 areas" check with a stage-aware
-- one: Phone Screen has no Areas of Evaluation by design (zero is the
-- only valid count for it); every other stage - including legacy rows
-- with a null stage, predating the stage column entirely - keeps the
-- original 1-4 range. No fake Phone Screen AOE value is ever inserted
-- to satisfy this constraint; the constraint itself now understands
-- Phone Screen has none.
--
-- The constraint's live name isn't recorded anywhere in this repo
-- (the table itself predates any in-repo migration - see
-- 20260828120000), so it is located by its actual definition and
-- dropped by that discovered name, rather than a guessed one. This
-- also makes the block safe to run again: on a second run it simply
-- finds and replaces this same migration's own constraint.
do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.phase1_interview_question_bank'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%cardinality(areas)%';
  if v_conname is not null then
    execute format('alter table public.phase1_interview_question_bank drop constraint %I', v_conname);
  end if;
end
$$;

alter table public.phase1_interview_question_bank
  add constraint phase1_interview_question_bank_areas_check
  check (
    case
      when stage = 'phone-screen' then cardinality(areas) = 0
      else cardinality(areas) between 1 and 4
    end
  );

-- Preserve the existing, verified-correct requisition/credit/ledger
-- logic byte-for-byte by relocating it under an internal name. Rename
-- changes nothing about the function's body, ownership, or grants -
-- only future callers of the public name are affected, and the new
-- public function below is the only caller that remains, calling it
-- unmodified for every case it still supports (see the header comment
-- above).
alter function public.consume_qc_and_add_interview_questions(uuid, uuid, jsonb)
  rename to _consume_qc_and_add_interview_questions_v1;

-- The new public entry point. Same exact signature and return type as
-- before; every metadata field is optional and null-safe, so a legacy
-- caller sending only {id,text,areas} behaves exactly as it did before
-- this migration - same validation, same credit handling, same
-- returned shape (with extra, additive keys on each question that a
-- caller reading only id/text/areas will simply never look at).
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
      -- persisted and the current balance, without touching credits.
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
  -- the original, unmodified function still does the real work - its
  -- own requisition/credit/ledger logic is never reconstructed here.
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
