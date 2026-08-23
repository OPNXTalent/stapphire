'use client';

import { useState } from 'react';
import type { CandidateFilesSelection } from '@/lib/candidateFilesEvents';
import styles from './CandidateFilesPanel.module.css';

export function CandidateFilesPanel({ candidate }: { candidate: CandidateFilesSelection }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

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
          <summary>Uploads</summary>
          <div className={styles.folderBody}>
            <p className={styles.empty}>No additional candidate files yet.</p>
          </div>
        </details>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
