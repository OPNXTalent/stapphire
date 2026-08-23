'use client';

import { useEffect } from 'react';
import { CANDIDATE_FILES_CLEAR_EVENT, CANDIDATE_FILES_FOCUS_EVENT } from '@/lib/candidateFilesEvents';

export function CandidateDetailActions({ candidateId, sourceFilename, resumeAvailable }: { candidateId: string; sourceFilename: string; resumeAvailable: boolean }) {
  useEffect(() => {
    const candidateName = document.querySelector('.matrix-selected-banner .matrix-row-name')?.textContent?.trim() || 'Candidate';
    window.dispatchEvent(new CustomEvent(CANDIDATE_FILES_FOCUS_EVENT, {
      detail: { id: candidateId, name: candidateName, sourceFilename, resumeAvailable }
    }));

    return () => {
      window.dispatchEvent(new CustomEvent(CANDIDATE_FILES_CLEAR_EVENT, { detail: { id: candidateId } }));
    };
  }, [candidateId, sourceFilename, resumeAvailable]);

  return null;
}
