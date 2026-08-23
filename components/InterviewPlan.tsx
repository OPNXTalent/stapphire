'use client';

import Link from 'next/link';
import { useState } from 'react';
import styles from './InterviewPlan.module.css';

type RoundStatus = 'ready' | 'progress' | 'idle';

type InterviewRound = {
  id: string;
  title: string;
  status: RoundStatus;
  statusLabel: string;
};

export function InterviewPlan({ requisitionId, positionTitle, candidateNames }: { requisitionId: string; positionTitle: string; candidateNames: string[] }) {
  const [openRound, setOpenRound] = useState('phone-screen');
  const rounds: InterviewRound[] = [
    { id: 'phone-screen', title: `Phone Screen — ${positionTitle}`, status: 'ready', statusLabel: 'Ready' },
    { id: 'round-1', title: 'Round 1 — Hiring Manager', status: 'progress', statusLabel: 'In Progress' },
    { id: 'round-2', title: 'Round 2 — Panel Interview', status: 'idle', statusLabel: 'Not Started' }
  ];

  return (
    <section className={styles.plan}>
      <div className={styles.heading}>
        <span className={styles.eyebrow}>Interviews</span>
        <h2>Interview Plan</h2>
        <p>Design and manage interview rounds for this requisition.</p>
      </div>

      <div className={styles.rounds}>
        {rounds.map((round) => {
          const isOpen = openRound === round.id;
          return (
            <div className={`${styles.round} ${isOpen ? styles.roundOpen : ''}`} key={round.id}>
              <button type="button" className={styles.roundHeader} onClick={() => setOpenRound(isOpen ? '' : round.id)} aria-expanded={isOpen}>
                <span className={styles.roundTitle}><span className={styles.chevron}>{isOpen ? '⌄' : '›'}</span>{round.title}</span>
                <span className={styles.roundMeta}>
                  <span>{candidateNames.length} Candidates</span><span className={styles.dot}>•</span>
                  <span>0 Participants</span><span className={styles.dot}>•</span>
                  <span>0 Submitted</span>
                  <span className={`${styles.status} ${round.status === 'ready' ? styles.statusReady : round.status === 'progress' ? styles.statusProgress : styles.statusIdle}`}>{round.statusLabel}</span>
                </span>
              </button>

              {isOpen && (
                <div className={styles.roundBody}>
                  <div className={styles.summary}>
                    <h3>Interview Plan Summary</h3>
                    <p>A structured interview round for evaluating candidates consistently against the requisition.</p>
                    <div className={styles.actions}>
                      <Link href={`/requisitions/${requisitionId}/interviews/builder?round=${round.id}`}>Build Interview</Link>
                      <button type="button" disabled title="Participant invitations will be enabled when interview persistence is wired.">Invite Participant</button>
                      <button type="button" disabled title="Results appear after participant scorecards are submitted.">View Results</button>
                    </div>
                  </div>

                  <div className={styles.assignment}>
                    <h3>Invites are created by selecting the candidate before sending the form.</h3>
                    {candidateNames.length ? (
                      <div className={styles.table} role="table" aria-label={`${round.title} candidate assignments`}>
                        <div className={`${styles.row} ${styles.rowHead}`} role="row">
                          <span>Candidate</span><span>Participant</span><span>Status</span><span>Submitted</span>
                        </div>
                        {candidateNames.slice(0, 4).map((candidate) => (
                          <div className={styles.row} role="row" key={`${round.id}-${candidate}`}>
                            <span className={styles.candidate}>{candidate}</span>
                            <span>—</span>
                            <span className={styles.pending}>Not invited</span>
                            <span>—</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.empty}>Candidates will appear here once resumes are evaluated.</div>
                    )}
                    <div className={styles.note}><span className={styles.info}>ⓘ</span><span>Each participant receives an independent form tied to this interview and candidate. Submission will be time-stamped.</span></div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div className={styles.addRound}><button type="button" disabled title="Round creation will persist once the interview data model is wired.">+ Add interview round</button></div>
      </div>
    </section>
  );
}
