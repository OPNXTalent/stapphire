-- Candidate-level notes are deliberately split into two stores:
-- 1) recruiter-private notes, never surfaced in Teamwork/shared views
-- 2) Teamwork notes, intended for hiring-team collaboration
--
-- Stapphire does not have individual user accounts/roles yet, so author
-- identity is typed-in and privacy is enforced structurally by separate
-- tables/API surfaces until role-based auth is introduced.

create table if not exists phase1_candidate_private_notes (
  id uuid primary key default uuid_generate_v4(),
  candidate_id uuid not null references phase1_candidates(id) on delete cascade,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists phase1_candidate_private_notes_candidate_id_idx
  on phase1_candidate_private_notes (candidate_id, created_at);

alter table phase1_candidate_private_notes enable row level security;

create table if not exists phase1_candidate_teamwork_notes (
  id uuid primary key default uuid_generate_v4(),
  candidate_id uuid not null references phase1_candidates(id) on delete cascade,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists phase1_candidate_teamwork_notes_candidate_id_idx
  on phase1_candidate_teamwork_notes (candidate_id, created_at);

alter table phase1_candidate_teamwork_notes enable row level security;

notify pgrst, 'reload schema';
