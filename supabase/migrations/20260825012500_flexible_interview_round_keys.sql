alter table public.phase1_interview_rounds drop constraint if exists phase1_interview_rounds_stage_check;
alter table public.phase1_interview_rounds add constraint phase1_interview_rounds_stage_flexible_check check (nullif(btrim(stage), '') is not null and length(stage) <= 120);

alter table public.phase1_interview_invitations drop constraint if exists phase1_interview_invitations_stage_check;
alter table public.phase1_interview_invitations add constraint phase1_interview_invitations_stage_flexible_check check (nullif(btrim(stage), '') is not null and length(stage) <= 120);
