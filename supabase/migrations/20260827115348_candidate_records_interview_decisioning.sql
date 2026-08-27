create table if not exists public.phase1_candidate_uploads (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.phase1_candidates(id) on delete cascade,
  folder_key text not null default 'uploads'
    check (folder_key = 'uploads' or folder_key like 'custom-%'),
  filename text not null check (nullif(btrim(filename), '') is not null and length(filename) <= 255),
  storage_path text not null unique,
  mime_type text not null check (nullif(btrim(mime_type), '') is not null),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  created_at timestamptz not null default now()
);

create index if not exists phase1_candidate_uploads_candidate_folder_idx
  on public.phase1_candidate_uploads(candidate_id, folder_key, created_at desc);

alter table public.phase1_candidate_uploads enable row level security;
revoke all on table public.phase1_candidate_uploads from public, anon, authenticated;
grant select, insert, update, delete on table public.phase1_candidate_uploads to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('candidate-files', 'candidate-files', false, 26214400)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create table if not exists public.phase1_resume_content_claims (
  requisition_id uuid not null references public.phase1_requisitions(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  operation_item_id uuid not null unique references public.phase1_operation_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requisition_id, content_hash)
);

alter table public.phase1_resume_content_claims enable row level security;
revoke all on table public.phase1_resume_content_claims from public, anon, authenticated;
grant select, insert, delete on table public.phase1_resume_content_claims to service_role;

insert into public.phase1_resume_content_claims (requisition_id, content_hash, operation_item_id, created_at)
select distinct on (operation.requisition_id, item.input_ref->>'contentHash')
  operation.requisition_id,
  item.input_ref->>'contentHash',
  item.id,
  item.created_at
from public.phase1_operation_items item
join public.phase1_operations operation on operation.id = item.operation_id
where operation.operation_type = 'resume_batch_evaluation'
  and item.input_ref->>'uploaded' = 'true'
  and item.input_ref->>'contentHash' ~ '^[0-9a-f]{64}$'
order by operation.requisition_id, item.input_ref->>'contentHash', item.created_at, item.id
on conflict do nothing;

drop function if exists public.mark_phase1_resume_item_uploaded(uuid, uuid, text);

create function public.mark_phase1_resume_item_uploaded(
  p_operation_id uuid,
  p_item_id uuid,
  p_content_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_requisition_id uuid;
begin
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Resume content hash is invalid.';
  end if;

  select requisition_id into selected_requisition_id
  from public.phase1_operations
  where id = p_operation_id and operation_type = 'resume_batch_evaluation'
  for update;
  if selected_requisition_id is null then raise exception 'Resume operation is unavailable.'; end if;

  insert into public.phase1_resume_content_claims(requisition_id, content_hash, operation_item_id)
  values (selected_requisition_id, p_content_hash, p_item_id)
  on conflict (requisition_id, content_hash) do nothing;

  if not found then
    delete from public.phase1_operation_items
    where id = p_item_id and operation_id = p_operation_id and status = 'uploading';
    delete from public.phase1_operations operation
    where operation.id = p_operation_id
      and not exists (
        select 1 from public.phase1_operation_items item where item.operation_id = operation.id
      );
    perform public.refresh_phase1_resume_operation_rollup(p_operation_id);
    return false;
  end if;

  update public.phase1_operation_items
  set status = 'queued',
      input_ref = input_ref || jsonb_build_object('contentHash', p_content_hash, 'uploaded', true),
      error_summary = null,
      available_at = now(),
      updated_at = now()
  where id = p_item_id and operation_id = p_operation_id and status = 'uploading';
  if not found then
    delete from public.phase1_resume_content_claims where operation_item_id = p_item_id;
    raise exception 'Resume operation item is not awaiting upload.';
  end if;
  perform public.refresh_phase1_resume_operation_rollup(p_operation_id);
  return true;
end;
$$;

revoke all on function public.mark_phase1_resume_item_uploaded(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_phase1_resume_item_uploaded(uuid, uuid, text) to service_role;
