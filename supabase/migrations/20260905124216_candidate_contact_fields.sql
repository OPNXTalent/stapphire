alter table public.phase1_candidates
  add column if not exists primary_email text,
  add column if not exists primary_phone_display text,
  add column if not exists primary_phone_e164 text,
  add column if not exists linkedin_profile_url text,
  add column if not exists contact_extraction_version text;

comment on column public.phase1_candidates.primary_email is 'Primary candidate email extracted from the candidate-supplied resume.';
comment on column public.phase1_candidates.primary_phone_display is 'Human-readable candidate phone number extracted from the candidate-supplied resume.';
comment on column public.phase1_candidates.primary_phone_e164 is 'Dialable candidate phone number normalized from the candidate-supplied resume.';
comment on column public.phase1_candidates.linkedin_profile_url is 'Validated HTTPS LinkedIn profile URL supplied in the candidate resume.';
comment on column public.phase1_candidates.contact_extraction_version is 'Version of the deterministic resume contact extractor used for these fields.';
