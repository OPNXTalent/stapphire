'use client';

import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { buildQuestionBank } from '@/lib/interviewQuestionBank';
import { printStapphireDocument } from '@/lib/printDocument';
import { ClientPrintFrame, type ClientPrintBranding } from '@/components/ClientPrintHeader';
import styles from './CandidateInterviewRounds.module.css';

type ViewId = 'evaluation' | string | null;
type InvitationCount = { participants: number; submitted: number };

type AggregateRow = {
  area: string;
  timesRated: number;
  average: number | null;
};

type ParticipantAssessment = {
  contributor: string;
  recommendation: 'Proceed' | 'Decline' | 'Undecided - Need more information' | '';
  comments: string;
  questionComments: Array<{ question: string; comment: string }>;
  yesNoResponses: Array<{ question: string; response: 'Yes' | 'No' }>;
};

type InterviewRound = {
  id: string;
  title: string;
  participants: number;
  submitted: number;
  overall: number | null;
  rows: AggregateRow[];
  assessments: ParticipantAssessment[];
};

type PlanRound = {
  stage: string;
  title: string;
  areas: string[];
  participants?: number;
  submitted?: number;
  overall?: number | null;
  rows?: AggregateRow[];
  assessments?: ParticipantAssessment[];
};

type PrintBrandingPayload = {
  defaultBranding?: ClientPrintBranding;
  byStage?: Record<string, ClientPrintBranding>;
};

function legacyRounds(positionTitle: string): PlanRound[] {
  return [
    {
      stage: 'phone-screen',
      title: `Phone Screen — ${positionTitle}`,
      areas: Array.from(new Set(buildQuestionBank(positionTitle).filter((q) => q.stage === 'phone-screen').flatMap((q) => q.areas)))
    },
    {
      stage: 'round-1',
      title: 'Round 1 — Hiring Manager',
      areas: Array.from(new Set(buildQuestionBank(positionTitle).filter((q) => q.stage === 'round-1').flatMap((q) => q.areas)))
    },
    {
      stage: 'round-2',
      title: 'Round 2 — Panel Interview',
      areas: Array.from(new Set(buildQuestionBank(positionTitle).filter((q) => q.stage === 'round-2').flatMap((q) => q.areas)))
    }
  ];
}

function brandingStyle(branding?: ClientPrintBranding): CSSProperties {
  const primary = /^#[0-9a-fA-F]{6}$/.test(branding?.primary ?? '') ? branding!.primary! : '#030d26';
  const accent = /^#[0-9a-fA-F]{6}$/.test(branding?.accent ?? '') ? branding!.accent! : '#1e4fd8';
  return { '--client-print-primary': primary, '--client-print-accent': accent } as CSSProperties;
}

export function CandidateInterviewRounds({
  candidateId,
  candidateName,
  positionTitle,
  evaluationContent
}: {
  candidateId: string;
  candidateName: string;
  positionTitle: string;
  evaluationContent: ReactNode;
}) {
  const [view, setView] = useState<ViewId>(null);
  const [invitationCounts, setInvitationCounts] = useState<Record<string, InvitationCount>>({});
  const [planRounds, setPlanRounds] = useState<PlanRound[]>(() => legacyRounds(positionTitle));
  const [assessmentOpen, setAssessmentOpen] = useState<Record<string, boolean>>({});
  const [printBranding, setPrintBranding] = useState<PrintBrandingPayload>({});

  useEffect(() => {
    let active = true;

    async function loadInvitationResults() {
      try {
        const response = await fetch(`/api/candidates/${candidateId}/interview-invitations`, { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json();
        if (!active) return;
        setInvitationCounts(payload?.counts ?? {});
        if (payload?.hasPlan) {
          setPlanRounds(Array.isArray(payload?.rounds) ? payload.rounds : []);
        } else {
          setPlanRounds(legacyRounds(positionTitle));
        }
      } catch {
        // Keep the current interview record if results cannot be refreshed.
      }
    }

    void loadInvitationResults();
    window.addEventListener('focus', loadInvitationResults);
    return () => {
      active = false;
      window.removeEventListener('focus', loadInvitationResults);
    };
  }, [candidateId, positionTitle]);

  useEffect(() => {
    let active = true;
    async function loadPrintBranding() {
      try {
        const response = await fetch(`/api/candidates/${candidateId}/print-branding`, { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json() as PrintBrandingPayload;
        if (active) setPrintBranding(payload ?? {});
      } catch {
        // Printing remains available with neutral fallback styling.
      }
    }
    void loadPrintBranding();
    return () => { active = false; };
  }, [candidateId]);

  const rounds = useMemo<InterviewRound[]>(() => planRounds.map((round) => ({
    id: round.stage,
    title: round.title,
    participants: round.participants ?? invitationCounts[round.stage]?.participants ?? 0,
    submitted: round.submitted ?? invitationCounts[round.stage]?.submitted ?? 0,
    overall: typeof round.overall === 'number' ? round.overall : null,
    rows: Array.isArray(round.rows)
      ? round.rows
      : (round.areas ?? []).map((area) => ({ area, timesRated: 0, average: null })),
    assessments: Array.isArray(round.assessments) ? round.assessments : []
  })), [invitationCounts, planRounds]);

  function interviewUrl(stage: string) {
    const params = new URLSearchParams({
      candidate: candidateName,
      role: positionTitle,
      candidateId
    });
    return `/interview/preview/${encodeURIComponent(stage)}?${params.toString()}`;
  }

  function toggleRound(round: InterviewRound, selected: boolean) {
    setView(selected ? null : round.id);
  }

  function handleBarKeyDown(event: KeyboardEvent<HTMLDivElement>, round: InterviewRound, selected: boolean) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleRound(round, selected);
    }
  }

  function stopLinkToggle(event: MouseEvent<HTMLAnchorElement>) {
    event.stopPropagation();
  }

  function renderInterviewBar(round: InterviewRound, selected = false) {
    return (
      <div
        key={round.id}
        className={`${styles.bar} ${selected ? styles.selectedBar : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={selected}
        aria-label={`${selected ? 'Collapse' : 'View'} ${round.title} results`}
        onClick={() => toggleRound(round, selected)}
        onKeyDown={(event) => handleBarKeyDown(event, round, selected)}
      >
        <a
          className={styles.interviewTitleLink}
          href={interviewUrl(round.id)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${round.title} participant form`}
          onClick={stopLinkToggle}
        >
          {round.title}
        </a>
        <span className={styles.meta}>
          <span>{round.participants} Participants</span>
          <span>•</span>
          <span>{round.submitted} Submitted</span>
          {round.overall !== null && <><span>•</span><strong>★ {round.overall.toFixed(2)}</strong></>}
        </span>
      </div>
    );
  }

  function renderAssessment(assessment: ParticipantAssessment, key: string) {
    return (
      <article className={styles.assessment} key={key}>
        <div className={styles.assessmentHeader}>
          <strong>{assessment.contributor}</strong>
          <span>{assessment.recommendation || 'No recommendation'}</span>
        </div>
        {assessment.comments && <p>{assessment.comments}</p>}
        {assessment.questionComments.length > 0 && (
          <div className={styles.questionCommentList}>
            {assessment.questionComments.map((item, index) => (
              <div className={styles.questionCommentItem} key={`${key}-comment-${index}`}>
                <strong>{item.question}</strong>
                <p>{item.comment}</p>
              </div>
            ))}
          </div>
        )}
        {assessment.yesNoResponses.length > 0 && (
          <div className={styles.questionCommentList}>
            {assessment.yesNoResponses.map((item, index) => (
              <div className={styles.questionCommentItem} key={`${key}-yes-no-${index}`}>
                <strong>{item.question}</strong>
                <p>{item.response}</p>
              </div>
            ))}
          </div>
        )}
      </article>
    );
  }

  if (view === null) {
    return (
      <section className={styles.records} aria-label={`${candidateName} candidate record`}>
        <button type="button" className={styles.bar} onClick={() => setView('evaluation')}>
          <span>Evaluation</span>
        </button>
        <p className={styles.interviewHelper}>
          Click an interview name to open the evaluation form and share it with participants. Once results come in, click the bar to expand and view them.
        </p>
        {rounds.map((round) => renderInterviewBar(round))}
        {rounds.length === 0 && <div className={styles.assessmentEmpty}>No interviews have been added to this requisition yet.</div>}
      </section>
    );
  }

  if (view === 'evaluation') {
    const branding = printBranding.defaultBranding;
    return (
      <section className={styles.records}>
        <button type="button" className={`${styles.bar} ${styles.selectedBar}`} onClick={() => setView(null)} aria-expanded="true">
          <span>Evaluation</span>
        </button>
        <div className="candidate-record-actions">
          <button type="button" className="candidate-record-print-action" onClick={() => printStapphireDocument('candidate-evaluation')}>Print</button>
        </div>
        <div className={`${styles.canvas} client-branded-evaluation-print`} style={brandingStyle(branding)}>
          <ClientPrintFrame branding={branding} documentTitle="Candidate Evaluation">{evaluationContent}</ClientPrintFrame>
        </div>
      </section>
    );
  }

  const round = rounds.find((item) => item.id === view);
  if (!round) return null;
  const assessmentsVisible = assessmentOpen[round.id] ?? false;
  const branding = printBranding.byStage?.[round.id] ?? printBranding.defaultBranding;

  return (
    <section className={styles.records}>
      {renderInterviewBar(round, true)}
      <div className="candidate-record-actions">
        <button type="button" className="candidate-record-print-action" onClick={() => printStapphireDocument('interview-summary')}>Print</button>
      </div>
      <div className={`${styles.aggregateCanvas} interview-summary-print-document print-document`} style={brandingStyle(branding)}>
        <ClientPrintFrame branding={branding} documentTitle="Interview Summary">
        <div className="interview-summary-print-meta">
          <h1>{candidateName}</h1>
          <p>{positionTitle}</p>
          <strong>{round.title}</strong>
        </div>
        <div className={styles.aggregateTable} role="table" aria-label={`${round.title} aggregate results`}>
          <div className={`${styles.aggregateRow} ${styles.headerRow}`} role="row">
            <span>Area of Evaluation</span>
            <span>Times Rated</span>
            <span>Aggregate</span>
          </div>
          {round.rows.map((row) => (
            <div className={styles.aggregateRow} role="row" key={row.area}>
              <span>{row.area}</span>
              <span>{row.timesRated}</span>
              <strong>{row.average === null ? '—' : `★ ${row.average.toFixed(2)}`}</strong>
            </div>
          ))}
          {round.rows.length === 0 && <div className={styles.assessmentEmpty}>No Areas of Evaluation configured yet.</div>}
        </div>
        <div className={styles.overall}>
          <span>Overall Interview Average</span>
          <strong>{round.overall === null ? '—' : `★ ${round.overall.toFixed(2)} / 5`}</strong>
        </div>

        <section className={styles.participantAssessments} aria-label="Participant interview assessments">
          <button
            type="button"
            className={styles.assessmentToggle}
            aria-expanded={assessmentsVisible}
            onClick={() => setAssessmentOpen((current) => ({ ...current, [round.id]: !current[round.id] }))}
          >
            <span>Participant Assessments</span>
            <span>{round.assessments.length} Submitted</span>
          </button>

          {assessmentsVisible && (
            round.assessments.length > 0 ? (
              <div className={styles.assessmentList}>
                {round.assessments.map((assessment, index) => renderAssessment(assessment, `${assessment.contributor}-${index}`))}
              </div>
            ) : (
              <div className={styles.assessmentEmpty}>No participant assessments submitted yet.</div>
            )
          )}
        </section>
        <div className="interview-summary-print-assessments">
          <h2>Participant Assessments</h2>
          {round.assessments.length > 0
            ? round.assessments.map((assessment, index) => renderAssessment(assessment, `print-${assessment.contributor}-${index}`))
            : <p>No participant assessments submitted yet.</p>}
        </div>
        </ClientPrintFrame>
      </div>
    </section>
  );
}
