'use client';

import { useEffect, useState } from 'react';
import { CandidateNoteStream } from '@/components/CandidateNoteStream';
import type { CandidateFilesSelection } from '@/lib/candidateFilesEvents';
import styles from './CandidateFilesPanel.module.css';

type SubmittedInterview = {
  id: string;
  roundTitle: string;
  participantName: string | null;
  submittedAt: string | null;
};

function submittedLabel(iso: string | null) {
  if (!iso) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
}

export function CandidateFilesPanel({ candidate }: { candidate: CandidateFilesSelection }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [interviews, setInterviews] = useState<SubmittedInterview[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInterviews(null);
    fetch(`/api/candidates/${candidate.id}/interview-invitations`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load interviews.');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        const submitted = (data.invitations ?? [])
          .filter((item: { status?: string }) => item.status === 'submitted')
          .map((item: SubmittedInterview) => item);
        setInterviews(submitted);
      })
      .catch(() => {
        if (!cancelled) setInterviews([]);
      });
    return () => {
      cancelled = true;
    };
  }, [candidate.id]);

  async function downloadResume() {
    if (!candidate.resumeAvailable || downloading) return;
    setDownloading(true);
    setError('');
    try {
      const response = await fetch(`/api/candidates/${candidate.id}/resume`);
      if (!response.ok) throw new Error('Unable to download resume.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = candidate.sourceFilename || 'resume';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Unable to download resume.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.eyebrow}>Candidate files</span>
        <h2>{candidate.name}</h2>
      </div>

      <div className={styles.folders}>
        <details className={styles.folder} open>
          <summary>Resume</summary>
          <div className={styles.folderBody}>
            {candidate.resumeAvailable ? (
              <button type="button" className={styles.fileRow} onClick={downloadResume} disabled={downloading}>
                <span className={styles.fileName}>{candidate.sourceFilename || 'Resume'}</span>
                <span className={styles.fileAction}>{downloading ? 'Downloading…' : 'Download'}</span>
              </button>
            ) : (
              <p className={styles.empty}>Resume unavailable.</p>
            )}
          </div>
        </details>

        <details className={styles.folder}>
          <summary>Notes</summary>
          <div className={styles.folderBody}>
            <CandidateNoteStream
              candidateId={candidate.id}
              endpoint={`/api/candidates/${candidate.id}/private-notes`}
              emptyCopy="No private recruiter notes yet."
              placeholder="Add a private recruiter note…"
              privacyCopy="Recruiter-only notes. These are separate from Teamwork and are not shown to Hiring Leaders."
            />
          </div>
        </details>

        <details className={styles.folder}>
          <summary>Uploads</summary>
          <div className={styles.folderBody}>
            <p className={styles.empty}>No additional candidate files yet.</p>
          </div>
        </details>

        <details className={styles.folder}>
          <summary>Interviews</summary>
          <div className={styles.folderBody}>
            {interviews === null && <p className={styles.empty}>Loading interviews…</p>}
            {interviews !== null && interviews.length === 0 && <p className={styles.empty}>No completed interview assessments yet.</p>}
            {interviews?.map((interview) => (
              <a
                key={interview.id}
                className={styles.fileRow}
                href={`/candidates/${candidate.id}/interviews/${interview.id}`}
              >
                <span className={styles.interviewInfo}>
                  <span className={styles.fileName}>{interview.roundTitle || 'Interview'}</span>
                  <span className={styles.fileMeta}>
                    {[interview.participantName, submittedLabel(interview.submittedAt)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className={styles.fileAction}>View</span>
              </a>
            ))}
          </div>
        </details>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
