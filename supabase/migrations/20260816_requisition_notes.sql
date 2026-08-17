-- Communication/notes feature for the Hiring Workspace panel. No real
-- user accounts exist yet (only the shared site-password gate), so
-- each note carries a typed-in author_name rather than a user_id -
-- consistent with how the rest of this schema handles identity before
-- real auth exists.

create table if not exists phase1_requisition_notes (
  id uuid primary key default uuid_generate_v4(),
  requisition_id uuid not null references phase1_requisitions(id) on delete cascade,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists phase1_requisition_notes_requisition_id_idx
  on phase1_requisition_notes (requisition_id, created_at);

alter table phase1_requisition_notes enable row level security;

notify pgrst, 'reload schema';
