import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { CandidateDetailActions } from '@/components/CandidateDetailActions';
import { CompletedInterviewActions } from '@/components/CompletedInterviewActions';
import { AutoPrint } from '@/components/AutoPrint';
import styles from './readOnlyInterview.module.css';

export const dynamic = 'force-dynamic';

type SnapshotQuestion = {
  id: string;
  text: string;
  areas: string[];
  commentBox?: boolean;
  yesNo?: boolean;
};

type RoundSnapshot = {
  title?: string;
  questions?: SnapshotQuestion[];
};

type SubmissionPayload = {
  ratings?: Record<string, number>;
  questionComments?: Record<string, string>;
  yesNoResponses?: Record<string, 'yes' | 'no'>;
  comments?: string;
  recommendation?: string;
};

function submittedTimestamp(iso: string | null) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso));
}

export default async function CompletedInterviewPage({
  params,
  searchParams
}: {
  params: { id: string; invitationId: string };
  searchParams?: { print?: string };
}) {
  const { data: invitation, error } = await supabaseAdmin
    .from('phase1_interview_invitations')
    .select('id, candidate_id, requisition_id, stage, round_title, round_snapshot, participant_name, submission_payload, status, submitted_at')
    .eq('id', params.invitationId)
    .eq('candidate_id', params.id)
    .maybeSingle();

  if (error) throw error;
  if (!invitation || invitation.status !== 'submitted') notFound();

  const [{ data: candidate }, { data: requisition }] = await Promise.all([
    supabaseAdmin.from('phase1_candidates').select('full_name, source_filename, source_storage_path').eq('id', invitation.candidate_id).maybeSingle(),
    supabaseAdmin.from('phase1_requisitions').select('title').eq('id', invitation.requisition_id).maybeSingle()
  ]);

  if (!candidate || !requisition) notFound();

  const snapshot = (invitation.round_snapshot ?? {}) as RoundSnapshot;
  const submission = (invitation.submission_payload ?? {}) as SubmissionPayload;
  const questions = Array.isArray(snapshot.questions) ? snapshot.questions : [];
  const ratings = submission.ratings ?? {};
  const questionComments = submission.questionComments ?? {};
  const yesNoResponses = submission.yesNoResponses ?? {};
  const href = `/candidates/${params.id}/interviews/${params.invitationId}`;
  const backToCandidateHref = `/requisitions/${invitation.requisition_id}?view=candidates&candidate=${params.id}`;
  // ?print=1 opens a dedicated, disposable print-session tab (see
  // AutoPrint) - it exists only to run the browser print dialog and
  // then close itself. It must never hydrate the Candidate Files/
  // Teamwork workspace rail, or it becomes a second, fully interactive
  // Stapphire instance instead of a tab that closes when printing ends.
  const isPrintSession = searchParams?.print === '1';

  return (
    <main className={`${styles.page} print-document`}>
      {isPrintSession && <AutoPrint />}
      {!isPrintSession && (
        <CandidateDetailActions
          candidateId={params.id}
          candidateName={candidate.full_name}
          sourceFilename={String(candidate.source_filename || '')}
          resumeAvailable={Boolean(candidate.source_storage_path)}
          focusInterviewId={params.invitationId}
        />
      )}
      <div className={styles.topRow}>
        <a href={backToCandidateHref} className={styles.back}>← Back to candidate</a>
        <div className={styles.topActions}>
          <CompletedInterviewActions href={href} />
          <span className={styles.locked}>READ ONLY</span>
        </div>
      </div>

      <header className={styles.header}>
        <span className={styles.eyebrow}>Completed interview assessment</span>
        <h1>{invitation.round_title || snapshot.title || 'Interview'}</h1>
        <div className={styles.meta}>
          <span><strong>Candidate</strong>{candidate.full_name}</span>
          <span><strong>Position</strong>{requisition.title}</span>
          <span><strong>Interview stage</strong>{invitation.stage}</span>
          <span><strong>Participant</strong>{invitation.participant_name || 'Not recorded'}</span>
          <span><strong>Submitted</strong>{submittedTimestamp(invitation.submitted_at)}</span>
        </div>
      </header>

      <section className={styles.questions}>
        {questions.map((question, index) => (
          <article className={styles.question} key={question.id}>
            <div className={styles.questionHead}>
              <span>Q{index + 1}</span>
              <h2>{question.text}</h2>
            </div>
            {(question.areas ?? []).length > 0 && <div className={styles.ratings}>
              {(question.areas ?? []).map((area) => {
                const value = Number(ratings[`${question.id}:${area}`] ?? 0);
                const stars = Number.isInteger(value) && value >= 1 && value <= 5
                  ? `${'★'.repeat(value)}${'☆'.repeat(5 - value)}`
                  : '';
                return (
                  <div className={styles.ratingRow} key={area}>
                    <span>{area}</span>
                    <strong>{stars ? `${stars} ${value} / 5` : 'Not rated'}</strong>
                  </div>
                );
              })}
            </div>}
            {question.yesNo && (
              <div className={styles.ratingRow}>
                <span>Response</span>
                <strong>{yesNoResponses[question.id] === 'yes' ? 'Yes' : yesNoResponses[question.id] === 'no' ? 'No' : 'Not answered'}</strong>
              </div>
            )}
            {question.commentBox && questionComments[question.id]?.trim() && (
              <div className={styles.assessmentBlock}>
                <strong>Comments</strong>
                <p>{questionComments[question.id]}</p>
              </div>
            )}
          </article>
        ))}
      </section>

      <section className={styles.assessment}>
        <h2>Interview Assessment</h2>
        <div className={styles.assessmentBlock}>
          <strong>Overall Comments</strong>
          <p>{submission.comments || 'No comments recorded.'}</p>
        </div>
        <div className={styles.assessmentBlock}>
          <strong>Recommendation</strong>
          <p>{submission.recommendation || 'No recommendation recorded.'}</p>
        </div>
      </section>
    </main>
  );
}
