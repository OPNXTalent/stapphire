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
  -- The Hiring Decision Model — a living structure, not a static JD
  -- parse. Shape: { categories: [{ name, weight, subcriteria: [{ name,
  -- weight, source: string[] }] }] }. Categories are always exactly the
  -- fixed five (Core Responsibilities, Minimum & Preferred
  -- Qualifications, Hard Skills, Soft Skills, Keyword & Terminology
  -- Relevance); only their subcriteria and weights evolve through
  -- discovery. Always current — history lives in hiring_profile_revisions.
  evaluation_pillars jsonb,
  -- increments every time the Hiring Profile actually changes; each
  -- evaluation records which revision it was measured against
  profile_revision integer not null default 1,
  -- per-requisition configurable, defaults empty — no hardcoded customer data
  employer_watchlist text[] not null default '{}',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  -- unguessable token for the read-only external share link — never
  -- exposes credits, billing, or Private Notes to whoever holds it
  share_token uuid unique not null default uuid_generate_v4(),
  -- archived — set aside from the active list, fully recoverable.
  -- Unlike candidate trash, there is no permanent-deletion path for
  -- requisitions; archiving is a soft, non-destructive action.
  archived_at timestamptz,
  -- superseded by the Hiring Profile / discovery model — kept for
  -- backward compatibility with rows written before that existed
  evaluation_priorities text
);

-- ── Hiring Profile revision history ──────────────────────────────
-- Append-only. Every time discovery materially changes the model, a
-- new row captures the complete resulting snapshot alongside what
-- changed and why — the Job Description is the seed, this is the
-- evolving record of shared understanding built on top of it.
create table hiring_profile_revisions (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references requisitions(id) on delete cascade,
  revision integer not null,
  source text not null check (source in (
    'job_description','recruiter_discovery','hiring_leader_discovery','joint_calibration'
  )),
  change_summary text,
  profile_snapshot jsonb not null,  -- full { categories: [...] } after this revision
  changes jsonb,                    -- [{ criterion, action, old_weight, new_weight, reason }]
  created_at timestamptz not null default now(),
  unique (requisition_id, revision)
);
create index idx_hpr_requisition on hiring_profile_revisions(requisition_id, revision);

-- ── Discovery conversation ────────────────────────────────────────
-- The chat thread that shapes the Hiring Profile over time — kept
-- distinct from Collaboration (which is about candidates, not the
-- role definition itself).
create table discovery_messages (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references requisitions(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index idx_discovery_requisition on discovery_messages(requisition_id, created_at);

-- ── Per-candidate discovery conversation ─────────────────────────
-- Mirrors discovery_messages but scoped to one candidate — a free,
-- conversational way to build up Additional Candidate Context, with
-- the same acknowledge-and-suggest pattern as the Hiring Discovery
-- chat. This chat itself never costs a credit; actually re-scoring the
-- candidate against what's discussed here stays a separate, explicit
-- Re-evaluate action.
create table candidate_discovery_messages (
  id uuid primary key default uuid_generate_v4(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index idx_cand_discovery_candidate on candidate_discovery_messages(candidate_id, created_at);

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
  -- human-set pipeline stage — separate from the AI's evaluation status.
  -- The AI's greenlight/consider/decline is evidence; this is a decision.
  disposition text check (disposition is null or disposition in (
    'phone_screen','interview','second_interview','third_interview','final_interview',
    'make_offer','onboarding','hired','withdrew','did_not_select'
  )),
  -- recruiter/hiring-manager knowledge not reflected in the résumé —
  -- becomes active evaluation evidence, not a passive note. Freely
  -- editable; the value USED for any given evaluation is preserved on
  -- that evaluation row (additional_context_snapshot) for provenance,
  -- since this field itself is mutable going forward.
  additional_context text,
  unique (requisition_id, content_hash)
);

-- ── Core object 3: Evaluation (immutable — evidence, not verdict) ──
create table evaluations (
  id uuid primary key default uuid_generate_v4(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  requisition_id uuid not null references requisitions(id) on delete cascade,

  -- Job Description Match vs Hiring Profile Match — the two can
  -- diverge meaningfully as discovery refines the model beyond the
  -- original JD. overall_match is the Profile Match (the current
  -- standard); job_description_match is against the original JD alone.
  overall_match integer not null,
  job_description_match integer,
  -- which Hiring Profile revision this evaluation was measured
  -- against — evaluations from before this existed have no revision.
  profile_revision integer,
  -- Additional Candidate Context is mutable on the candidate, so each
  -- evaluation preserves exactly what was in effect when it ran —
  -- provenance, not a live pointer to whatever the field says now.
  additional_context_snapshot text,
  -- newly_established / strengthened / still_unverified / new_concerns
  -- — only populated when additional context materially affected this
  -- evaluation; otherwise null, not an empty shell.
  context_assessment jsonb,
  -- set when the résumé alone materially underrepresents the
  -- candidate's actual fit once additional context is factored in
  resume_gap_flag text,
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
  -- freeform display name — used until there's a real login system to
  -- attach comments to. Anyone with a share link can self-identify.
  actor_name text,
  event_type text not null check (event_type in ('shared','viewed','commented','decision')),
  comment text,
  decision text check (decision is null or decision in (
    'advance','hold','decline',
    'phone_screen','interview','second_interview','third_interview','final_interview',
    'make_offer','onboarding','hired','withdrew','did_not_select'
  )),
  -- optional document shared alongside a comment
  attachment_path text,
  attachment_filename text,
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

-- ── Authenticated collaborator display names ────────────────────
-- Kept separate from the org-scoped `profiles` table since a
-- collaborator (hiring manager) doesn't belong to an org themselves —
-- they just have real login access to specific requisitions someone
-- else's org granted them, via requisition_shares.
create table collaborator_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  created_at timestamptz not null default now()
);

-- ── Lightweight identity for share-link visitors ────────────────
-- Not a real login (no password) — a quick name-gate so a collaborator
-- arriving via a share link has a real, fixed database record instead
-- of a freely-editable text field. Real authenticated accounts remain
-- a separate, larger piece of future work.
create table share_collaborators (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references requisitions(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- ── Credit ledger (audit trail for billing) ─────────────────────
create table credit_transactions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  amount integer not null,          -- negative = consumed, positive = purchased/refilled
  reason text not null,             -- 'resume_evaluation' | 'stripe_purchase' | 'monthly_refill'
  candidate_id uuid references candidates(id) on delete set null,
  stripe_event_id text,
  created_at timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────
create index idx_candidates_requisition on candidates(requisition_id);
create index idx_evaluations_candidate on evaluations(candidate_id);
create index idx_evaluations_requisition on evaluations(requisition_id);
create index idx_collab_requisition on collaboration_events(requisition_id);
create index idx_notes_candidate on notes(candidate_id);

-- ── Free trial usage (rolling 24h window, no paid credits required) ─
-- Orgs with 0 paid credits can still evaluate up to 5 resumes per
-- rolling 24 hours, tracked here rather than as a fixed pool.
create table free_trial_usage (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  used_at timestamptz not null default now()
);
create index idx_free_trial_usage_org on free_trial_usage(org_id, used_at);

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
