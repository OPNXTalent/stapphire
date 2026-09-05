begin;

alter table phase1_prospect_searches
  add column if not exists status text not null default 'completed'
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  add column if not exists stage text not null default 'completed',
  add column if not exists progress jsonb not null default '{}'::jsonb
    check (jsonb_typeof(progress) = 'object'),
  add column if not exists error_summary text,
  add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0),
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add constraint phase1_prospect_searches_lease_pair_check
    check ((lease_token is null) = (lease_expires_at is null));

update phase1_prospect_searches
set completed_at = coalesce(completed_at, created_at), updated_at = now()
where status = 'completed' and completed_at is null;

create index if not exists phase1_prospect_searches_active_idx
  on phase1_prospect_searches(status, updated_at)
  where status in ('queued', 'processing');

create table phase1_prospect_discoveries (
  id uuid primary key default uuid_generate_v4(),
  search_id uuid not null references phase1_prospect_searches(id) on delete cascade,
  requisition_id uuid not null references phase1_requisitions(id) on delete cascade,
  identity_key text not null check (nullif(btrim(identity_key), '') is not null),
  full_name text not null check (nullif(btrim(full_name), '') is not null),
  discovery_track text not null check (nullif(btrim(discovery_track), '') is not null),
  discovery_data jsonb not null check (jsonb_typeof(discovery_data) = 'object'),
  status text not null default 'discovered'
    check (status in ('discovered', 'screening', 'qualified', 'rejected')),
  rejection_reason text,
  screen_attempts integer not null default 0 check (screen_attempts >= 0),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (search_id, identity_key)
);

create index phase1_prospect_discoveries_search_status_idx
  on phase1_prospect_discoveries(search_id, status, created_at);
create index phase1_prospect_discoveries_requisition_idx
  on phase1_prospect_discoveries(requisition_id);

alter table phase1_prospect_discoveries enable row level security;
revoke all on table phase1_prospect_discoveries from public, anon, authenticated;
grant select, insert, update, delete on table phase1_prospect_discoveries to service_role;

create or replace function claim_phase1_prospect_search_v1(
  p_search_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 330
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  if p_lease_token is null or p_lease_seconds < 30 or p_lease_seconds > 600 then
    raise exception 'Prospect search lease is invalid.';
  end if;

  update phase1_prospect_searches
  set status = 'processing',
      attempt_count = attempt_count + 1,
      lease_token = p_lease_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = p_search_id
    and status in ('queued', 'processing')
    and (lease_token is null or lease_expires_at < now())
  returning id into claimed_id;

  return claimed_id is not null;
end;
$$;

create or replace function release_phase1_prospect_search_v1(
  p_search_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  released_id uuid;
begin
  update phase1_prospect_searches
  set lease_token = null, lease_expires_at = null, updated_at = now()
  where id = p_search_id and lease_token = p_lease_token
  returning id into released_id;
  return released_id is not null;
end;
$$;

revoke all on function claim_phase1_prospect_search_v1(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function release_phase1_prospect_search_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function claim_phase1_prospect_search_v1(uuid, uuid, integer) to service_role;
grant execute on function release_phase1_prospect_search_v1(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
