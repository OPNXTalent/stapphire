import { notFound } from 'next/navigation';
import { ParticipantInterviewPreview } from '@/components/ParticipantInterviewPreview';
import type { InterviewStageId } from '@/lib/interviewQuestionBank';

const VALID_STAGES: InterviewStageId[] = ['phone-screen', 'round-1', 'round-2', 'final'];

export default function InterviewPreviewPage({
  params,
  searchParams
}: {
  params: { stage: string };
  searchParams: { candidate?: string; role?: string; candidateId?: string };
}) {
  if (!VALID_STAGES.includes(params.stage as InterviewStageId)) notFound();

  return (
    <ParticipantInterviewPreview
      stage={params.stage as InterviewStageId}
      candidateName={searchParams.candidate || 'Candidate'}
      positionTitle={searchParams.role || 'Position'}
      candidateId={searchParams.candidateId}
    />
  );
}
