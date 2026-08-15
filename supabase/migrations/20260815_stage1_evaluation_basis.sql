begin;

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

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
  if not exists (select 1 from pg_constraint where conname = 'phase1_evaluation_bases_hiring_criteria_version_fk') then
    alter table phase1_evaluation_bases
      add constraint phase1_evaluation_bases_hiring_criteria_version_fk
      foreign key (hiring_criteria_version_id)
      references phase1_hiring_criteria_versions(id) on delete cascade;
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

commit;
