-- Stapphire schema
-- Run this in a NEW Supabase project. Do not run against the Prism project.

create extension if not exists "uuid-ossp";

-- ── Organizations / users ────────────────────────────────────────
-- Uses Supabase Auth (auth.users) as the identity source. This table
-- holds app-specific profile + org membership.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null,
  full_name text,
  role text not null default 'recruiter' check (role in ('recruiter','hiring_manager','admin')),
  created_at timestamptz not null default now()
);

create table organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  credits_remaining integer not null default 0,
  credits_total integer not null default 0,
  credits_refill_at date,
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

-- ── Core object 1: Open Requisition ─────────────────────────────
create table requisitions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  status text not null default 'open' check (status in ('open','on_hold','filled')),
  job_description text not null,
  -- parsed once at creation; drives Evaluation Signals + Matrix filters
  evaluation_pillars jsonb,
  -- per-requisition configurable, defaults empty — no hardcoded customer data
  employer_watchlist text[] not null default '{}',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ── Core object 2: Candidate (normalized profile, not the raw PDF) ─
create table candidates (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references requisitions(id) on delete cascade,
  full_name text not null,
  source_filename text,
  original_file_url text, -- Supabase Storage path; "Download Original Resume"
  -- content fingerprint for duplicate detection — never re-evaluate a match
  content_hash text not null,
  document_type text not null default 'resume' check (document_type in ('resume','non_resume')),
  created_at timestamptz not null default now(),
  -- soft delete — deleted candidates go to trash and stay recoverable
  -- until the trash is explicitly emptied
  deleted_at timestamptz,
  unique (requisition_id, content_hash)
);

-- ── Core object 3: Evaluation (immutable — evidence, not verdict) ──
create table evaluations (
  id uuid primary key default uuid_generate_v4(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  requisition_id uuid not null references requisitions(id) on delete cascade,

  overall_match integer not null,
  status text not null check (status in ('greenlight','consider','decline')),

  scores jsonb not null,              -- job_responsibilities, hard_skills, soft_skills, keyword_relevance
  signals jsonb not null,             -- resume_confidence, evidence_quality, location_fit, employment_status, timeline_review, certifications
  strengths text[] not null default '{}',
  gaps text[] not null default '{}',
  ats_compatibility jsonb,
  employment_history jsonb,           -- watchlist_match, gaps, short_tenure_roles
  risk_flags text[] not null default '{}',
  interview_recommendations jsonb,
  matrix_dimensions jsonb,            -- JD-specific comparison columns

  raw_model_response jsonb,           -- full response, retained for audit trail
  created_at timestamptz not null default now()
);

-- ── Core object 4: Collaboration (quiet process history — append-only) ─
create table collaboration_events (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references requisitions(id) on delete cascade,
  candidate_id uuid references candidates(id) on delete cascade,
  actor_id uuid references profiles(id),
  event_type text not null check (event_type in ('shared','viewed','commented','decision')),
  comment text,
  decision text check (decision in ('advance','hold','decline')),
  created_at timestamptz not null default now()
);
-- append-only by convention: no update/delete policy is granted below.

-- ── Private notes (recruiter-only, never visible to hiring managers) ─
create table notes (
  id uuid primary key default uuid_generate_v4(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  author_id uuid references profiles(id),
  body text not null,
  updated_at timestamptz not null default now()
);

-- ── Requisition sharing / permission tiers ──────────────────────
create table requisition_shares (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references requisitions(id) on delete cascade,
  shared_with_email text not null,
  access_level text not null check (access_level in ('read_only','read_explore','collaborate')),
  invited_by uuid references profiles(id),
  accepted boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── Credit ledger (audit trail for billing) ─────────────────────
create table credit_transactions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  amount integer not null,          -- negative = consumed, positive = purchased/refilled
  reason text not null,             -- 'resume_evaluation' | 'stripe_purchase' | 'monthly_refill'
  candidate_id uuid references candidates(id),
  stripe_event_id text,
  created_at timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────
create index idx_candidates_requisition on candidates(requisition_id);
create index idx_evaluations_candidate on evaluations(candidate_id);
create index idx_evaluations_requisition on evaluations(requisition_id);
create index idx_collab_requisition on collaboration_events(requisition_id);
create index idx_notes_candidate on notes(candidate_id);

-- ── Atomic credit decrement (called from the evaluate API route) ──
create or replace function decrement_credit_and_log(p_org_id uuid, p_candidate_id uuid)
returns void as $$
begin
  update organizations
  set credits_remaining = credits_remaining - 1
  where id = p_org_id and credits_remaining > 0;

  if not found then
    raise exception 'No credits remaining for org %', p_org_id;
  end if;

  insert into credit_transactions (org_id, amount, reason, candidate_id)
  values (p_org_id, -1, 'resume_evaluation', p_candidate_id);
end;
$$ language plpgsql security definer;

-- ── Atomic credit addition (called from the Stripe webhook) ───────
create or replace function add_credits_and_log(p_org_id uuid, p_amount integer, p_stripe_event_id text)
returns void as $$
begin
  update organizations
  set credits_remaining = credits_remaining + p_amount,
      credits_total = credits_total + p_amount
  where id = p_org_id;

  insert into credit_transactions (org_id, amount, reason, stripe_event_id)
  values (p_org_id, p_amount, 'stripe_purchase', p_stripe_event_id);
end;
$$ language plpgsql security definer;

-- ── Row Level Security ───────────────────────────────────────────
-- Policies are intentionally left for you to finalize against your auth
-- model, but RLS is turned on here so nothing is open-by-default.
alter table requisitions enable row level security;
alter table candidates enable row level security;
alter table evaluations enable row level security;
alter table collaboration_events enable row level security;
alter table notes enable row level security;
alter table requisition_shares enable row level security;
alter table credit_transactions enable row level security;
