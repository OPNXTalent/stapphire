-- Persist Question Type (and, for Phone Screen, its response
-- specification / qualification metadata) alongside each interview
-- question, so a question's real category and response package survive
-- reload instead of falling back to "Custom"/"General" once its
-- sourceId no longer resolves against the static canonical bank (this
-- is exactly what happens to an AI-generated question today). Additive
-- and backward compatible: every new column is nullable, and
-- phase1_replace_interview_plan below defaults them to null for any
-- caller that omits them - no existing row or caller is affected.

alter table public.phase1_interview_questions
  add column if not exists question_type text,
  add column if not exists response_kind text,
  add column if not exists response_options text[],
  add column if not exists response_unit text,
  add column if not exists response_qualifying text[];

-- The transient AI-generation ledger (created outside this repo's
-- migration history, so its full definition is not visible here) gets
-- the same additive, nullable columns plus a stage discriminator, so a
-- generated question still sitting unused in the Question Bank keeps
-- its real category, stage, and Phone Screen response shape across a
-- reload. These are populated by application code via a follow-up
-- update after consume_qc_and_add_interview_questions inserts each row
-- (that RPC's own definition lives outside this repo and is not
-- modified here - only additive columns are touched).
alter table public.phase1_interview_question_bank
  add column if not exists question_type text,
  add column if not exists stage text,
  add column if not exists response_kind text,
  add column if not exists response_options text[],
  add column if not exists response_unit text,
  add column if not exists response_qualifying text[];

-- phase1_replace_interview_plan, reproduced from its prior definition
-- (20260826143000_interview_yes_no_responses.sql) with question_type
-- and the Phone Screen response-package columns added to the insert.
-- Every added field is read with a null-safe default, so a payload from
-- a not-yet-updated client (no questionType/responseKind sent) behaves
-- exactly as before.
create or replace function public.phase1_replace_interview_plan(p_requisition_id uuid, p_rounds jsonb)
returns table(plan_id uuid, revision integer, updated_at timestamptz)
language plpgsql
set search_path to ''
as $function$
declare
  v_plan_id uuid;
  v_revision integer;
  v_updated_at timestamptz;
  v_round jsonb;
  v_round_id uuid;
  v_question jsonb;
  v_round_order integer := 0;
  v_question_order integer;
  v_branding_by_stage jsonb := '{}'::jsonb;
begin
  if p_rounds is null or jsonb_typeof(p_rounds) <> 'array' then raise exception 'Interview rounds must be a JSON array.'; end if;
  if jsonb_array_length(p_rounds) > 10 then raise exception 'Interview plan contains too many rounds.'; end if;
  if not exists (select 1 from public.phase1_requisitions pr where pr.id = p_requisition_id) then raise exception 'Requisition not found.'; end if;

  insert into public.phase1_interview_plans as ip (requisition_id)
  values (p_requisition_id)
  on conflict (requisition_id) do update
    set revision = ip.revision + 1,
        updated_at = now()
  returning ip.id, ip.revision, ip.updated_at into v_plan_id, v_revision, v_updated_at;

  select coalesce(jsonb_object_agg(ir.stage, ir.branding), '{}'::jsonb)
    into v_branding_by_stage
    from public.phase1_interview_rounds ir
   where ir.plan_id = v_plan_id;

  delete from public.phase1_interview_rounds ir where ir.plan_id = v_plan_id;

  for v_round in select value from jsonb_array_elements(p_rounds) loop
    if nullif(btrim(coalesce(v_round->>'stage', '')), '') is null then raise exception 'Interview round stage is required.'; end if;
    if nullif(btrim(coalesce(v_round->>'title', '')), '') is null then raise exception 'Interview round title is required.'; end if;
    if length(v_round->>'title') > 200 then raise exception 'Interview round title is too long.'; end if;
    if jsonb_typeof(coalesce(v_round->'questions', '[]'::jsonb)) <> 'array' then raise exception 'Interview round questions must be a JSON array.'; end if;
    if jsonb_array_length(coalesce(v_round->'questions', '[]'::jsonb)) > 100 then raise exception 'Interview round contains too many questions.'; end if;

    insert into public.phase1_interview_rounds (plan_id, stage, title, sort_order, branding)
    values (v_plan_id, v_round->>'stage', btrim(v_round->>'title'), v_round_order, coalesce(v_branding_by_stage->(v_round->>'stage'), '{}'::jsonb))
    returning id into v_round_id;

    v_question_order := 0;
    for v_question in select value from jsonb_array_elements(coalesce(v_round->'questions', '[]'::jsonb)) loop
      if length(coalesce(v_question->>'text', '')) > 1000 then raise exception 'Interview question is too long.'; end if;
      if jsonb_typeof(coalesce(v_question->'areas', '[]'::jsonb)) <> 'array' then raise exception 'Interview question areas must be a JSON array.'; end if;
      if jsonb_array_length(coalesce(v_question->'areas', '[]'::jsonb)) > 4 then raise exception 'Interview question cannot have more than four Areas of Evaluation.'; end if;
      if length(coalesce(v_question->>'questionType', '')) > 60 then raise exception 'Interview question Question Type is too long.'; end if;
      if length(coalesce(v_question->>'responseUnit', '')) > 30 then raise exception 'Interview question response unit is too long.'; end if;

      insert into public.phase1_interview_questions (
        round_id, source_id, question_text, areas, comment_box, yes_no, sort_order,
        question_type, response_kind, response_options, response_unit, response_qualifying
      )
      values (
        v_round_id,
        nullif(btrim(coalesce(v_question->>'sourceId', '')), ''),
        coalesce(v_question->>'text', ''),
        array(select btrim(value) from jsonb_array_elements_text(coalesce(v_question->'areas', '[]'::jsonb)) where nullif(btrim(value), '') is not null),
        coalesce((v_question->>'commentBox')::boolean, false),
        coalesce((v_question->>'yesNo')::boolean, false),
        v_question_order,
        nullif(btrim(coalesce(v_question->>'questionType', '')), ''),
        nullif(btrim(coalesce(v_question->>'responseKind', '')), ''),
        case when jsonb_typeof(v_question->'responseOptions') = 'array'
          then array(select btrim(value) from jsonb_array_elements_text(v_question->'responseOptions') where nullif(btrim(value), '') is not null)
          else null end,
        nullif(btrim(coalesce(v_question->>'responseUnit', '')), ''),
        case when jsonb_typeof(v_question->'responseQualifying') = 'array'
          then array(select btrim(value) from jsonb_array_elements_text(v_question->'responseQualifying') where nullif(btrim(value), '') is not null)
          else null end
      );
      v_question_order := v_question_order + 1;
    end loop;
    v_round_order := v_round_order + 1;
  end loop;

  return query select v_plan_id, v_revision, v_updated_at;
end;
$function$;

revoke execute on function public.phase1_replace_interview_plan(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.phase1_replace_interview_plan(uuid, jsonb) to service_role;
