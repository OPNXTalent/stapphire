begin;

create table phase1_prospect_searches (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references phase1_requisitions(id) on delete cascade,
  evaluation_basis_id uuid not null references phase1_evaluation_bases(id),
  boolean_query text not null check (nullif(btrim(boolean_query), '') is not null),
  search_strategy jsonb not null check (jsonb_typeof(search_strategy) = 'object'),
  model_identifier text not null check (nullif(btrim(model_identifier), '') is not null),
  created_at timestamptz not null default now()
);

create index phase1_prospect_searches_requisition_created_idx
  on phase1_prospect_searches(requisition_id, created_at desc);

create table phase1_prospects (
  id uuid primary key default uuid_generate_v4(),
  search_id uuid not null references phase1_prospect_searches(id) on delete cascade,
  requisition_id uuid not null references phase1_requisitions(id) on delete cascade,
  evaluation_basis_id uuid not null references phase1_evaluation_bases(id),
  full_name text not null check (nullif(btrim(full_name), '') is not null),
  preliminary_score smallint not null check (preliminary_score between 0 and 100),
  sourcing_fit text not null check (sourcing_fit in ('QUALIFIED', 'POSSIBLE')),
  headline text not null default '',
  location jsonb not null check (jsonb_typeof(location) = 'object'),
  geographic_fit text not null check (geographic_fit in ('WITHIN_SCOPE', 'UNABLE_TO_DETERMINE')),
  public_evidence text not null check (nullif(btrim(public_evidence), '') is not null),
  gate_findings jsonb not null default '[]'::jsonb check (jsonb_typeof(gate_findings) = 'array'),
  criterion_signals jsonb not null default '[]'::jsonb check (jsonb_typeof(criterion_signals) = 'array'),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  evaluation_score smallint check (evaluation_score between 0 and 100),
  evaluation jsonb check (evaluation is null or jsonb_typeof(evaluation) = 'object'),
  evaluation_model_identifier text,
  evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (search_id, full_name),
  check (
    (evaluation is null and evaluation_score is null and evaluation_model_identifier is null and evaluated_at is null)
    or
    (evaluation is not null and evaluation_score is not null and nullif(btrim(evaluation_model_identifier), '') is not null and evaluated_at is not null)
  )
);

create index phase1_prospects_requisition_search_idx
  on phase1_prospects(requisition_id, search_id, preliminary_score desc);

alter table phase1_prospect_searches enable row level security;
alter table phase1_prospects enable row level security;
revoke all on table phase1_prospect_searches, phase1_prospects from public, anon, authenticated;
grant select, insert, update, delete on table phase1_prospect_searches, phase1_prospects to service_role;

create function consume_qc_and_unlock_prospect_evaluation_v1(
  p_org_id uuid,
  p_prospect_id uuid,
  p_evaluation_basis_id uuid,
  p_evaluation_score integer,
  p_evaluation jsonb,
  p_sources jsonb,
  p_model_identifier text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  selected_prospect phase1_prospects%rowtype;
  current_basis_id uuid;
  v_remaining integer;
begin
  select * into selected_prospect
  from phase1_prospects
  where id = p_prospect_id
  for update;
  if selected_prospect.id is null then raise exception 'Prospect not found.'; end if;

  if selected_prospect.evaluation is not null then
    select credits_remaining into v_remaining from organizations where id = p_org_id;
    return jsonb_build_object(
      'charged', false,
      'creditsRemaining', v_remaining,
      'prospectId', selected_prospect.id,
      'evaluationScore', selected_prospect.evaluation_score,
      'evaluation', selected_prospect.evaluation,
      'sources', selected_prospect.sources,
      'evaluatedAt', selected_prospect.evaluated_at
    );
  end if;

  select current_evaluation_basis_id into current_basis_id
  from phase1_requisitions
  where id = selected_prospect.requisition_id and archived_at is null;
  if current_basis_id is distinct from p_evaluation_basis_id
    or selected_prospect.evaluation_basis_id is distinct from p_evaluation_basis_id then
    raise exception 'STALE_EVALUATION_BASIS';
  end if;
  if p_evaluation_score < 0 or p_evaluation_score > 100
    or jsonb_typeof(p_evaluation) is distinct from 'object'
    or jsonb_typeof(p_sources) is distinct from 'array'
    or nullif(btrim(p_model_identifier), '') is null then
    raise exception 'Prospect evaluation payload is invalid.';
  end if;

  select credits_remaining into v_remaining
  from organizations
  where id = p_org_id
  for update;
  if v_remaining is null then raise exception 'Organization not found.'; end if;
  if v_remaining < 1 then raise exception 'INSUFFICIENT_QC'; end if;

  update phase1_prospects
  set evaluation_score = p_evaluation_score,
      evaluation = p_evaluation,
      sources = p_sources,
      evaluation_model_identifier = p_model_identifier,
      evaluated_at = now()
  where id = selected_prospect.id
  returning * into selected_prospect;

  update organizations
  set credits_remaining = credits_remaining - 1
  where id = p_org_id
  returning credits_remaining into v_remaining;

  insert into credit_transactions (org_id, amount, reason)
  values (p_org_id, -1, 'prospect_evaluation_unlock');

  return jsonb_build_object(
    'charged', true,
    'creditsRemaining', v_remaining,
    'prospectId', selected_prospect.id,
    'evaluationScore', selected_prospect.evaluation_score,
    'evaluation', selected_prospect.evaluation,
    'sources', selected_prospect.sources,
    'evaluatedAt', selected_prospect.evaluated_at
  );
end;
$$;

revoke all on function consume_qc_and_unlock_prospect_evaluation_v1(uuid, uuid, uuid, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function consume_qc_and_unlock_prospect_evaluation_v1(uuid, uuid, uuid, integer, jsonb, jsonb, text) to service_role;

notify pgrst, 'reload schema';
commit;
