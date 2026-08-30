begin;

alter table phase1_evaluations
  add column if not exists model_identifier text,
  add column if not exists prompt_schema_version text,
  add column if not exists neutral_findings_provenance text;

alter table phase1_evaluations
  drop constraint if exists phase1_evaluations_neutral_findings_provenance_check;
alter table phase1_evaluations
  add constraint phase1_evaluations_neutral_findings_provenance_check
  check (neutral_findings_provenance is null or neutral_findings_provenance in ('model_observed', 'legacy_unavailable'));

create table if not exists phase1_evaluation_criterion_findings (
  id uuid primary key default uuid_generate_v4(),
  evaluation_id uuid not null references phase1_evaluations(id) on delete cascade,
  hiring_criteria_version_id uuid not null references phase1_hiring_criteria_versions(id),
  criterion_id uuid not null,
  criterion_semantic_fingerprint text not null
    check (criterion_semantic_fingerprint ~ '^[0-9a-f]{64}$'),
  semantic_fingerprint_version text not null
    check (semantic_fingerprint_version = 'criterion_semantics_v1'),
  alignment_score smallint not null check (alignment_score in (0, 25, 50, 75, 100)),
  satisfaction_status text not null check (satisfaction_status in ('MET', 'NOT_MET', 'UNABLE_TO_DETERMINE')),
  evidence text not null check (nullif(btrim(evidence), '') is not null),
  assessment text not null check (nullif(btrim(assessment), '') is not null),
  created_at timestamptz not null default now(),
  unique (evaluation_id, criterion_id)
);

create index if not exists phase1_evaluation_criterion_findings_evaluation_idx
  on phase1_evaluation_criterion_findings(evaluation_id);
create index if not exists phase1_evaluation_criterion_findings_version_criterion_idx
  on phase1_evaluation_criterion_findings(hiring_criteria_version_id, criterion_id);

alter table phase1_evaluation_criterion_findings enable row level security;
revoke all on table phase1_evaluation_criterion_findings from public, anon, authenticated;
grant select, insert, update, delete on table phase1_evaluation_criterion_findings to service_role;

create or replace function phase1_normalize_criterion_semantic_text(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select btrim(regexp_replace(
    normalize(replace(replace(p_value, E'\r\n', E'\n'), E'\r', E'\n'), NFC),
    E'[ \t\f\v]+',
    ' ',
    'g'
  ));
$$;

create or replace function phase1_criterion_semantic_canonical_json(
  p_category text,
  p_label text,
  p_rationale text,
  p_jd_evidence text
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select format(
    '{"category":%s,"label":%s,"rationale":%s,"jdEvidence":%s}',
    to_json(phase1_normalize_criterion_semantic_text(p_category))::text,
    to_json(phase1_normalize_criterion_semantic_text(p_label))::text,
    coalesce(to_json(nullif(phase1_normalize_criterion_semantic_text(p_rationale), ''))::text, 'null'),
    coalesce(to_json(nullif(phase1_normalize_criterion_semantic_text(p_jd_evidence), ''))::text, 'null')
  );
$$;

create or replace function phase1_criterion_semantic_fingerprint(
  p_category text,
  p_label text,
  p_rationale text,
  p_jd_evidence text
)
returns text
language sql
immutable
set search_path = pg_catalog, public, extensions
as $$
  select lower(encode(extensions.digest(
    convert_to(phase1_criterion_semantic_canonical_json(p_category, p_label, p_rationale, p_jd_evidence), 'UTF8'),
    'sha256'
  ), 'hex'));
$$;

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
    'knockoutSuggested', knockout_suggested,
    'semanticFingerprint', phase1_criterion_semantic_fingerprint(category, label, rationale, jd_evidence),
    'semanticFingerprintVersion', 'criterion_semantics_v1'
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

  source_hash := encode(extensions.digest(btrim(replace(replace(current_requisition.job_description, E'\r\n', E'\n'), E'\r', E'\n')), 'sha256'), 'hex');
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

create or replace function complete_phase1_hiring_criteria_resume_operation_item_v1(
  p_item_id uuid,
  p_lease_token uuid,
  p_full_name text,
  p_resume_text text,
  p_scores jsonb,
  p_verdict text,
  p_assessment jsonb,
  p_raw_model_response jsonb,
  p_findings jsonb,
  p_model_identifier text,
  p_prompt_schema_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_item phase1_operation_items%rowtype;
  selected_operation phase1_operations%rowtype;
  selected_basis phase1_evaluation_bases%rowtype;
  selected_version phase1_hiring_criteria_versions%rowtype;
  v_candidate_id uuid;
  v_evaluation_id uuid;
  basis_id uuid;
  expected_count integer;
  persisted_count integer;
begin
  select * into selected_item from phase1_operation_items
  where id = p_item_id and status = 'processing' and lease_token = p_lease_token for update;
  if selected_item.id is null or selected_item.lease_expires_at <= now() then
    raise exception 'Resume item lease is no longer authoritative.';
  end if;

  select * into selected_operation from phase1_operations
  where id = selected_item.operation_id and operation_type = 'resume_batch_evaluation' for update;
  if selected_operation.id is null then raise exception 'Resume operation is unavailable.'; end if;

  begin
    basis_id := (selected_operation.input_snapshot->>'evaluationBasisId')::uuid;
  exception when others then
    raise exception 'Captured Evaluation Basis is invalid.';
  end;

  select * into selected_basis from phase1_evaluation_bases
  where id = basis_id
    and requisition_id = selected_operation.requisition_id
    and basis_type = 'hiring_criteria'
    and hiring_criteria_version_id is not null;
  if selected_basis.id is null then raise exception 'Captured Hiring Criteria Evaluation Basis is unavailable.'; end if;

  select * into selected_version from phase1_hiring_criteria_versions
  where id = selected_basis.hiring_criteria_version_id
    and requisition_id = selected_operation.requisition_id;
  if selected_version.id is null or jsonb_typeof(selected_version.criteria_snapshot) <> 'array' then
    raise exception 'Captured Hiring Criteria version is unavailable or malformed.';
  end if;

  expected_count := jsonb_array_length(selected_version.criteria_snapshot);
  if expected_count = 0 or jsonb_typeof(p_findings) <> 'array' or jsonb_array_length(p_findings) <> expected_count then
    raise exception 'Hiring Criteria findings must cover every captured criterion exactly once.';
  end if;
  if nullif(btrim(p_model_identifier), '') is null or nullif(btrim(p_prompt_schema_version), '') is null then
    raise exception 'Hiring Criteria evaluation provenance is required.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(selected_version.criteria_snapshot) criterion
    where nullif(criterion->>'id', '') is null
  ) or (
    select count(*) from (
      select criterion->>'id' from jsonb_array_elements(selected_version.criteria_snapshot) criterion
      group by criterion->>'id'
    ) ids
  ) <> expected_count then
    raise exception 'Captured Hiring Criteria snapshot contains invalid or duplicate criterion IDs.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_findings) finding
    where jsonb_typeof(finding) <> 'object'
      or nullif(finding->>'criterionId', '') is null
      or (finding->>'alignmentScore')::integer not in (0, 25, 50, 75, 100)
      or finding->>'satisfactionStatus' not in ('MET', 'NOT_MET', 'UNABLE_TO_DETERMINE')
      or nullif(btrim(finding->>'evidence'), '') is null
      or nullif(btrim(finding->>'assessment'), '') is null
      or finding->>'semanticFingerprintVersion' <> 'criterion_semantics_v1'
      or finding->>'criterionSemanticFingerprint' !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'Hiring Criteria finding payload is invalid.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_findings) finding
    group by finding->>'criterionId'
    having count(*) <> 1
  ) then
    raise exception 'Hiring Criteria findings contain duplicate criterion IDs.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_findings) finding
    left join jsonb_array_elements(selected_version.criteria_snapshot) criterion
      on criterion->>'id' = finding->>'criterionId'
    where criterion is null
  ) or exists (
    select 1
    from jsonb_array_elements(selected_version.criteria_snapshot) criterion
    left join jsonb_array_elements(p_findings) finding
      on finding->>'criterionId' = criterion->>'id'
    where finding is null
  ) then
    raise exception 'Hiring Criteria findings contain unknown or missing criterion IDs.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_findings) finding
    join jsonb_array_elements(selected_version.criteria_snapshot) criterion
      on criterion->>'id' = finding->>'criterionId'
    where finding->>'criterionSemanticFingerprint' <> phase1_criterion_semantic_fingerprint(
      criterion->>'category', criterion->>'label', criterion->>'rationale', criterion->>'jdEvidence'
    )
      and not coalesce((
        criterion->>'semanticFingerprintVersion' = 'criterion_semantics_v1'
        and finding->>'criterionSemanticFingerprint' = criterion->>'semanticFingerprint'
      ), false)
  ) then
    raise exception 'Hiring Criteria semantic fingerprint does not match the captured snapshot.';
  end if;

  select id into v_candidate_id from phase1_candidates where operation_item_id = selected_item.id;
  if v_candidate_id is null then
    insert into phase1_candidates(
      requisition_id, full_name, source_filename, source_storage_path, source_mime_type, resume_text, operation_item_id
    ) values (
      selected_operation.requisition_id, coalesce(nullif(btrim(p_full_name), ''), selected_item.input_ref->>'originalFilename'),
      selected_item.input_ref->>'originalFilename', selected_item.input_ref->>'storagePath', selected_item.input_ref->>'mimeType',
      p_resume_text, selected_item.id
    ) returning id into v_candidate_id;
  elsif not exists (
    select 1 from phase1_candidates
    where id = v_candidate_id and requisition_id = selected_operation.requisition_id and resume_text = p_resume_text
  ) then
    raise exception 'Existing candidate does not match the operation item.';
  end if;

  select id into v_evaluation_id from phase1_evaluations where operation_item_id = selected_item.id;
  if v_evaluation_id is null then
    insert into phase1_evaluations(
      requisition_id, candidate_id, evaluation_basis_id, job_responsibilities_score, hard_skills_score,
      soft_skills_score, keyword_terminology_score, overall_match, verdict, assessment, raw_model_response,
      operation_item_id, model_identifier, prompt_schema_version, neutral_findings_provenance
    ) values (
      selected_operation.requisition_id, v_candidate_id, basis_id,
      (p_scores->>'responsibilities')::integer, (p_scores->>'hardSkills')::integer,
      (p_scores->>'softSkills')::integer, (p_scores->>'keywords')::integer, (p_scores->>'match')::integer,
      p_verdict, p_assessment, p_raw_model_response, selected_item.id,
      btrim(p_model_identifier), btrim(p_prompt_schema_version), 'model_observed'
    ) returning id into v_evaluation_id;
  elsif not exists (
    select 1 from phase1_evaluations
    where id = v_evaluation_id
      and requisition_id = selected_operation.requisition_id
      and candidate_id = v_candidate_id
      and evaluation_basis_id = basis_id
      and job_responsibilities_score is not distinct from (p_scores->>'responsibilities')::integer
      and hard_skills_score is not distinct from (p_scores->>'hardSkills')::integer
      and soft_skills_score is not distinct from (p_scores->>'softSkills')::integer
      and keyword_terminology_score is not distinct from (p_scores->>'keywords')::integer
      and overall_match = (p_scores->>'match')::integer
      and verdict = p_verdict
      and assessment = p_assessment
      and raw_model_response is not distinct from p_raw_model_response
      and model_identifier = btrim(p_model_identifier)
      and prompt_schema_version = btrim(p_prompt_schema_version)
      and neutral_findings_provenance = 'model_observed'
  ) then
    raise exception 'Existing evaluation does not match the operation item completion payload.';
  end if;

  insert into phase1_evaluation_criterion_findings(
    evaluation_id, hiring_criteria_version_id, criterion_id, criterion_semantic_fingerprint,
    semantic_fingerprint_version, alignment_score, satisfaction_status, evidence, assessment
  )
  select
    v_evaluation_id,
    selected_version.id,
    (finding->>'criterionId')::uuid,
    finding->>'criterionSemanticFingerprint',
    finding->>'semanticFingerprintVersion',
    (finding->>'alignmentScore')::smallint,
    finding->>'satisfactionStatus',
    finding->>'evidence',
    finding->>'assessment'
  from jsonb_array_elements(p_findings) finding
  on conflict (evaluation_id, criterion_id) do nothing;

  if exists (
    select 1
    from jsonb_array_elements(p_findings) finding
    left join phase1_evaluation_criterion_findings persisted
      on persisted.evaluation_id = v_evaluation_id
      and persisted.criterion_id = (finding->>'criterionId')::uuid
    where persisted.id is null
      or persisted.hiring_criteria_version_id <> selected_version.id
      or persisted.criterion_semantic_fingerprint <> finding->>'criterionSemanticFingerprint'
      or persisted.semantic_fingerprint_version <> finding->>'semanticFingerprintVersion'
      or persisted.alignment_score <> (finding->>'alignmentScore')::smallint
      or persisted.satisfaction_status <> finding->>'satisfactionStatus'
      or persisted.evidence <> finding->>'evidence'
      or persisted.assessment <> finding->>'assessment'
  ) then
    raise exception 'Persisted Hiring Criteria findings do not match the completion payload.';
  end if;

  select count(*) into persisted_count
  from phase1_evaluation_criterion_findings
  where evaluation_id = v_evaluation_id;
  if persisted_count <> expected_count then
    raise exception 'Persisted Hiring Criteria finding count does not match the captured snapshot.';
  end if;

  update phase1_operation_items
  set status = 'completed', candidate_id = v_candidate_id,
      evaluation_id = v_evaluation_id, error_summary = null,
      lease_token = null, lease_expires_at = null, completed_at = now(), failed_at = null, updated_at = now()
  where id = selected_item.id;
  perform refresh_phase1_resume_operation_rollup(selected_operation.id);
  return jsonb_build_object('candidateId', v_candidate_id, 'evaluationId', v_evaluation_id);
end;
$$;

revoke all on function complete_phase1_hiring_criteria_resume_operation_item_v1(uuid, uuid, text, text, jsonb, text, jsonb, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function complete_phase1_hiring_criteria_resume_operation_item_v1(uuid, uuid, text, text, jsonb, text, jsonb, jsonb, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
