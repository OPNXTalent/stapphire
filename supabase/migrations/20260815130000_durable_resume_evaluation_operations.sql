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

notify pgrst, 'reload schema';
commit;
