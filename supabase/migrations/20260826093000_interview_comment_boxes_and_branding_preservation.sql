alter table public.phase1_interview_questions
  add column if not exists comment_box boolean not null default false;

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
  returning ip.id, ip.revision, ip.updated_at
    into v_plan_id, v_revision, v_updated_at;

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
    values (
      v_plan_id,
      v_round->>'stage',
      btrim(v_round->>'title'),
      v_round_order,
      coalesce(v_branding_by_stage->(v_round->>'stage'), '{}'::jsonb)
    )
    returning id into v_round_id;

    v_question_order := 0;
    for v_question in select value from jsonb_array_elements(coalesce(v_round->'questions', '[]'::jsonb)) loop
      if length(coalesce(v_question->>'text', '')) > 1000 then raise exception 'Interview question is too long.'; end if;
      if jsonb_typeof(coalesce(v_question->'areas', '[]'::jsonb)) <> 'array' then raise exception 'Interview question areas must be a JSON array.'; end if;
      if jsonb_array_length(coalesce(v_question->'areas', '[]'::jsonb)) > 4 then raise exception 'Interview question cannot have more than four Areas of Evaluation.'; end if;

      insert into public.phase1_interview_questions (round_id, source_id, question_text, areas, comment_box, sort_order)
      values (
        v_round_id,
        nullif(btrim(coalesce(v_question->>'sourceId', '')), ''),
        coalesce(v_question->>'text', ''),
        array(select btrim(value) from jsonb_array_elements_text(coalesce(v_question->'areas', '[]'::jsonb)) where nullif(btrim(value), '') is not null),
        coalesce((v_question->>'commentBox')::boolean, false),
        v_question_order
      );
      v_question_order := v_question_order + 1;
    end loop;
    v_round_order := v_round_order + 1;
  end loop;

  return query select v_plan_id, v_revision, v_updated_at;
end;
$function$;
