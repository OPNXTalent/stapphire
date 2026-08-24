-- Persist the editable requisition interview plan without changing existing hiring data.

create table if not exists public.phase1_interview_plans (
  id uuid primary key default extensions.uuid_generate_v4(),
  requisition_id uuid not null unique references public.phase1_requisitions(id) on delete cascade,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.phase1_interview_rounds (
  id uuid primary key default extensions.uuid_generate_v4(),
  plan_id uuid not null references public.phase1_interview_plans(id) on delete cascade,
  stage text not null check (stage in ('phone-screen', 'round-1', 'round-2', 'final')),
  title text not null check (nullif(btrim(title), '') is not null),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, stage),
  unique (plan_id, sort_order)
);

create table if not exists public.phase1_interview_questions (
  id uuid primary key default extensions.uuid_generate_v4(),
  round_id uuid not null references public.phase1_interview_rounds(id) on delete cascade,
  source_id text,
  question_text text not null check (nullif(btrim(question_text), '') is not null),
  areas text[] not null default '{}',
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(areas) <= 4),
  unique (round_id, sort_order)
);

create index if not exists phase1_interview_rounds_plan_idx
  on public.phase1_interview_rounds(plan_id, sort_order);

create index if not exists phase1_interview_questions_round_idx
  on public.phase1_interview_questions(round_id, sort_order);

alter table public.phase1_interview_plans enable row level security;
alter table public.phase1_interview_rounds enable row level security;
alter table public.phase1_interview_questions enable row level security;

revoke all on public.phase1_interview_plans from anon, authenticated;
revoke all on public.phase1_interview_rounds from anon, authenticated;
revoke all on public.phase1_interview_questions from anon, authenticated;
grant all on public.phase1_interview_plans to service_role;
grant all on public.phase1_interview_rounds to service_role;
grant all on public.phase1_interview_questions to service_role;

create or replace function public.phase1_replace_interview_plan(
  p_requisition_id uuid,
  p_rounds jsonb
)
returns table(plan_id uuid, revision integer, updated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan_id uuid;
  v_revision integer;
  v_updated_at timestamptz;
  v_round jsonb;
  v_round_id uuid;
  v_question jsonb;
  v_round_order integer := 0;
  v_question_order integer;
begin
  if p_rounds is null or jsonb_typeof(p_rounds) <> 'array' then
    raise exception 'Interview rounds must be a JSON array.';
  end if;

  if jsonb_array_length(p_rounds) > 10 then
    raise exception 'Interview plan contains too many rounds.';
  end if;

  if not exists (
    select 1 from public.phase1_requisitions where id = p_requisition_id
  ) then
    raise exception 'Requisition not found.';
  end if;

  insert into public.phase1_interview_plans (requisition_id)
  values (p_requisition_id)
  on conflict (requisition_id) do update
    set revision = public.phase1_interview_plans.revision + 1,
        updated_at = now()
  returning id, public.phase1_interview_plans.revision, public.phase1_interview_plans.updated_at
    into v_plan_id, v_revision, v_updated_at;

  delete from public.phase1_interview_rounds where plan_id = v_plan_id;

  for v_round in
    select value from jsonb_array_elements(p_rounds)
  loop
    if nullif(btrim(coalesce(v_round->>'stage', '')), '') is null then
      raise exception 'Interview round stage is required.';
    end if;
    if nullif(btrim(coalesce(v_round->>'title', '')), '') is null then
      raise exception 'Interview round title is required.';
    end if;
    if length(v_round->>'title') > 200 then
      raise exception 'Interview round title is too long.';
    end if;
    if jsonb_typeof(coalesce(v_round->'questions', '[]'::jsonb)) <> 'array' then
      raise exception 'Interview round questions must be a JSON array.';
    end if;
    if jsonb_array_length(coalesce(v_round->'questions', '[]'::jsonb)) > 100 then
      raise exception 'Interview round contains too many questions.';
    end if;

    insert into public.phase1_interview_rounds (plan_id, stage, title, sort_order)
    values (
      v_plan_id,
      v_round->>'stage',
      btrim(v_round->>'title'),
      v_round_order
    )
    returning id into v_round_id;

    v_question_order := 0;
    for v_question in
      select value from jsonb_array_elements(coalesce(v_round->'questions', '[]'::jsonb))
    loop
      if nullif(btrim(coalesce(v_question->>'text', '')), '') is null then
        raise exception 'Interview question text is required.';
      end if;
      if length(v_question->>'text') > 1000 then
        raise exception 'Interview question is too long.';
      end if;
      if jsonb_typeof(coalesce(v_question->'areas', '[]'::jsonb)) <> 'array' then
        raise exception 'Interview question areas must be a JSON array.';
      end if;
      if jsonb_array_length(coalesce(v_question->'areas', '[]'::jsonb)) > 4 then
        raise exception 'Interview question cannot have more than four Areas of Evaluation.';
      end if;

      insert into public.phase1_interview_questions (
        round_id,
        source_id,
        question_text,
        areas,
        sort_order
      )
      values (
        v_round_id,
        nullif(btrim(coalesce(v_question->>'sourceId', '')), ''),
        btrim(v_question->>'text'),
        array(
          select btrim(value)
          from jsonb_array_elements_text(coalesce(v_question->'areas', '[]'::jsonb))
          where nullif(btrim(value), '') is not null
        ),
        v_question_order
      );

      v_question_order := v_question_order + 1;
    end loop;

    v_round_order := v_round_order + 1;
  end loop;

  return query select v_plan_id, v_revision, v_updated_at;
end;
$$;

revoke execute on function public.phase1_replace_interview_plan(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.phase1_replace_interview_plan(uuid, jsonb) to service_role;
