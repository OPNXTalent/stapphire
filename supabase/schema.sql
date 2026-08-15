-- Clean-room Phase 1 schema. Legacy tables are intentionally untouched.
create extension if not exists "uuid-ossp";

create table if not exists phase1_requisitions (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  job_description text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists phase1_candidates (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references phase1_requisitions(id) on delete cascade,
  full_name text not null,
  source_filename text not null,
  resume_text text not null,
  -- recruiter's own recorded decision, distinct from the calculated
  -- Match/verdict - null until they've actually reviewed the candidate
  disposition text check (disposition in ('screen', 'interview', 'hire', 'delete')),
  -- Null until the recruiter establishes a custom order. Once ranked,
  -- active candidates receive a sequential human-controlled sort position.
  rank_order integer check (rank_order is null or rank_order >= 1),
  -- soft-delete - set when disposition is changed to 'delete'. The
  -- candidate leaves the main matrix but the row (and its evaluation
  -- history) stays intact until permanently removed from the trash.
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists phase1_evaluations (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references phase1_requisitions(id) on delete cascade,
  candidate_id uuid not null references phase1_candidates(id) on delete cascade,
  job_responsibilities_score integer not null check (job_responsibilities_score between 0 and 100),
  hard_skills_score integer not null check (hard_skills_score between 0 and 100),
  soft_skills_score integer not null check (soft_skills_score between 0 and 100),
  keyword_terminology_score integer not null check (keyword_terminology_score between 0 and 100),
  overall_match integer not null check (overall_match between 0 and 100),
  verdict text not null check (verdict in ('greenlight', 'consider', 'decline')),
  assessment jsonb not null,
  raw_model_response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists phase1_candidates_requisition_idx on phase1_candidates(requisition_id);
create index if not exists phase1_evaluations_candidate_idx on phase1_evaluations(candidate_id, created_at desc);

-- Backward-compatible requisition lifecycle field. Existing rows remain active.
alter table phase1_requisitions add column if not exists archived_at timestamptz;

-- Tracks changes to the JD source independently from title-only edits so
-- existing analyses can be identified as based on an earlier source.
alter table phase1_requisitions add column if not exists job_description_updated_at timestamptz;
update phase1_requisitions set job_description_updated_at = created_at where job_description_updated_at is null;
alter table phase1_requisitions alter column job_description_updated_at set default now();
alter table phase1_requisitions alter column job_description_updated_at set not null;

-- Backward-compatible addition for databases created before ranking existed.
alter table phase1_candidates add column if not exists rank_order integer;
alter table phase1_candidates add column if not exists source_storage_path text;
alter table phase1_candidates add column if not exists source_mime_type text;
alter table phase1_candidates drop constraint if exists phase1_candidates_rank_order_check;
alter table phase1_candidates add constraint phase1_candidates_rank_order_check check (rank_order is null or rank_order >= 1);

-- Original resume artifacts are private and are accessed only through the
-- server-side service-role client and authenticated application routes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'candidate-resumes',
  'candidate-resumes',
  false,
  10485760,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function set_phase1_candidate_ranks(p_requisition_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update phase1_candidates as candidate
  set rank_order = ordered.rank::integer
  from unnest(p_ordered_ids) with ordinality as ordered(id, rank)
  where candidate.id = ordered.id
    and candidate.requisition_id = p_requisition_id
    and candidate.deleted_at is null;

  get diagnostics updated_count = row_count;
  if updated_count <> cardinality(p_ordered_ids) then
    raise exception 'Candidate order is stale.';
  end if;
end;
$$;

-- Requisition Intelligence is independent of candidate evaluation. Each row is
-- one historical analysis event; later refreshes insert new rows rather than
-- replacing prior market evidence.
create table if not exists phase1_requisition_intelligence_analyses (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references phase1_requisitions(id) on delete cascade,
  status text not null check (status in ('pending', 'completed', 'insufficient_evidence', 'failed')),
  internal_evidence jsonb,
  observed_evidence_summary jsonb,
  estimated_intelligence jsonb,
  usable_comparable_count integer not null default 0 check (usable_comparable_count >= 0),
  evidence_quality_descriptor text,
  geographic_scope text,
  market_evidence_retrieved_at timestamptz,
  analysis_generated_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  check ((status = 'pending' and analysis_generated_at is null) or (status <> 'pending' and analysis_generated_at is not null)),
  check (status <> 'failed' or nullif(btrim(failure_reason), '') is not null)
);

create table if not exists phase1_requisition_market_comparables (
  id uuid primary key default uuid_generate_v4(),
  analysis_id uuid not null references phase1_requisition_intelligence_analyses(id) on delete cascade,
  comparable_title text not null,
  employer text not null,
  location text,
  work_arrangement text not null default 'unknown' check (work_arrangement in ('onsite', 'hybrid', 'remote', 'unknown')),
  compensation_minimum numeric,
  compensation_maximum numeric,
  compensation_unit text not null default 'unknown' check (compensation_unit in ('hour', 'day', 'week', 'month', 'year', 'unknown')),
  currency text,
  posting_date date,
  source_name text not null check (btrim(source_name) <> ''),
  source_url text not null check (source_url ~ '^https?://'),
  retrieved_at timestamptz not null,
  title_similarity integer check (title_similarity between 0 and 100),
  responsibility_similarity integer check (responsibility_similarity between 0 and 100),
  comparable_quality text,
  evidence_notes text,
  created_at timestamptz not null default now(),
  check (compensation_minimum is null or compensation_minimum >= 0),
  check (compensation_maximum is null or compensation_maximum >= 0),
  check (compensation_minimum is null or compensation_maximum is null or compensation_minimum <= compensation_maximum)
);

create index if not exists phase1_requisition_intelligence_latest_idx
  on phase1_requisition_intelligence_analyses(requisition_id, created_at desc);
create index if not exists phase1_requisition_market_comparables_analysis_idx
  on phase1_requisition_market_comparables(analysis_id, retrieved_at desc);

-- One editable JD-derived model per requisition. Immutable applied snapshots
-- preserve what was approved without connecting it to Candidate Match yet.
create table if not exists phase1_hiring_criteria_models (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null unique references phase1_requisitions(id) on delete cascade,
  extraction_status text not null default 'unavailable' check (extraction_status in ('pending', 'ready', 'unavailable', 'failed')),
  extraction_error text,
  unmapped_qualifications jsonb not null default '[]'::jsonb,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (extraction_status <> 'ready' or generated_at is not null),
  check (extraction_status <> 'failed' or nullif(btrim(extraction_error), '') is not null)
);

create table if not exists phase1_hiring_criteria_items (
  id uuid primary key default uuid_generate_v4(),
  model_id uuid not null references phase1_hiring_criteria_models(id) on delete cascade,
  category text not null check (category in ('responsibilities', 'hard_skills', 'soft_skills', 'keywords', 'other_requirements')),
  label text not null check (nullif(btrim(label), '') is not null),
  rationale text,
  jd_evidence text,
  default_weight integer not null check (default_weight between 0 and 100),
  draft_weight integer not null check (draft_weight between 0 and 100),
  is_knockout boolean not null default false,
  knockout_suggested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_knockout or draft_weight = 0)
);

create table if not exists phase1_hiring_criteria_versions (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references phase1_requisitions(id) on delete cascade,
  model_id uuid not null references phase1_hiring_criteria_models(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  criteria_snapshot jsonb not null,
  category_totals jsonb not null,
  total_weight integer not null check (total_weight = 100),
  applied_at timestamptz not null default now(),
  unique (requisition_id, version_number)
);

create index if not exists phase1_hiring_criteria_items_model_idx
  on phase1_hiring_criteria_items(model_id, category, created_at);
create index if not exists phase1_hiring_criteria_versions_latest_idx
  on phase1_hiring_criteria_versions(requisition_id, version_number desc);

alter table phase1_hiring_criteria_models enable row level security;
alter table phase1_hiring_criteria_items enable row level security;
alter table phase1_hiring_criteria_versions enable row level security;

-- Promote previously retained JD-derived qualifications into the editable model.
alter table phase1_hiring_criteria_items drop constraint if exists phase1_hiring_criteria_items_category_check;
alter table phase1_hiring_criteria_items
  add constraint phase1_hiring_criteria_items_category_check
  check (category in ('responsibilities', 'hard_skills', 'soft_skills', 'keywords', 'other_requirements'));
alter table phase1_hiring_criteria_items add column if not exists is_knockout boolean not null default false;
alter table phase1_hiring_criteria_items add column if not exists knockout_suggested boolean not null default false;
alter table phase1_hiring_criteria_items drop constraint if exists phase1_hiring_criteria_items_knockout_weight_check;
update phase1_hiring_criteria_items set draft_weight = 0, updated_at = now() where is_knockout and draft_weight <> 0;
alter table phase1_hiring_criteria_items
  add constraint phase1_hiring_criteria_items_knockout_weight_check check (not is_knockout or draft_weight = 0);

insert into phase1_hiring_criteria_items (
  model_id, category, label, rationale, jd_evidence, default_weight, draft_weight, is_knockout, knockout_suggested
)
select
  model.id,
  'other_requirements',
  qualification.value->>'label',
  nullif(btrim(qualification.value->>'reason'), ''),
  nullif(btrim(qualification.value->>'jdEvidence'), ''),
  0,
  0,
  false,
  false
from phase1_hiring_criteria_models as model
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(model.unmapped_qualifications) = 'array' then model.unmapped_qualifications else '[]'::jsonb end
) as qualification(value)
where nullif(btrim(qualification.value->>'label'), '') is not null
  and not exists (
    select 1 from phase1_hiring_criteria_items as item
    where item.model_id = model.id
      and item.category = 'other_requirements'
      and item.label = qualification.value->>'label'
      and item.jd_evidence is not distinct from nullif(btrim(qualification.value->>'jdEvidence'), '')
  );

create or replace function adjust_phase1_hiring_criterion(
  p_requisition_id uuid,
  p_criterion_id uuid,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_weight integer;
begin
  if p_delta not in (-1, 1) then
    raise exception 'Hiring Criteria adjustments must be exactly one point.';
  end if;

  update phase1_hiring_criteria_items as item
  set draft_weight = greatest(0, item.draft_weight + p_delta),
      updated_at = now()
  where item.id = p_criterion_id
    and not item.is_knockout
    and exists (
      select 1 from phase1_hiring_criteria_models as model
      where model.id = item.model_id
        and model.requisition_id = p_requisition_id
        and model.extraction_status = 'ready'
    )
  returning draft_weight into next_weight;

  if next_weight is null then
    raise exception 'Hiring criterion not found.';
  end if;
  return next_weight;
end;
$$;

revoke all on function adjust_phase1_hiring_criterion(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function adjust_phase1_hiring_criterion(uuid, uuid, integer) to service_role;

drop function if exists set_phase1_hiring_criterion_knockout(uuid, uuid, boolean);

create function set_phase1_hiring_criterion_knockout(
  p_requisition_id uuid,
  p_criterion_id uuid,
  p_is_knockout boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  persisted_state jsonb;
begin
  update phase1_hiring_criteria_items as item
  set is_knockout = p_is_knockout,
      draft_weight = 0,
      updated_at = now()
  where item.id = p_criterion_id
    and exists (
      select 1 from phase1_hiring_criteria_models as model
      where model.id = item.model_id
        and model.requisition_id = p_requisition_id
        and model.extraction_status = 'ready'
    )
  returning jsonb_build_object(
    'draftWeight', item.draft_weight,
    'isKnockout', item.is_knockout
  ) into persisted_state;

  if persisted_state is null then
    raise exception 'Other Requirement not found.';
  end if;
  return persisted_state;
end;
$$;

revoke all on function set_phase1_hiring_criterion_knockout(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function set_phase1_hiring_criterion_knockout(uuid, uuid, boolean) to service_role;
notify pgrst, 'reload schema';

create or replace function reset_phase1_hiring_criteria(p_requisition_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update phase1_hiring_criteria_items as item
  set draft_weight = item.default_weight,
      is_knockout = false,
      updated_at = now()
  where exists (
    select 1 from phase1_hiring_criteria_models as model
    where model.id = item.model_id
      and model.requisition_id = p_requisition_id
      and model.extraction_status = 'ready'
  );
end;
$$;

revoke all on function reset_phase1_hiring_criteria(uuid) from public, anon, authenticated;
grant execute on function reset_phase1_hiring_criteria(uuid) to service_role;

create or replace function apply_phase1_hiring_criteria(p_requisition_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_model_id uuid;
  criterion_count integer;
  draft_total integer;
  next_version integer;
  snapshot jsonb;
  totals jsonb;
  applied_version_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_requisition_id::text));

  select id into selected_model_id
  from phase1_hiring_criteria_models
  where requisition_id = p_requisition_id
    and extraction_status = 'ready';

  if selected_model_id is null then
    raise exception 'No ready Hiring Criteria model exists.';
  end if;

  select count(*), coalesce(sum(draft_weight), 0)
  into criterion_count, draft_total
  from phase1_hiring_criteria_items
  where model_id = selected_model_id
    and not is_knockout;

  if criterion_count = 0 then
    raise exception 'Hiring Criteria model has no subcriteria.';
  end if;
  if draft_total <> 100 then
    raise exception 'Total Hiring Criteria weight must equal 100%%.';
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from phase1_hiring_criteria_versions
  where requisition_id = p_requisition_id;

  select jsonb_agg(jsonb_build_object(
    'id', id,
    'category', category,
    'label', label,
    'rationale', rationale,
    'jdEvidence', jd_evidence,
    'defaultWeight', default_weight,
    'appliedWeight', draft_weight,
    'isKnockout', is_knockout,
    'knockoutSuggested', knockout_suggested
  ) order by category, created_at, id)
  into snapshot
  from phase1_hiring_criteria_items
  where model_id = selected_model_id;

  select jsonb_object_agg(category, category_total)
  into totals
  from (
    select category, sum(draft_weight) as category_total
    from phase1_hiring_criteria_items
    where model_id = selected_model_id
      and not is_knockout
    group by category
  ) as rollups;

  insert into phase1_hiring_criteria_versions (
    requisition_id,
    model_id,
    version_number,
    criteria_snapshot,
    category_totals,
    total_weight
  ) values (
    p_requisition_id,
    selected_model_id,
    next_version,
    snapshot,
    totals,
    draft_total
  ) returning id into applied_version_id;

  return applied_version_id;
end;
$$;

revoke all on function apply_phase1_hiring_criteria(uuid) from public, anon, authenticated;
grant execute on function apply_phase1_hiring_criteria(uuid) to service_role;

alter table phase1_hiring_criteria_models
  add column if not exists unmapped_qualifications jsonb not null default '[]'::jsonb;

create or replace function begin_phase1_hiring_criteria_extraction(p_requisition_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_model_id uuid;
  current_status text;
begin
  insert into phase1_hiring_criteria_models (requisition_id, extraction_status)
  values (p_requisition_id, 'pending')
  on conflict (requisition_id) do nothing;

  select id, extraction_status into selected_model_id, current_status
  from phase1_hiring_criteria_models
  where requisition_id = p_requisition_id
  for update;

  if current_status = 'ready' then
    raise exception 'Hiring Criteria already exist for this requisition.';
  end if;

  update phase1_hiring_criteria_models
  set extraction_status = 'pending',
      extraction_error = null,
      updated_at = now()
  where id = selected_model_id;

  return selected_model_id;
end;
$$;

revoke all on function begin_phase1_hiring_criteria_extraction(uuid) from public, anon, authenticated;
grant execute on function begin_phase1_hiring_criteria_extraction(uuid) to service_role;

create or replace function complete_phase1_hiring_criteria_extraction(
  p_requisition_id uuid,
  p_items jsonb,
  p_unmapped_qualifications jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_model_id uuid;
  item_count integer;
  mismatched_weight_count integer;
  responsibilities_total integer;
  hard_skills_total integer;
  soft_skills_total integer;
  keywords_total integer;
begin
  select id into selected_model_id
  from phase1_hiring_criteria_models
  where requisition_id = p_requisition_id
    and extraction_status = 'pending'
  for update;

  if selected_model_id is null then
    raise exception 'No pending Hiring Criteria extraction exists.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_typeof(p_unmapped_qualifications) <> 'array' then
    raise exception 'Hiring Criteria extraction payload is invalid.';
  end if;

  select
    count(*),
    count(*) filter (where draft_weight <> default_weight),
    coalesce(sum(default_weight) filter (where category = 'responsibilities'), 0),
    coalesce(sum(default_weight) filter (where category = 'hard_skills'), 0),
    coalesce(sum(default_weight) filter (where category = 'soft_skills'), 0),
    coalesce(sum(default_weight) filter (where category = 'keywords'), 0)
  into item_count, mismatched_weight_count, responsibilities_total, hard_skills_total, soft_skills_total, keywords_total
  from jsonb_to_recordset(p_items) as item(
    category text,
    label text,
    rationale text,
    jd_evidence text,
    default_weight integer,
    draft_weight integer,
    is_knockout boolean,
    knockout_suggested boolean
  );

  if item_count = 0
    or mismatched_weight_count <> 0
    or responsibilities_total <> 50
    or hard_skills_total <> 25
    or soft_skills_total <> 15
    or keywords_total <> 10 then
    raise exception 'Hiring Criteria category totals are invalid.';
  end if;

  delete from phase1_hiring_criteria_items where model_id = selected_model_id;

  insert into phase1_hiring_criteria_items (
    model_id, category, label, rationale, jd_evidence, default_weight, draft_weight, is_knockout, knockout_suggested
  )
  select
    selected_model_id,
    item.category,
    item.label,
    item.rationale,
    item.jd_evidence,
    item.default_weight,
    item.draft_weight,
    coalesce(item.is_knockout, false),
    coalesce(item.knockout_suggested, false)
  from jsonb_to_recordset(p_items) as item(
    category text,
    label text,
    rationale text,
    jd_evidence text,
    default_weight integer,
    draft_weight integer,
    is_knockout boolean,
    knockout_suggested boolean
  );

  update phase1_hiring_criteria_models
  set extraction_status = 'ready',
      extraction_error = null,
      unmapped_qualifications = p_unmapped_qualifications,
      generated_at = now(),
      updated_at = now()
  where id = selected_model_id;
end;
$$;

revoke all on function complete_phase1_hiring_criteria_extraction(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function complete_phase1_hiring_criteria_extraction(uuid, jsonb, jsonb) to service_role;

create or replace function fail_phase1_hiring_criteria_extraction(
  p_requisition_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update phase1_hiring_criteria_models
  set extraction_status = 'failed',
      extraction_error = coalesce(nullif(btrim(p_error), ''), 'Hiring Criteria extraction failed.'),
      updated_at = now()
  where requisition_id = p_requisition_id
    and extraction_status = 'pending';
end;
$$;

revoke all on function fail_phase1_hiring_criteria_extraction(uuid, text) from public, anon, authenticated;
grant execute on function fail_phase1_hiring_criteria_extraction(uuid, text) to service_role;

