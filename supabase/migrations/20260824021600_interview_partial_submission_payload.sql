alter table public.phase1_interview_invitations
  add column if not exists submission_payload jsonb;

alter table public.phase1_interview_invitations
  add constraint phase1_interview_invitations_submission_payload_object
  check (submission_payload is null or jsonb_typeof(submission_payload) = 'object');
