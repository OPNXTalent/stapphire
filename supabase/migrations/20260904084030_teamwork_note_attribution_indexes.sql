create index if not exists phase1_requisition_notes_teamwork_participant_idx
  on public.phase1_requisition_notes (teamwork_participant_id)
  where teamwork_participant_id is not null;

create index if not exists phase1_candidate_teamwork_notes_participant_idx
  on public.phase1_candidate_teamwork_notes (teamwork_participant_id)
  where teamwork_participant_id is not null;
