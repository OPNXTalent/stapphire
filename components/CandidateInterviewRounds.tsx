'use client';

import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { buildQuestionBank } from '@/lib/interviewQuestionBank';
import styles from './CandidateInterviewRounds.module.css';

type StageId = 'phone-screen' | 'round-1' | 'round-2';
type ViewId = 'evaluation' | StageId | null;

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
  id: StageId;
  title: string;
  participants: number;
  submitted: number;
  overall: number | null;
  rows: AggregateRow[];
  assessments: ParticipantAssessment[];
};

function buildStageRows(stage: StageId, positionTitle: string): AggregateRow[] {
  const areas = Array.from(new Set(
    buildQuestionBank(positionTitle)
      .filter((question) => question.stage === stage)
      .flatMap((question) => question.areas)
  ));

  return areas.map((area) => ({ area, timesRated: 0, average: null }));
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
  const [assessmentOpen, setAssessmentOpen] = useState<Record<StageId, boolean>>({
    'phone-screen': false,
    'round-1': false,
    'round-2': false
  });

  const rounds = useMemo<InterviewRound[]>(() => [
    {
      id: 'phone-screen',
      title: `Phone Screen — ${positionTitle}`,
      participants: 0,
      submitted: 0,
      overall: null,
      rows: buildStageRows('phone-screen', positionTitle),
      assessments: []
    },
    {
      id: 'round-1',
      title: 'Round 1 — Hiring Manager',
      participants: 0,
      submitted: 0,
      overall: null,
      rows: buildStageRows('round-1', positionTitle),
      assessments: []
    },
    {
      id: 'round-2',
      title: 'Round 2 — Panel Interview',
      participants: 0,
      submitted: 0,
      overall: null,
      rows: buildStageRows('round-2', positionTitle),
      assessments: []
    }
  ], [positionTitle]);

  function interviewUrl(stage: StageId) {
    const params = new URLSearchParams({
      candidate: candidateName,
      role: positionTitle,
      candidateId
    });
    return `/interview/preview/${stage}?${params.toString()}`;
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
        {rounds.map((round) => renderInterviewBar(round))}
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

  const round = rounds.find((item) => item.id === view)!;
  const assessmentsVisible = assessmentOpen[round.id];

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
