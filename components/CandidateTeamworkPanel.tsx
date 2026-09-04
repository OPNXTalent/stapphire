'use client';

import { CandidateNoteStream } from '@/components/CandidateNoteStream';
import { TeamworkShareControl } from '@/components/TeamworkShareControl';
import type { CandidateFilesSelection } from '@/lib/candidateFilesEvents';
import styles from './CandidateFilesPanel.module.css';

export function CandidateTeamworkPanel({ candidate }: { candidate: CandidateFilesSelection }) {
  return (
    // data-requisition-id makes the requisition this candidate (and
    // therefore this Teamwork thread) belongs to explicit and
    // verifiable, even though phase1_candidate_teamwork_notes is itself
    // scoped only by candidate_id - a candidate row belongs to exactly
    // one requisition, so the two can never disagree.
    <div className={styles.panel} data-requisition-id={candidate.requisitionId}>
      <div className={styles.header}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}><span className={styles.eyebrow}>Candidate teamwork</span><TeamworkShareControl requisitionId={candidate.requisitionId} /></div>
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
