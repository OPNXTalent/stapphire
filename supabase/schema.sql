-- Clean-room Phase 1 schema. Legacy tables are intentionally untouched.
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

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

-- Immutable snapshots of the exact requisition source used for candidate
-- evaluation. Stage 1 activates Job Description bases only; the criteria
-- reference is reserved for a later executable Hiring Criteria stage.
create table if not exists phase1_evaluation_bases (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references phase1_requisitions(id) on delete cascade,
  basis_type text not null check (basis_type in ('job_description', 'hiring_criteria')),
  job_description_snapshot text not null,
  job_description_hash text not null check (job_description_hash ~ '^[0-9a-f]{64}$'),
  job_description_updated_at timestamptz not null,
  hiring_criteria_version_id uuid,
  created_at timestamptz not null default now(),
  check (
    (basis_type = 'job_description' and hiring_criteria_version_id is null)
    or (basis_type = 'hiring_criteria' and hiring_criteria_version_id is not null)
  ),
  unique (id, requisition_id)
);

alter table phase1_requisitions add column if not exists current_evaluation_basis_id uuid;
alter table phase1_evaluations add column if not exists evaluation_basis_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'phase1_requisitions_current_evaluation_basis_fk') then
    alter table phase1_requisitions
      add constraint phase1_requisitions_current_evaluation_basis_fk
      foreign key (current_evaluation_basis_id) references phase1_evaluation_bases(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase1_evaluations_basis_requisition_fk') then
    alter table phase1_evaluations
      add constraint phase1_evaluations_basis_requisition_fk
      foreign key (evaluation_basis_id, requisition_id)
      references phase1_evaluation_bases(id, requisition_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase1_candidates_id_requisition_key') then
    alter table phase1_candidates
      add constraint phase1_candidates_id_requisition_key unique (id, requisition_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase1_evaluations_candidate_requisition_fk') then
    alter table phase1_evaluations
      add constraint phase1_evaluations_candidate_requisition_fk
      foreign key (candidate_id, requisition_id)
      references phase1_candidates(id, requisition_id);
  end if;
end $$;

create index if not exists phase1_evaluation_bases_requisition_idx
  on phase1_evaluation_bases(requisition_id, created_at desc);
create index if not exists phase1_evaluations_basis_idx
  on phase1_evaluations(evaluation_basis_id) where evaluation_basis_id is not null;

alter table phase1_evaluation_bases enable row level security;

create or replace function validate_phase1_current_evaluation_basis()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.current_evaluation_basis_id is not null and not exists (
    select 1 from phase1_evaluation_bases as basis
    where basis.id = new.current_evaluation_basis_id
      and basis.requisition_id = new.id
  ) then
    raise exception 'Current Evaluation Basis must belong to the requisition.';
  end if;
  return new;
end;
$$;

drop trigger if exists phase1_requisitions_validate_current_evaluation_basis on phase1_requisitions;
create trigger phase1_requisitions_validate_current_evaluation_basis
before insert or update of current_evaluation_basis_id on phase1_requisitions
for each row execute function validate_phase1_current_evaluation_basis();

create or replace function prevent_phase1_evaluation_basis_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Evaluation Basis snapshots are immutable.';
end;
$$;

drop trigger if exists phase1_evaluation_bases_prevent_update on phase1_evaluation_bases;
create trigger phase1_evaluation_bases_prevent_update
before update on phase1_evaluation_bases
for each row execute function prevent_phase1_evaluation_basis_update();

-- Give every existing requisition one truthful current-JD basis without
-- claiming that the basis produced any historical evaluation.
with missing as (
  insert into phase1_evaluation_bases (
    requisition_id,
    basis_type,
    job_description_snapshot,
    job_description_hash,
    job_description_updated_at
  )
  select
    requisition.id,
    'job_description',
    requisition.job_description,
    encode(digest(btrim(regexp_replace(requisition.job_description, E'\\r\\n?', chr(10), 'g')), 'sha256'), 'hex'),
    requisition.job_description_updated_at
  from phase1_requisitions as requisition
  where requisition.current_evaluation_basis_id is null
  returning id, requisition_id
)
update phase1_requisitions as requisition
set current_evaluation_basis_id = missing.id
from missing
where requisition.id = missing.requisition_id;

create or replace function create_phase1_requisition_with_evaluation_basis(
  p_title text,
  p_job_description text,
  p_job_description_hash text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_requisition phase1_requisitions%rowtype;
  created_basis_id uuid;
begin
  if nullif(btrim(p_title), '') is null or nullif(btrim(p_job_description), '') is null then
    raise exception 'Title and Job Description are required.';
  end if;
  if p_job_description_hash is null or p_job_description_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Job Description hash is invalid.';
  end if;

  insert into phase1_requisitions (title, job_description)
  values (btrim(p_title), btrim(p_job_description))
  returning * into created_requisition;

  insert into phase1_evaluation_bases (
    requisition_id,
    basis_type,
    job_description_snapshot,
    job_description_hash,
    job_description_updated_at
  ) values (
    created_requisition.id,
    'job_description',
    created_requisition.job_description,
    p_job_description_hash,
    created_requisition.job_description_updated_at
  ) returning id into created_basis_id;

  update phase1_requisitions
  set current_evaluation_basis_id = created_basis_id
  where id = created_requisition.id;

  return created_requisition.id;
end;
$$;

revoke all on function create_phase1_requisition_with_evaluation_basis(text, text, text) from public, anon, authenticated;
grant execute on function create_phase1_requisition_with_evaluation_basis(text, text, text) to service_role;

create or replace function update_phase1_requisition_with_evaluation_basis(
  p_requisition_id uuid,
  p_title text,
  p_job_description text,
  p_job_description_hash text
)
returns table (
  requisition_id uuid,
  position_title text,
  persisted_job_description text,
  persisted_job_description_updated_at timestamptz,
  evaluation_basis_id uuid,
  basis_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_requisition phase1_requisitions%rowtype;
  changed boolean;
  next_job_description_updated_at timestamptz;
  next_basis_id uuid;
begin
  if nullif(btrim(p_title), '') is null or nullif(btrim(p_job_description), '') is null then
    raise exception 'Position title and Job Description are required.';
  end if;
  if p_job_description_hash is null or p_job_description_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Job Description hash is invalid.';
  end if;

  select * into current_requisition
  from phase1_requisitions
  where id = p_requisition_id and archived_at is null
  for update;

  if not found then return; end if;

  changed := btrim(regexp_replace(current_requisition.job_description, E'\\r\\n?', chr(10), 'g'))
    <> btrim(regexp_replace(p_job_description, E'\\r\\n?', chr(10), 'g'));

  if changed then
    next_job_description_updated_at := now();
    update phase1_requisitions
    set title = btrim(p_title),
        job_description = btrim(p_job_description),
        job_description_updated_at = next_job_description_updated_at,
        updated_at = now()
    where id = p_requisition_id
    returning * into current_requisition;

    insert into phase1_evaluation_bases (
      requisition_id,
      basis_type,
      job_description_snapshot,
      job_description_hash,
      job_description_updated_at
    ) values (
      current_requisition.id,
      'job_description',
      current_requisition.job_description,
      p_job_description_hash,
      current_requisition.job_description_updated_at
    ) returning id into next_basis_id;

    update phase1_requisitions
    set current_evaluation_basis_id = next_basis_id
    where id = p_requisition_id
    returning * into current_requisition;
  else
    update phase1_requisitions
    set title = btrim(p_title),
        updated_at = now()
    where id = p_requisition_id
    returning * into current_requisition;
    next_basis_id := current_requisition.current_evaluation_basis_id;
  end if;

  return query select
    current_requisition.id,
    current_requisition.title,
    current_requisition.job_description,
    current_requisition.job_description_updated_at,
    next_basis_id,
    changed;
end;
$$;

revoke all on function update_phase1_requisition_with_evaluation_basis(uuid, text, text, text) from public, anon, authenticated;
grant execute on function update_phase1_requisition_with_evaluation_basis(uuid, text, text, text) to service_role;

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

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'phase1_evaluation_bases_hiring_criteria_version_fk') then
    alter table phase1_evaluation_bases
      add constraint phase1_evaluation_bases_hiring_criteria_version_fk
      foreign key (hiring_criteria_version_id)
      references phase1_hiring_criteria_versions(id) on delete cascade;
  end if;
end $$;

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

-- Stage 2: an applied Hiring Criteria version becomes the executable basis.
alter table phase1_evaluations alter column job_responsibilities_score drop not null;
alter table phase1_evaluations alter column hard_skills_score drop not null;
alter table phase1_evaluations alter column soft_skills_score drop not null;
alter table phase1_evaluations alter column keyword_terminology_score drop not null;

create or replace function prevent_phase1_hiring_criteria_version_update()
returns trigger language plpgsql set search_path = public as $$
begin raise exception 'Hiring Criteria versions are immutable.'; end; $$;
drop trigger if exists phase1_hiring_criteria_versions_immutable on phase1_hiring_criteria_versions;
create trigger phase1_hiring_criteria_versions_immutable before update on phase1_hiring_criteria_versions
for each row execute function prevent_phase1_hiring_criteria_version_update();
do $$ begin
  if not exists(select 1 from pg_constraint where conname='phase1_hiring_criteria_versions_id_requisition_key') then
    alter table phase1_hiring_criteria_versions add constraint phase1_hiring_criteria_versions_id_requisition_key unique(id,requisition_id);
  end if;
  if not exists(select 1 from pg_constraint where conname='phase1_evaluation_bases_hiring_criteria_requisition_fk') then
    alter table phase1_evaluation_bases add constraint phase1_evaluation_bases_hiring_criteria_requisition_fk foreign key(hiring_criteria_version_id,requisition_id) references phase1_hiring_criteria_versions(id,requisition_id);
  end if;
end $$;

drop function if exists apply_phase1_hiring_criteria(uuid);
create function apply_phase1_hiring_criteria(p_requisition_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  current_requisition phase1_requisitions%rowtype; selected_model_id uuid;
  criterion_count integer; draft_total integer; next_version integer;
  snapshot jsonb; totals jsonb; applied_version_id uuid; evaluation_basis_id uuid; source_hash text;
begin
  perform pg_advisory_xact_lock(hashtext(p_requisition_id::text));
  select * into current_requisition from phase1_requisitions
    where id = p_requisition_id and archived_at is null for update;
  if current_requisition.id is null then raise exception 'Active requisition not found.'; end if;
  select id into selected_model_id from phase1_hiring_criteria_models
    where requisition_id = p_requisition_id and extraction_status = 'ready' for update;
  if selected_model_id is null then raise exception 'No ready Hiring Criteria model exists.'; end if;
  select count(*), coalesce(sum(draft_weight),0) into criterion_count,draft_total
    from phase1_hiring_criteria_items where model_id=selected_model_id and not is_knockout;
  if criterion_count=0 then raise exception 'Hiring Criteria model has no weighted criteria.'; end if;
  if draft_total<>100 then raise exception 'Total Hiring Criteria weight must equal 100%%.'; end if;
  if exists(select 1 from phase1_hiring_criteria_items where model_id=selected_model_id and is_knockout and draft_weight<>0) then raise exception 'Knockout criteria cannot carry weight.'; end if;
  select coalesce(max(version_number),0)+1 into next_version from phase1_hiring_criteria_versions where requisition_id=p_requisition_id;
  select jsonb_agg(jsonb_build_object('id',id,'category',category,'label',label,'rationale',rationale,'jdEvidence',jd_evidence,'defaultWeight',default_weight,'appliedWeight',draft_weight,'isKnockout',is_knockout,'knockoutSuggested',knockout_suggested) order by category,created_at,id)
    into snapshot from phase1_hiring_criteria_items where model_id=selected_model_id;
  if snapshot is null then raise exception 'Hiring Criteria snapshot is empty.'; end if;
  select jsonb_object_agg(category,category_total) into totals from
    (select category,sum(draft_weight) category_total from phase1_hiring_criteria_items where model_id=selected_model_id and not is_knockout group by category) rollups;
  insert into phase1_hiring_criteria_versions(requisition_id,model_id,version_number,criteria_snapshot,category_totals,total_weight)
    values(p_requisition_id,selected_model_id,next_version,snapshot,coalesce(totals,'{}'::jsonb),draft_total) returning id into applied_version_id;
  source_hash:=encode(extensions.digest(btrim(replace(replace(current_requisition.job_description,E'\r\n',E'\n'),E'\r',E'\n')),'sha256'),'hex');
  insert into phase1_evaluation_bases(requisition_id,basis_type,job_description_snapshot,job_description_hash,job_description_updated_at,hiring_criteria_version_id)
    values(p_requisition_id,'hiring_criteria',current_requisition.job_description,source_hash,current_requisition.job_description_updated_at,applied_version_id) returning id into evaluation_basis_id;
  update phase1_requisitions set current_evaluation_basis_id=evaluation_basis_id,updated_at=now() where id=p_requisition_id;
  return jsonb_build_object('versionId',applied_version_id,'basisId',evaluation_basis_id);
end; $$;
revoke all on function apply_phase1_hiring_criteria(uuid) from public, anon, authenticated;
grant execute on function apply_phase1_hiring_criteria(uuid) to service_role;
create index if not exists phase1_evaluation_bases_hiring_criteria_version_idx on phase1_evaluation_bases(hiring_criteria_version_id) where hiring_criteria_version_id is not null;
notify pgrst, 'reload schema';

-- Durable Operations Stage 1: generic operation records and Hiring Criteria execution.

create table if not exists phase1_operations (
  id uuid primary key default uuid_generate_v4(),
  operation_type text not null check (nullif(btrim(operation_type), '') is not null),
  requisition_id uuid references phase1_requisitions(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'partially_completed', 'failed', 'cancelled')),
  stage text,
  progress_current integer not null default 0 check (progress_current >= 0),
  progress_total integer check (progress_total is null or progress_total >= 0),
  input_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(input_snapshot) = 'object'),
  result_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(result_summary) = 'object'),
  error_summary text,
  idempotency_key text not null unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (progress_total is null or progress_current <= progress_total),
  check ((lease_token is null) = (lease_expires_at is null))
);

create index if not exists phase1_operations_status_available_idx
  on phase1_operations(status, available_at);
create index if not exists phase1_operations_requisition_status_idx
  on phase1_operations(requisition_id, status, created_at desc);

create table if not exists phase1_operation_items (
  id uuid primary key default uuid_generate_v4(),
  operation_id uuid not null references phase1_operations(id) on delete cascade,
  item_key text not null check (nullif(btrim(item_key), '') is not null),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  input_ref jsonb not null default '{}'::jsonb check (jsonb_typeof(input_ref) = 'object'),
  candidate_id uuid references phase1_candidates(id) on delete set null,
  evaluation_id uuid references phase1_evaluations(id) on delete set null,
  error_summary text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (operation_id, item_key),
  check ((lease_token is null) = (lease_expires_at is null))
);

create index if not exists phase1_operation_items_operation_status_idx
  on phase1_operation_items(operation_id, status, created_at);
create index if not exists phase1_operation_items_status_available_idx
  on phase1_operation_items(status, available_at);

alter table phase1_operations enable row level security;
alter table phase1_operation_items enable row level security;

alter table phase1_hiring_criteria_models
  add column if not exists active_operation_id uuid references phase1_operations(id) on delete set null;

create or replace function create_phase1_hiring_criteria_operation(
  p_requisition_id uuid,
  p_extractor_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_requisition phase1_requisitions%rowtype;
  selected_basis phase1_evaluation_bases%rowtype;
  selected_operation phase1_operations%rowtype;
  selected_model_id uuid;
  operation_key text;
  should_dispatch boolean := false;
begin
  if nullif(btrim(p_extractor_version), '') is null then
    raise exception 'Hiring Criteria extractor version is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('hiring-criteria:' || p_requisition_id::text));

  select * into selected_requisition
  from phase1_requisitions
  where id = p_requisition_id and archived_at is null
  for update;
  if selected_requisition.id is null then
    raise exception 'Requisition not found.';
  end if;

  select * into selected_basis
  from phase1_evaluation_bases
  where requisition_id = p_requisition_id
    and basis_type = 'job_description'
    and job_description_hash = encode(
      digest(btrim(regexp_replace(selected_requisition.job_description, E'\\r\\n?', chr(10), 'g')), 'sha256'),
      'hex'
    )
  order by job_description_updated_at desc, created_at desc
  limit 1;
  if selected_basis.id is null then
    raise exception 'Current Job Description Evaluation Basis is unavailable.';
  end if;

  operation_key := concat_ws(':', 'hiring_criteria_generation', p_requisition_id, selected_basis.id, selected_basis.job_description_hash, p_extractor_version);
  select * into selected_operation
  from phase1_operations
  where idempotency_key = operation_key
  for update;

  if selected_operation.id is null then
    insert into phase1_operations (
      operation_type, requisition_id, status, stage, progress_current, progress_total,
      input_snapshot, idempotency_key
    ) values (
      'hiring_criteria_generation', p_requisition_id, 'queued', 'queued', 0, 1,
      jsonb_build_object(
        'evaluationBasisId', selected_basis.id,
        'jobDescriptionHash', selected_basis.job_description_hash,
        'extractorVersion', p_extractor_version
      ),
      operation_key
    ) returning * into selected_operation;
    should_dispatch := true;
  elsif selected_operation.status in ('failed', 'cancelled') then
    update phase1_operations
    set status = 'queued', stage = 'queued', progress_current = 0,
        result_summary = '{}'::jsonb, error_summary = null, attempt_count = 0,
        available_at = now(), lease_token = null, lease_expires_at = null,
        started_at = null, completed_at = null, failed_at = null, updated_at = now()
    where id = selected_operation.id
    returning * into selected_operation;
    should_dispatch := true;
  end if;

  if selected_operation.status in ('queued', 'processing') then
    insert into phase1_hiring_criteria_models (requisition_id, extraction_status, active_operation_id)
    values (p_requisition_id, 'pending', selected_operation.id)
    on conflict (requisition_id) do update
    set extraction_status = 'pending', extraction_error = null,
        active_operation_id = excluded.active_operation_id, updated_at = now()
    returning id into selected_model_id;
  end if;

  return jsonb_build_object(
    'id', selected_operation.id,
    'status', selected_operation.status,
    'shouldDispatch', should_dispatch,
    'evaluationBasisId', selected_basis.id,
    'jobDescriptionHash', selected_basis.job_description_hash,
    'extractorVersion', p_extractor_version
  );
end;
$$;

create or replace function claim_phase1_operation(
  p_operation_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed phase1_operations%rowtype;
  exhausted_requisition_id uuid;
begin
  if p_lease_token is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'Operation lease is invalid.';
  end if;

  update phase1_operations
  set status = 'failed', stage = 'failed',
      error_summary = coalesce(error_summary, 'Maximum Hiring Criteria operation attempts exhausted.'),
      lease_token = null, lease_expires_at = null, failed_at = now(), updated_at = now()
  where id = p_operation_id
    and operation_type = 'hiring_criteria_generation'
    and attempt_count >= 3
    and (status = 'queued' or (status = 'processing' and lease_expires_at < now()))
  returning requisition_id into exhausted_requisition_id;

  if exhausted_requisition_id is not null then
    update phase1_hiring_criteria_models
    set extraction_status = 'failed',
        extraction_error = 'Maximum Hiring Criteria operation attempts exhausted.',
        active_operation_id = null, updated_at = now()
    where requisition_id = exhausted_requisition_id and active_operation_id = p_operation_id;
    return null;
  end if;

  update phase1_operations
  set status = 'processing', stage = 'generating', attempt_count = attempt_count + 1,
      lease_token = p_lease_token, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, now()), updated_at = now()
  where id = p_operation_id
    and operation_type = 'hiring_criteria_generation'
    and attempt_count < 3
    and available_at <= now() + interval '2 seconds'
    and (status = 'queued' or (status = 'processing' and lease_expires_at < now()))
  returning * into claimed;

  if claimed.id is null then return null; end if;
  return jsonb_build_object(
    'id', claimed.id,
    'requisitionId', claimed.requisition_id,
    'attemptCount', claimed.attempt_count,
    'inputSnapshot', claimed.input_snapshot
  );
end;
$$;

create or replace function complete_phase1_hiring_criteria_operation(
  p_operation_id uuid,
  p_lease_token uuid,
  p_items jsonb,
  p_unmapped_qualifications jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_operation phase1_operations%rowtype;
begin
  select * into selected_operation
  from phase1_operations
  where id = p_operation_id and status = 'processing' and lease_token = p_lease_token
  for update;
  if selected_operation.id is null or selected_operation.lease_expires_at <= now() then
    raise exception 'Operation lease is no longer authoritative.';
  end if;
  if not exists (
    select 1 from phase1_hiring_criteria_models
    where requisition_id = selected_operation.requisition_id
      and extraction_status = 'pending'
      and active_operation_id = selected_operation.id
  ) then
    raise exception 'Hiring Criteria operation is no longer current.';
  end if;

  perform complete_phase1_hiring_criteria_extraction(
    selected_operation.requisition_id,
    p_items,
    p_unmapped_qualifications
  );

  update phase1_operations
  set status = 'completed', stage = 'completed', progress_current = 1,
      result_summary = jsonb_build_object('requisitionId', requisition_id, 'itemCount', jsonb_array_length(p_items)),
      error_summary = null, lease_token = null, lease_expires_at = null,
      completed_at = now(), failed_at = null, updated_at = now()
  where id = selected_operation.id;

  update phase1_hiring_criteria_models
  set active_operation_id = null, updated_at = now()
  where requisition_id = selected_operation.requisition_id
    and active_operation_id = selected_operation.id;
end;
$$;

create or replace function fail_or_retry_phase1_hiring_criteria_operation(
  p_operation_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retryable boolean,
  p_retry_delay_seconds integer default 15
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_operation phase1_operations%rowtype;
  next_status text;
  safe_error text := left(coalesce(nullif(btrim(p_error), ''), 'Unknown Hiring Criteria extraction error.'), 1000);
begin
  select * into selected_operation
  from phase1_operations
  where id = p_operation_id and status = 'processing' and lease_token = p_lease_token
  for update;
  if selected_operation.id is null then return 'ignored'; end if;

  if p_retryable and selected_operation.attempt_count < 3 then
    next_status := 'queued';
    update phase1_operations
    set status = 'queued', stage = 'retrying', error_summary = safe_error,
        available_at = now() + make_interval(secs => greatest(1, least(p_retry_delay_seconds, 3600))),
        lease_token = null, lease_expires_at = null, updated_at = now()
    where id = selected_operation.id;
  else
    next_status := 'failed';
    update phase1_operations
    set status = 'failed', stage = 'failed', error_summary = safe_error,
        lease_token = null, lease_expires_at = null, failed_at = now(), updated_at = now()
    where id = selected_operation.id;
    update phase1_hiring_criteria_models
    set extraction_status = 'failed', extraction_error = safe_error,
        active_operation_id = null, updated_at = now()
    where requisition_id = selected_operation.requisition_id
      and active_operation_id = selected_operation.id;
  end if;
  return next_status;
end;
$$;

create or replace function fail_phase1_hiring_criteria_operation_dispatch(
  p_operation_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_requisition_id uuid;
  safe_error text := left(coalesce(nullif(btrim(p_error), ''), 'Hiring Criteria operation could not be queued.'), 1000);
begin
  update phase1_operations
  set status = 'failed', stage = 'failed', error_summary = safe_error,
      failed_at = now(), updated_at = now()
  where id = p_operation_id and status = 'queued'
  returning requisition_id into selected_requisition_id;

  if selected_requisition_id is not null then
    update phase1_hiring_criteria_models
    set extraction_status = 'failed', extraction_error = safe_error,
        active_operation_id = null, updated_at = now()
    where requisition_id = selected_requisition_id
      and active_operation_id = p_operation_id;
  end if;
end;
$$;

revoke all on function create_phase1_hiring_criteria_operation(uuid, text) from public, anon, authenticated;
revoke all on function claim_phase1_operation(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function complete_phase1_hiring_criteria_operation(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function fail_or_retry_phase1_hiring_criteria_operation(uuid, uuid, text, boolean, integer) from public, anon, authenticated;
revoke all on function fail_phase1_hiring_criteria_operation_dispatch(uuid, text) from public, anon, authenticated;
grant execute on function create_phase1_hiring_criteria_operation(uuid, text) to service_role;
grant execute on function claim_phase1_operation(uuid, uuid, integer) to service_role;
grant execute on function complete_phase1_hiring_criteria_operation(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function fail_or_retry_phase1_hiring_criteria_operation(uuid, uuid, text, boolean, integer) to service_role;
grant execute on function fail_phase1_hiring_criteria_operation_dispatch(uuid, text) to service_role;

notify pgrst, 'reload schema';

begin;

alter table phase1_operation_items drop constraint if exists phase1_operation_items_status_check;
alter table phase1_operation_items
  add constraint phase1_operation_items_status_check
  check (status in ('uploading', 'queued', 'processing', 'completed', 'failed', 'cancelled'));

alter table phase1_candidates add column if not exists operation_item_id uuid;
alter table phase1_evaluations add column if not exists operation_item_id uuid;
create unique index if not exists phase1_candidates_operation_item_key
  on phase1_candidates(operation_item_id) where operation_item_id is not null;
create unique index if not exists phase1_evaluations_operation_item_key
  on phase1_evaluations(operation_item_id) where operation_item_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'phase1_candidates_operation_item_fk') then
    alter table phase1_candidates add constraint phase1_candidates_operation_item_fk
      foreign key (operation_item_id) references phase1_operation_items(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase1_evaluations_operation_item_fk') then
    alter table phase1_evaluations add constraint phase1_evaluations_operation_item_fk
      foreign key (operation_item_id) references phase1_operation_items(id) on delete set null;
  end if;
end $$;

create or replace function refresh_phase1_resume_operation_rollup(p_operation_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  upload_count integer;
  queued_count integer;
  processing_count integer;
  completed_count integer;
  failed_count integer;
  total_count integer;
  next_status text;
  next_stage text;
begin
  select
    count(*) filter (where status = 'uploading'),
    count(*) filter (where status = 'queued'),
    count(*) filter (where status = 'processing'),
    count(*) filter (where status = 'completed'),
    count(*) filter (where status = 'failed'),
    count(*)
  into upload_count, queued_count, processing_count, completed_count, failed_count, total_count
  from phase1_operation_items where operation_id = p_operation_id;

  if total_count = 0 then
    next_status := 'failed'; next_stage := 'failed';
  elsif upload_count + queued_count + processing_count > 0 then
    next_status := case when processing_count + completed_count + failed_count > 0 then 'processing' else 'queued' end;
    next_stage := case when upload_count > 0 then 'uploading' else 'evaluating' end;
  elsif completed_count = total_count then
    next_status := 'completed'; next_stage := 'completed';
  elsif completed_count > 0 and failed_count > 0 then
    next_status := 'partially_completed'; next_stage := 'completed';
  else
    next_status := 'failed'; next_stage := 'failed';
  end if;

  update phase1_operations
  set status = next_status,
      stage = next_stage,
      progress_total = total_count,
      progress_current = completed_count + failed_count,
      result_summary = jsonb_build_object(
        'uploading', upload_count,
        'queued', queued_count,
        'processing', processing_count,
        'completed', completed_count,
        'failed', failed_count
      ),
      completed_at = case when next_status in ('completed', 'partially_completed') then coalesce(completed_at, now()) else null end,
      failed_at = case when next_status = 'failed' then coalesce(failed_at, now()) else null end,
      updated_at = now()
  where id = p_operation_id and operation_type = 'resume_batch_evaluation';
  return next_status;
end;
$$;

create or replace function create_phase1_resume_batch_operation(
  p_requisition_id uuid,
  p_client_batch_key text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_requisition phase1_requisitions%rowtype;
  selected_basis phase1_evaluation_bases%rowtype;
  selected_operation phase1_operations%rowtype;
  operation_key text;
  item_count integer;
  invalid_count integer;
begin
  if nullif(btrim(p_client_batch_key), '') is null or length(p_client_batch_key) > 200 then
    raise exception 'Resume batch identity is invalid.';
  end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Resume batch items are invalid.'; end if;
  item_count := jsonb_array_length(p_items);
  if item_count < 1 or item_count > 50 then raise exception 'A resume batch must contain between 1 and 50 files.'; end if;

  select count(*) into invalid_count
  from jsonb_to_recordset(p_items) as item(id text, filename text, mime_type text, size_bytes bigint, extension text)
  where id is null or id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or nullif(btrim(filename), '') is null or length(filename) > 255
    or size_bytes < 1 or size_bytes > 10485760
    or mime_type not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain')
    or extension not in ('.pdf','.docx','.txt');
  if invalid_count > 0 then raise exception 'Resume batch contains invalid file metadata.'; end if;
  if (select count(distinct item.id) from jsonb_to_recordset(p_items) as item(id text)) <> item_count then
    raise exception 'Resume batch item identities must be unique.';
  end if;

  perform pg_advisory_xact_lock(hashtext('resume-batch:' || p_requisition_id::text || ':' || p_client_batch_key));
  select * into selected_requisition from phase1_requisitions
  where id = p_requisition_id and archived_at is null for update;
  if selected_requisition.id is null or selected_requisition.current_evaluation_basis_id is null then
    raise exception 'Requisition does not have a current Evaluation Basis.';
  end if;
  select * into selected_basis from phase1_evaluation_bases
  where id = selected_requisition.current_evaluation_basis_id and requisition_id = p_requisition_id;
  if selected_basis.id is null then raise exception 'Current Evaluation Basis is unavailable.'; end if;

  operation_key := concat_ws(':', 'resume_batch_evaluation', p_requisition_id, p_client_batch_key);
  select * into selected_operation from phase1_operations where idempotency_key = operation_key for update;
  if selected_operation.id is null then
    insert into phase1_operations(
      operation_type,requisition_id,status,stage,progress_current,progress_total,input_snapshot,idempotency_key
    ) values (
      'resume_batch_evaluation',p_requisition_id,'queued','uploading',0,item_count,
      jsonb_build_object(
        'evaluationBasisId', selected_basis.id,
        'jobDescriptionHash', selected_basis.job_description_hash,
        'basisType', selected_basis.basis_type,
        'clientBatchKey', p_client_batch_key
      ),operation_key
    ) returning * into selected_operation;

    insert into phase1_operation_items(id,operation_id,item_key,status,input_ref)
    select
      item.id::uuid,
      selected_operation.id,
      item.id,
      'uploading',
      jsonb_build_object(
        'originalFilename', item.filename,
        'mimeType', item.mime_type,
        'sizeBytes', item.size_bytes,
        'extension', item.extension,
        'storagePath', concat(p_requisition_id, '/operations/', selected_operation.id, '/', item.id, '/source', item.extension),
        'uploaded', false
      )
    from jsonb_to_recordset(p_items) as item(id text, filename text, mime_type text, size_bytes bigint, extension text);
    perform refresh_phase1_resume_operation_rollup(selected_operation.id);
  end if;

  return jsonb_build_object(
    'id', selected_operation.id,
    'status', selected_operation.status,
    'evaluationBasisId', selected_operation.input_snapshot->>'evaluationBasisId',
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'itemKey', item_key) order by created_at), '[]'::jsonb)
              from phase1_operation_items where operation_id = selected_operation.id)
  );
end;
$$;

create or replace function mark_phase1_resume_item_uploaded(
  p_operation_id uuid,
  p_item_id uuid,
  p_content_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then raise exception 'Resume content hash is invalid.'; end if;
  update phase1_operation_items
  set status = 'queued', input_ref = input_ref || jsonb_build_object('contentHash', p_content_hash, 'uploaded', true),
      error_summary = null, available_at = now(), updated_at = now()
  where id = p_item_id and operation_id = p_operation_id and status = 'uploading';
  if not found then raise exception 'Resume operation item is not awaiting upload.'; end if;
  perform refresh_phase1_resume_operation_rollup(p_operation_id);
end;
$$;

create or replace function fail_phase1_resume_item_upload(
  p_operation_id uuid,
  p_item_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update phase1_operation_items
  set status = 'failed', error_summary = left(coalesce(nullif(btrim(p_error), ''), 'Resume upload failed.'), 1000),
      failed_at = now(), updated_at = now()
  where id = p_item_id and operation_id = p_operation_id and status in ('uploading','queued');
  perform refresh_phase1_resume_operation_rollup(p_operation_id);
end;
$$;

create or replace function claim_phase1_resume_operation_item(
  p_item_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 360
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_item phase1_operation_items%rowtype;
  selected_operation phase1_operations%rowtype;
  active_count integer;
begin
  if p_lease_token is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then raise exception 'Resume item lease is invalid.'; end if;
  perform pg_advisory_xact_lock(hashtext('resume-evaluation-capacity'));

  select * into selected_item from phase1_operation_items where id = p_item_id for update;
  if selected_item.id is null then return null; end if;
  select * into selected_operation from phase1_operations
  where id = selected_item.operation_id and operation_type = 'resume_batch_evaluation' for update;
  if selected_operation.id is null then return null; end if;

  if selected_item.attempt_count >= 3
    and (selected_item.status = 'queued' or (selected_item.status = 'processing' and selected_item.lease_expires_at < now())) then
    update phase1_operation_items set status='failed',
      error_summary=coalesce(error_summary,'Maximum resume evaluation attempts exhausted.'),
      lease_token=null,lease_expires_at=null,failed_at=now(),updated_at=now()
    where id=selected_item.id;
    perform refresh_phase1_resume_operation_rollup(selected_operation.id);
    return null;
  end if;

  if selected_item.status = 'queued' and selected_item.available_at > now() then
    return jsonb_build_object('deferred', true);
  end if;
  if not ((selected_item.status = 'queued' and selected_item.available_at <= now())
    or (selected_item.status = 'processing' and selected_item.lease_expires_at < now())) then return null; end if;
  select count(*) into active_count
  from phase1_operation_items active_item
  join phase1_operations active_operation on active_operation.id = active_item.operation_id
  where active_item.status='processing' and active_item.lease_expires_at > now()
    and active_item.id <> selected_item.id and active_operation.operation_type='resume_batch_evaluation';
  if active_count >= 3 then return jsonb_build_object('deferred', true); end if;

  update phase1_operation_items
  set status='processing',attempt_count=attempt_count+1,lease_token=p_lease_token,
      lease_expires_at=now()+make_interval(secs=>p_lease_seconds),started_at=coalesce(started_at,now()),updated_at=now()
  where id=selected_item.id returning * into selected_item;
  update phase1_operations set status='processing',stage='evaluating',started_at=coalesce(started_at,now()),updated_at=now()
  where id=selected_operation.id and status in ('queued','processing');

  return jsonb_build_object(
    'id',selected_item.id,'operationId',selected_operation.id,'requisitionId',selected_operation.requisition_id,
    'attemptCount',selected_item.attempt_count,'inputRef',selected_item.input_ref,'operationInput',selected_operation.input_snapshot
  );
end;
$$;

create or replace function complete_phase1_resume_operation_item(
  p_item_id uuid,
  p_lease_token uuid,
  p_full_name text,
  p_resume_text text,
  p_scores jsonb,
  p_verdict text,
  p_assessment jsonb,
  p_raw_model_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_item phase1_operation_items%rowtype;
  selected_operation phase1_operations%rowtype;
  v_candidate_id uuid;
  v_evaluation_id uuid;
  basis_id uuid;
begin
  select * into selected_item from phase1_operation_items
  where id=p_item_id and status='processing' and lease_token=p_lease_token for update;
  if selected_item.id is null or selected_item.lease_expires_at <= now() then raise exception 'Resume item lease is no longer authoritative.'; end if;
  select * into selected_operation from phase1_operations
  where id=selected_item.operation_id and operation_type='resume_batch_evaluation' for update;
  if selected_operation.id is null then raise exception 'Resume operation is unavailable.'; end if;
  basis_id := (selected_operation.input_snapshot->>'evaluationBasisId')::uuid;

  select id into v_candidate_id from phase1_candidates where operation_item_id=selected_item.id;
  if v_candidate_id is null then
    insert into phase1_candidates(
      requisition_id,full_name,source_filename,source_storage_path,source_mime_type,resume_text,operation_item_id
    ) values (
      selected_operation.requisition_id,coalesce(nullif(btrim(p_full_name),''),selected_item.input_ref->>'originalFilename'),
      selected_item.input_ref->>'originalFilename',selected_item.input_ref->>'storagePath',selected_item.input_ref->>'mimeType',
      p_resume_text,selected_item.id
    ) returning id into v_candidate_id;
  end if;

  select id into v_evaluation_id from phase1_evaluations where operation_item_id=selected_item.id;
  if v_evaluation_id is null then
    insert into phase1_evaluations(
      requisition_id,candidate_id,evaluation_basis_id,job_responsibilities_score,hard_skills_score,
      soft_skills_score,keyword_terminology_score,overall_match,verdict,assessment,raw_model_response,operation_item_id
    ) values (
      selected_operation.requisition_id,v_candidate_id,basis_id,
      (p_scores->>'responsibilities')::integer,(p_scores->>'hardSkills')::integer,
      (p_scores->>'softSkills')::integer,(p_scores->>'keywords')::integer,(p_scores->>'match')::integer,
      p_verdict,p_assessment,p_raw_model_response,selected_item.id
    ) returning id into v_evaluation_id;
  end if;

  update phase1_operation_items
  set status='completed',candidate_id=v_candidate_id,
      evaluation_id=v_evaluation_id,error_summary=null,
      lease_token=null,lease_expires_at=null,completed_at=now(),failed_at=null,updated_at=now()
  where id=selected_item.id;
  perform refresh_phase1_resume_operation_rollup(selected_operation.id);
  return jsonb_build_object('candidateId',v_candidate_id,'evaluationId',v_evaluation_id);
end;
$$;

create or replace function fail_or_retry_phase1_resume_operation_item(
  p_item_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retryable boolean,
  p_retry_delay_seconds integer default 15
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_item phase1_operation_items%rowtype;
  next_status text;
begin
  select * into selected_item from phase1_operation_items
  where id=p_item_id and status='processing' and lease_token=p_lease_token for update;
  if selected_item.id is null then return 'ignored'; end if;
  if p_retryable and selected_item.attempt_count < 3 then
    next_status := 'queued';
    update phase1_operation_items set status='queued',error_summary=left(p_error,1000),
      available_at=now()+make_interval(secs=>greatest(1,least(p_retry_delay_seconds,3600))),
      lease_token=null,lease_expires_at=null,updated_at=now() where id=selected_item.id;
  else
    next_status := 'failed';
    update phase1_operation_items set status='failed',error_summary=left(p_error,1000),
      lease_token=null,lease_expires_at=null,failed_at=now(),updated_at=now() where id=selected_item.id;
  end if;
  perform refresh_phase1_resume_operation_rollup(selected_item.operation_id);
  return next_status;
end;
$$;

create or replace function retry_phase1_resume_operation_items(p_operation_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare retried_ids uuid[];
begin
  with retried as (
    update phase1_operation_items
    set status='queued',attempt_count=0,error_summary=null,available_at=now(),
        lease_token=null,lease_expires_at=null,failed_at=null,updated_at=now()
    where operation_id=p_operation_id and status='failed'
      and input_ref->>'uploaded'='true' and nullif(input_ref->>'contentHash','') is not null
    returning id
  ) select array_agg(id) into retried_ids from retried;
  retried_ids := coalesce(retried_ids,'{}'::uuid[]);
  perform refresh_phase1_resume_operation_rollup(p_operation_id);
  return retried_ids;
end;
$$;

create or replace function fail_phase1_resume_item_dispatch(p_item_id uuid,p_error text)
returns void language plpgsql security definer set search_path=public as $$
declare selected_operation_id uuid;
begin
  update phase1_operation_items set status='failed',error_summary=left(coalesce(nullif(btrim(p_error),''),'Resume evaluation could not be queued.'),1000),
    failed_at=now(),updated_at=now() where id=p_item_id and status='queued' returning operation_id into selected_operation_id;
  if selected_operation_id is not null then perform refresh_phase1_resume_operation_rollup(selected_operation_id); end if;
end; $$;

revoke all on function refresh_phase1_resume_operation_rollup(uuid) from public,anon,authenticated;
revoke all on function create_phase1_resume_batch_operation(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function mark_phase1_resume_item_uploaded(uuid,uuid,text) from public,anon,authenticated;
revoke all on function fail_phase1_resume_item_upload(uuid,uuid,text) from public,anon,authenticated;
revoke all on function claim_phase1_resume_operation_item(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function complete_phase1_resume_operation_item(uuid,uuid,text,text,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function fail_or_retry_phase1_resume_operation_item(uuid,uuid,text,boolean,integer) from public,anon,authenticated;
revoke all on function retry_phase1_resume_operation_items(uuid) from public,anon,authenticated;
revoke all on function fail_phase1_resume_item_dispatch(uuid,text) from public,anon,authenticated;
grant execute on function refresh_phase1_resume_operation_rollup(uuid) to service_role;
grant execute on function create_phase1_resume_batch_operation(uuid,text,jsonb) to service_role;
grant execute on function mark_phase1_resume_item_uploaded(uuid,uuid,text) to service_role;
grant execute on function fail_phase1_resume_item_upload(uuid,uuid,text) to service_role;
grant execute on function claim_phase1_resume_operation_item(uuid,uuid,integer) to service_role;
grant execute on function complete_phase1_resume_operation_item(uuid,uuid,text,text,jsonb,text,jsonb,jsonb) to service_role;
grant execute on function fail_or_retry_phase1_resume_operation_item(uuid,uuid,text,boolean,integer) to service_role;
grant execute on function retry_phase1_resume_operation_items(uuid) to service_role;
grant execute on function fail_phase1_resume_item_dispatch(uuid,text) to service_role;

-- Communication/notes feature for the Hiring Workspace panel. No real
-- user accounts exist yet (only the shared site-password gate), so
-- each note carries a typed-in author_name rather than a user_id.
create table if not exists phase1_requisition_notes (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references phase1_requisitions(id) on delete cascade,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists phase1_requisition_notes_requisition_id_idx
  on phase1_requisition_notes (requisition_id, created_at);

alter table phase1_requisition_notes enable row level security;

notify pgrst, 'reload schema';
commit;
