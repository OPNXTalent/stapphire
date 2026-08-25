alter table public.phase1_interview_rounds
  add column if not exists branding jsonb not null default '{}'::jsonb;

alter table public.phase1_interview_rounds
  add constraint phase1_interview_rounds_branding_is_object
  check (jsonb_typeof(branding) = 'object');
