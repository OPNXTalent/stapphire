begin;

alter table phase1_evaluations alter column job_responsibilities_score drop not null;
alter table phase1_evaluations alter column hard_skills_score drop not null;
alter table phase1_evaluations alter column soft_skills_score drop not null;
alter table phase1_evaluations alter column keyword_terminology_score drop not null;

create or replace function prevent_phase1_hiring_criteria_version_update()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Hiring Criteria versions are immutable.';
end;
$$;
drop trigger if exists phase1_hiring_criteria_versions_immutable on phase1_hiring_criteria_versions;
create trigger phase1_hiring_criteria_versions_immutable
before update on phase1_hiring_criteria_versions
for each row execute function prevent_phase1_hiring_criteria_version_update();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'phase1_hiring_criteria_versions_id_requisition_key') then
    alter table phase1_hiring_criteria_versions add constraint phase1_hiring_criteria_versions_id_requisition_key unique (id, requisition_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase1_evaluation_bases_hiring_criteria_requisition_fk') then
    alter table phase1_evaluation_bases add constraint phase1_evaluation_bases_hiring_criteria_requisition_fk
      foreign key (hiring_criteria_version_id, requisition_id)
      references phase1_hiring_criteria_versions(id, requisition_id);
  end if;
end $$;

drop function if exists apply_phase1_hiring_criteria(uuid);

create function apply_phase1_hiring_criteria(p_requisition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_requisition phase1_requisitions%rowtype;
  selected_model_id uuid;
  criterion_count integer;
  draft_total integer;
  next_version integer;
  snapshot jsonb;
  totals jsonb;
  applied_version_id uuid;
  evaluation_basis_id uuid;
  source_hash text;
begin
  perform pg_advisory_xact_lock(hashtext(p_requisition_id::text));

  select * into current_requisition
  from phase1_requisitions
  where id = p_requisition_id and archived_at is null
  for update;
  if current_requisition.id is null then raise exception 'Active requisition not found.'; end if;

  select id into selected_model_id
  from phase1_hiring_criteria_models
  where requisition_id = p_requisition_id and extraction_status = 'ready'
  for update;
  if selected_model_id is null then raise exception 'No ready Hiring Criteria model exists.'; end if;

  select count(*), coalesce(sum(draft_weight), 0)
  into criterion_count, draft_total
  from phase1_hiring_criteria_items
  where model_id = selected_model_id and not is_knockout;
  if criterion_count = 0 then raise exception 'Hiring Criteria model has no weighted criteria.'; end if;
  if draft_total <> 100 then raise exception 'Total Hiring Criteria weight must equal 100%%.'; end if;
  if exists (select 1 from phase1_hiring_criteria_items where model_id = selected_model_id and is_knockout and draft_weight <> 0) then
    raise exception 'Knockout criteria cannot carry weight.';
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from phase1_hiring_criteria_versions where requisition_id = p_requisition_id;

  select jsonb_agg(jsonb_build_object(
    'id', id, 'category', category, 'label', label, 'rationale', rationale,
    'jdEvidence', jd_evidence, 'defaultWeight', default_weight,
    'appliedWeight', draft_weight, 'isKnockout', is_knockout,
    'knockoutSuggested', knockout_suggested
  ) order by category, created_at, id)
  into snapshot
  from phase1_hiring_criteria_items where model_id = selected_model_id;
  if snapshot is null then raise exception 'Hiring Criteria snapshot is empty.'; end if;

  select jsonb_object_agg(category, category_total) into totals
  from (
    select category, sum(draft_weight) as category_total
    from phase1_hiring_criteria_items
    where model_id = selected_model_id and not is_knockout
    group by category
  ) rollups;

  insert into phase1_hiring_criteria_versions (
    requisition_id, model_id, version_number, criteria_snapshot, category_totals, total_weight
  ) values (p_requisition_id, selected_model_id, next_version, snapshot, coalesce(totals, '{}'::jsonb), draft_total)
  returning id into applied_version_id;

  source_hash := encode(digest(btrim(replace(replace(current_requisition.job_description, E'\r\n', E'\n'), E'\r', E'\n')), 'sha256'), 'hex');
  insert into phase1_evaluation_bases (
    requisition_id, basis_type, job_description_snapshot, job_description_hash,
    job_description_updated_at, hiring_criteria_version_id
  ) values (
    p_requisition_id, 'hiring_criteria', current_requisition.job_description, source_hash,
    current_requisition.job_description_updated_at, applied_version_id
  ) returning id into evaluation_basis_id;

  update phase1_requisitions
  set current_evaluation_basis_id = evaluation_basis_id, updated_at = now()
  where id = p_requisition_id;

  return jsonb_build_object('versionId', applied_version_id, 'basisId', evaluation_basis_id);
end;
$$;

revoke all on function apply_phase1_hiring_criteria(uuid) from public, anon, authenticated;
grant execute on function apply_phase1_hiring_criteria(uuid) to service_role;

create index if not exists phase1_evaluation_bases_hiring_criteria_version_idx
  on phase1_evaluation_bases(hiring_criteria_version_id)
  where hiring_criteria_version_id is not null;

notify pgrst, 'reload schema';
commit;
