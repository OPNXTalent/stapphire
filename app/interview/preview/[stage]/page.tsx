import { notFound } from 'next/navigation';
import { ParticipantInterviewPreview } from '@/components/ParticipantInterviewPreview';
import { buildQuestionBank, INTERVIEW_STAGES } from '@/lib/interviewQuestionBank';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

type FormQuestion = { id: string; text: string; areas: string[] };

export default async function InterviewPreviewPage({
  params,
  searchParams
}: {
  params: { stage: string };
  searchParams: { candidate?: string; role?: string; candidateId?: string };
}) {
  const stage = decodeURIComponent(params.stage || '').trim();
  if (!stage) notFound();

  let interviewTitle = INTERVIEW_STAGES.find((item) => item.id === stage)?.label || 'Interview';
  let questions: FormQuestion[] | undefined;

  if (searchParams.candidateId) {
    const { data: candidate } = await supabaseAdmin
      .from('phase1_candidates')
      .select('requisition_id')
      .eq('id', searchParams.candidateId)
      .maybeSingle();

    if (candidate) {
      const { data: plan } = await supabaseAdmin
        .from('phase1_interview_plans')
        .select('id')
        .eq('requisition_id', candidate.requisition_id)
        .maybeSingle();

      if (plan) {
        const { data: round } = await supabaseAdmin
          .from('phase1_interview_rounds')
          .select('id, title')
          .eq('plan_id', plan.id)
          .eq('stage', stage)
          .maybeSingle();

        if (!round) notFound();
        interviewTitle = round.title;

        const { data: savedQuestions, error } = await supabaseAdmin
          .from('phase1_interview_questions')
          .select('id, question_text, areas, sort_order')
          .eq('round_id', round.id)
          .order('sort_order', { ascending: true });
        if (error) throw error;

        questions = (savedQuestions ?? []).map((question) => ({
          id: question.id,
          text: question.question_text,
          areas: question.areas ?? []
        }));
      }
    }
  }

  if (!questions) {
    const fallback = buildQuestionBank(searchParams.role || 'Position').filter((question) => question.stage === stage);
    if (fallback.length === 0 && !INTERVIEW_STAGES.some((item) => item.id === stage)) notFound();
    questions = fallback.map((question) => ({ id: question.id, text: question.text, areas: question.areas }));
  }

  return (
    <ParticipantInterviewPreview
      stage={stage}
      interviewTitle={interviewTitle}
      candidateName={searchParams.candidate || 'Candidate'}
      positionTitle={searchParams.role || 'Position'}
      candidateId={searchParams.candidateId}
      questions={questions}
    />
  );
}
