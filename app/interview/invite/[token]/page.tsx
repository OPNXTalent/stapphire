import { notFound } from 'next/navigation';
import { ParticipantInterviewPreview } from '@/components/ParticipantInterviewPreview';
import type { InterviewStageId } from '@/lib/interviewQuestionBank';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

type SnapshotQuestion = {
  id: string;
  text: string;
  areas: string[];
};

type RoundSnapshot = {
  stage: InterviewStageId;
  title: string;
  questions: SnapshotQuestion[];
};

export default async function InterviewInvitationPage({ params }: { params: { token: string } }) {
  const { data: invitation, error } = await supabaseAdmin
    .from('phase1_interview_invitations')
    .select('id, candidate_id, requisition_id, stage, round_title, round_snapshot, participant_name, status, opened_at')
    .eq('token', params.token)
    .maybeSingle();

  if (error) throw error;
  if (!invitation || invitation.status === 'revoked') notFound();

  if (invitation.status === 'invited') {
    const now = new Date().toISOString();
    await supabaseAdmin
      .from('phase1_interview_invitations')
      .update({ status: 'opened', opened_at: now, updated_at: now })
      .eq('id', invitation.id)
      .eq('status', 'invited');
  }

  const [{ data: candidate }, { data: requisition }] = await Promise.all([
    supabaseAdmin.from('phase1_candidates').select('full_name').eq('id', invitation.candidate_id).maybeSingle(),
    supabaseAdmin.from('phase1_requisitions').select('title').eq('id', invitation.requisition_id).maybeSingle()
  ]);

  if (!candidate || !requisition) notFound();

  const snapshot = invitation.round_snapshot as RoundSnapshot;
  const questions = Array.isArray(snapshot?.questions) ? snapshot.questions : [];

  return (
    <ParticipantInterviewPreview
      stage={invitation.stage as InterviewStageId}
      candidateName={candidate.full_name}
      positionTitle={requisition.title}
      questions={questions}
      invitationToken={params.token}
      participantName={invitation.participant_name || ''}
      shareEnabled={false}
    />
  );
}
