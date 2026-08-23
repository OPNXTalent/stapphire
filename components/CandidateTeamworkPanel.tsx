'use client';

import { CandidateNoteStream } from '@/components/CandidateNoteStream';
import type { CandidateFilesSelection } from '@/lib/candidateFilesEvents';
import styles from './CandidateFilesPanel.module.css';

export function CandidateTeamworkPanel({ candidate }: { candidate: CandidateFilesSelection }) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.eyebrow}>Candidate teamwork</span>
        <h2>{candidate.name}</h2>
        <p className={styles.headerCopy}>Shared collaboration for the hiring team.</p>
      </div>
      <div className={styles.teamworkBody}>
        <CandidateNoteStream
          candidateId={candidate.id}
          endpoint={`/api/candidates/${candidate.id}/teamwork`}
          emptyCopy="No Teamwork notes yet. Start the candidate conversation below."
          placeholder="Share a note with the hiring team…"
          fill
        />
      </div>
    </div>
  );
}
