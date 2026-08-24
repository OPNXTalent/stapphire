create table if not exists public.phase1_interview_invitations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.phase1_candidates(id) on delete cascade,
  requisition_id uuid not null references public.phase1_requisitions(id) on delete cascade,
  interview_round_id uuid references public.phase1_interview_rounds(id) on delete set null,
  stage text not null check (stage in ('phone-screen', 'round-1', 'round-2', 'final')),
  round_title text not null,
  plan_revision integer not null check (plan_revision > 0),
  round_snapshot jsonb not null check (jsonb_typeof(round_snapshot) = 'object'),
  token uuid not null default gen_random_uuid() unique,
  participant_name text,
  status text not null default 'invited' check (status in ('invited', 'opened', 'submitted', 'revoked')),
  invited_at timestamptz not null default now(),
  opened_at timestamptz,
  submitted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists phase1_interview_invitations_candidate_stage_idx
  on public.phase1_interview_invitations(candidate_id, stage);

create index if not exists phase1_interview_invitations_status_idx
  on public.phase1_interview_invitations(status);

alter table public.phase1_interview_invitations enable row level security;
revoke all on table public.phase1_interview_invitations from anon, authenticated;
grant select, insert, update, delete on table public.phase1_interview_invitations to service_role;
