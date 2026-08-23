'use client';

import { useMemo, useState, type ReactNode } from 'react';
import styles from './CandidateInterviewRounds.module.css';

type StageId = 'phone-screen' | 'round-1' | 'round-2';
type ViewId = 'evaluation' | StageId | null;

type AggregateRow = {
  area: string;
  timesRated: number;
  average: number;
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

const PHONE_SCREEN_SAMPLE: AggregateRow[] = [
  { area: 'Communication', timesRated: 9, average: 4.33 },
  { area: 'Job Knowledge', timesRated: 6, average: 4.17 },
  { area: 'Problem Solving', timesRated: 6, average: 3.83 },
  { area: 'Interpersonal Skills', timesRated: 3, average: 4.67 }
];

const PHONE_SCREEN_ASSESSMENTS: ParticipantAssessment[] = [
  {
    contributor: 'Participant 1',
    recommendation: 'Proceed',
    comments: 'Strong communicator with relevant experience and clear examples throughout the interview.'
  },
  {
    contributor: 'Participant 2',
    recommendation: 'Proceed',
    comments: 'Demonstrated solid job knowledge and handled the problem-solving questions well.'
  },
  {
    contributor: 'Participant 3',
    recommendation: 'Undecided - Need more information',
    comments: 'Good overall conversation. I would like more detail about the candidate’s experience with financial reporting before making a final recommendation.'
  }
];

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
  const rounds = useMemo<InterviewRound[]>(() => [
    {
      id: 'phone-screen',
      title: `Phone Screen — ${positionTitle}`,
      participants: 3,
      submitted: 3,
      overall: 4.21,
      rows: PHONE_SCREEN_SAMPLE,
      assessments: PHONE_SCREEN_ASSESSMENTS
    },
    {
      id: 'round-1',
      title: 'Round 1 — Hiring Manager',
      participants: 0,
      submitted: 0,
      overall: null,
      rows: [],
      assessments: []
    },
    {
      id: 'round-2',
      title: 'Round 2 — Panel Interview',
      participants: 0,
      submitted: 0,
      overall: null,
      rows: [],
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

  function renderInterviewBar(round: InterviewRound, selected = false) {
    return (
      <button
        key={round.id}
        type="button"
        className={`${styles.bar} ${selected ? styles.selectedBar : ''}`}
        onClick={() => setView(selected ? null : round.id)}
        aria-expanded={selected}
      >
        <span>{round.title}</span>
        <span className={styles.meta}>
          <span>{round.participants} Participants</span>
          <span>•</span>
          <span>{round.submitted} Submitted</span>
          {round.overall !== null && <><span>•</span><strong>★ {round.overall.toFixed(2)}</strong></>}
        </span>
      </button>
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

  return (
    <section className={styles.records}>
      {renderInterviewBar(round, true)}
      <div className={styles.interviewActions}>
        <a href={interviewUrl(round.id)} target="_blank" rel="noreferrer">Invite Participant</a>
      </div>
      <div className={styles.aggregateCanvas}>
        {round.rows.length ? (
          <>
            <div className={styles.sampleFlag}>PRE-PRODUCTION SAMPLE</div>
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
                  <strong>★ {row.average.toFixed(2)}</strong>
                </div>
              ))}
            </div>
            <div className={styles.overall}>
              <span>Overall Interview Average</span>
              <strong>★ {round.overall?.toFixed(2)} / 5</strong>
            </div>

            {round.assessments.length > 0 && (
              <section className={styles.participantAssessments} aria-label="Participant interview assessments">
                <h3>Participant Assessments</h3>
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
              </section>
            )}
          </>
        ) : (
          <div className={styles.empty}>
            <strong>No submitted scores yet.</strong>
            <span>Invite a participant to begin this interview stage.</span>
          </div>
        )}
      </div>
    </section>
  );
}
