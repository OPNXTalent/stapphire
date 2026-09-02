begin;

with latest_applied as (
  select distinct on (version.requisition_id)
    version.requisition_id,
    version.id as hiring_criteria_version_id
  from phase1_hiring_criteria_versions version
  where version.applied_at is not null
    and version.total_weight = 100
  order by version.requisition_id, version.version_number desc
)
insert into phase1_evaluation_bases (
  requisition_id,
  basis_type,
  job_description_snapshot,
  job_description_hash,
  job_description_updated_at,
  hiring_criteria_version_id
)
select
  requisition.id,
  'hiring_criteria',
  requisition.job_description,
  lower(encode(extensions.digest(
    convert_to(btrim(replace(replace(requisition.job_description, E'\r\n', E'\n'), E'\r', E'\n')), 'UTF8'),
    'sha256'
  ), 'hex')),
  coalesce(requisition.job_description_updated_at, requisition.updated_at, requisition.created_at),
  latest_applied.hiring_criteria_version_id
from latest_applied
join phase1_requisitions requisition on requisition.id = latest_applied.requisition_id
where not exists (
  select 1
  from phase1_evaluation_bases basis
  where basis.requisition_id = latest_applied.requisition_id
    and basis.hiring_criteria_version_id = latest_applied.hiring_criteria_version_id
);

with latest_applied as (
  select distinct on (version.requisition_id)
    version.requisition_id,
    version.id as hiring_criteria_version_id
  from phase1_hiring_criteria_versions version
  where version.applied_at is not null
    and version.total_weight = 100
  order by version.requisition_id, version.version_number desc
), selected_basis as (
  select distinct on (basis.requisition_id)
    basis.requisition_id,
    basis.id
  from phase1_evaluation_bases basis
  join latest_applied on latest_applied.requisition_id = basis.requisition_id
    and latest_applied.hiring_criteria_version_id = basis.hiring_criteria_version_id
  order by basis.requisition_id, basis.created_at desc
)
update phase1_requisitions requisition
set current_evaluation_basis_id = selected_basis.id,
    updated_at = now()
from selected_basis
where requisition.id = selected_basis.requisition_id
  and requisition.current_evaluation_basis_id is distinct from selected_basis.id;

notify pgrst, 'reload schema';
commit;
