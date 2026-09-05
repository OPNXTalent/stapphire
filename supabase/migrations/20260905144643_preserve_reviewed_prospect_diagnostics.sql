begin;

alter table phase1_prospects
  add column if not exists screening_status text not null default 'CLEARED'
    check (screening_status in ('CLEARED', 'NOT_CLEARED')),
  add column if not exists screening_disposition text;

alter table phase1_prospects
  drop constraint if exists phase1_prospects_geographic_fit_check;

alter table phase1_prospects
  add constraint phase1_prospects_geographic_fit_check
    check (geographic_fit in ('WITHIN_SCOPE', 'OUTSIDE_SCOPE', 'UNABLE_TO_DETERMINE'));

create or replace function consume_qc_and_unlock_prospect_evaluation_v1(
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
  if v_remaining < 2 then raise exception 'INSUFFICIENT_QC'; end if;

  update phase1_prospects
  set evaluation_score = p_evaluation_score,
      evaluation = p_evaluation,
      sources = p_sources,
      evaluation_model_identifier = p_model_identifier,
      evaluated_at = now()
  where id = selected_prospect.id
  returning * into selected_prospect;

  update organizations
  set credits_remaining = credits_remaining - 2
  where id = p_org_id
  returning credits_remaining into v_remaining;

  insert into credit_transactions (org_id, amount, reason)
  values (p_org_id, -2, 'prospect_evaluation_unlock');

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
