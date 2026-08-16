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
