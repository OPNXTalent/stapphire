'use client';

import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { buildQuestionBank } from '@/lib/interviewQuestionBank';
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
  recommendation: 'Proceed' | 'Decline' | 'Undecided - Need more information';
  comments: string;
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

type PlanRound = { stage: string; title: string; areas: string[] };

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

  useEffect(() => {
    let active = true;

    async function loadInvitationCounts() {
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
        // Keep the current plan/count state if invitation metadata cannot be loaded.
      }
    }

    void loadInvitationCounts();
    window.addEventListener('focus', loadInvitationCounts);
    return () => {
      active = false;
      window.removeEventListener('focus', loadInvitationCounts);
    };
  }, [candidateId, positionTitle]);

  const rounds = useMemo<InterviewRound[]>(() => planRounds.map((round) => ({
    id: round.stage,
    title: round.title,
    participants: invitationCounts[round.stage]?.participants ?? 0,
    submitted: invitationCounts[round.stage]?.submitted ?? 0,
    overall: null,
    rows: (round.areas ?? []).map((area) => ({ area, timesRated: 0, average: null })),
    assessments: []
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
    return (
      <section className={styles.records}>
        <button type="button" className={`${styles.bar} ${styles.selectedBar}`} onClick={() => setView(null)} aria-expanded="true">
          <span>Evaluation</span>
        </button>
        <div className={styles.canvas}>{evaluationContent}</div>
      </section>
    );
  }

  const round = rounds.find((item) => item.id === view);
  if (!round) return null;
  const assessmentsVisible = assessmentOpen[round.id] ?? false;

  return (
    <section className={styles.records}>
      {renderInterviewBar(round, true)}
      <div className={styles.aggregateCanvas}>
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
                {round.assessments.map((assessment) => (
                  <article className={styles.assessment} key={assessment.contributor}>
                    <div className={styles.assessmentHeader}>
                      <strong>{assessment.contributor}</strong>
                      <span>{assessment.recommendation}</span>
                    </div>
                    <p>{assessment.comments}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.assessmentEmpty}>No participant assessments submitted yet.</div>
            )
          )}
        </section>
      </div>
    </section>
  );
}
