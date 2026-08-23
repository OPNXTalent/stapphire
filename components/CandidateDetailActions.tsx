'use client';

import { useEffect, useState } from 'react';
import { printStapphireDocument } from '@/lib/printDocument';
import { CANDIDATE_FILES_CLEAR_EVENT, CANDIDATE_FILES_FOCUS_EVENT } from '@/lib/candidateFilesEvents';

export function CandidateDetailActions({ candidateId, sourceFilename, resumeAvailable }: { candidateId: string; sourceFilename: string; resumeAvailable: boolean }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const candidateName = document.querySelector('.matrix-selected-banner .matrix-row-name')?.textContent?.trim() || 'Candidate';
    window.dispatchEvent(new CustomEvent(CANDIDATE_FILES_FOCUS_EVENT, {
      detail: { id: candidateId, name: candidateName, sourceFilename, resumeAvailable }
    }));

    return () => {
      window.dispatchEvent(new CustomEvent(CANDIDATE_FILES_CLEAR_EVENT, { detail: { id: candidateId } }));
    };
  }, [candidateId, sourceFilename, resumeAvailable]);

  async function downloadResume() {
    if (downloading) return;
    setDownloading(true);
    setError('');
    try {
      const response = await fetch(`/api/candidates/${candidateId}/resume`);
      if (!response.ok) throw new Error('Unable to download résumé.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = sourceFilename || 'resume';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Unable to download résumé.');
    } finally {
      setDownloading(false);
    }
  }

  return <div className="candidate-detail-actions" aria-label="Candidate documents">
    {resumeAvailable ? <button type="button" onClick={downloadResume} disabled={downloading}>{downloading?'Downloading…':'Download Resume'}</button> : <span className="resume-unavailable">Resume unavailable</span>}
    <button type="button" onClick={()=>printStapphireDocument('candidate-evaluation')}>Print Evaluation</button>
    {error&&<span className="candidate-action-error" role="alert">{error}</span>}
  </div>;
}
