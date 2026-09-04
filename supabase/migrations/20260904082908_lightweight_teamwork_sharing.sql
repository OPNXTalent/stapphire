-- Requisition-scoped, bearer-link Teamwork sharing without collaborator accounts.
-- All access remains server mediated through service_role routes. The public token
-- identifies exactly one requisition; a separate opaque browser session attributes
-- contributor activity after the lightweight "Who's joining?" gate.

-- This table existed in the application migration set but was absent from the
-- deployed Phase 1 schema. Create it idempotently so the existing recruiter
-- Teamwork rail and the shared workspace use the same requisition thread.
create table if not exists public.phase1_requisition_notes (
  id uuid primary key default extensions.uuid_generate_v4(),
  requisition_id uuid not null references public.phase1_requisitions(id) on delete cascade,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists phase1_requisition_notes_requisition_id_idx
  on public.phase1_requisition_notes (requisition_id, created_at);

alter table public.phase1_requisition_notes enable row level security;
revoke all on table public.phase1_requisition_notes from public, anon, authenticated;
grant select, insert, update, delete on table public.phase1_requisition_notes to service_role;

create table if not exists public.phase1_teamwork_shares (
  id uuid primary key default extensions.uuid_generate_v4(),
  requisition_id uuid not null references public.phase1_requisitions(id) on delete cascade,
  public_token uuid not null unique default extensions.uuid_generate_v4(),
  invited_by_name text not null check (char_length(btrim(invited_by_name)) between 1 and 80),
  access_level text not null default 'contributor' check (access_level in ('viewer', 'contributor')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists phase1_teamwork_shares_requisition_idx
  on public.phase1_teamwork_shares (requisition_id, created_at desc);

create table if not exists public.phase1_teamwork_participants (
  id uuid primary key default extensions.uuid_generate_v4(),
  share_id uuid not null references public.phase1_teamwork_shares(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  context_role text not null check (context_role in ('hiring_manager', 'interviewer', 'department_leader', 'hr_ta', 'executive_sponsor', 'other')),
  session_token_hash text not null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists phase1_teamwork_participants_share_idx
  on public.phase1_teamwork_participants (share_id, joined_at desc);

alter table public.phase1_requisition_notes
  add column if not exists teamwork_participant_id uuid references public.phase1_teamwork_participants(id) on delete set null;

alter table public.phase1_candidate_teamwork_notes
  add column if not exists teamwork_participant_id uuid references public.phase1_teamwork_participants(id) on delete set null;

alter table public.phase1_teamwork_shares enable row level security;
alter table public.phase1_teamwork_participants enable row level security;

revoke all on table public.phase1_teamwork_shares, public.phase1_teamwork_participants from public, anon, authenticated;
grant select, insert, update, delete on table public.phase1_teamwork_shares, public.phase1_teamwork_participants to service_role;

notify pgrst, 'reload schema';
