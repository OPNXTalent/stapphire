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

-- Backward-compatible addition for databases created before ranking existed.
alter table phase1_candidates add column if not exists rank_order integer;
alter table phase1_candidates drop constraint if exists phase1_candidates_rank_order_check;
alter table phase1_candidates add constraint phase1_candidates_rank_order_check check (rank_order is null or rank_order >= 1);

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

