'use client';

import { useEffect } from 'react';
import { CANDIDATE_FILES_CLEAR_EVENT, CANDIDATE_FILES_FOCUS_EVENT } from '@/lib/candidateFilesEvents';

export function CandidateDetailActions({
  candidateId,
  candidateName: explicitCandidateName,
  sourceFilename,
  resumeAvailable,
  focusInterviewId
}: {
  candidateId: string;
  // Optional: callers that already know the candidate's display name
  // (e.g. a server-resolved page that has no ".matrix-selected-banner"
  // DOM to read it from) can pass it directly instead of relying on the
  // CandidateMatrix-specific DOM query below.
  candidateName?: string;
  sourceFilename: string;
  resumeAvailable: boolean;
  focusInterviewId?: string;
}) {
  useEffect(() => {
    const candidateName = explicitCandidateName
      || document.querySelector('.matrix-selected-banner .matrix-row-name')?.textContent?.trim()
      || 'Candidate';
    const detail = { id: candidateId, name: candidateName, sourceFilename, resumeAvailable, focusInterviewId };
    let cancelled = false;
    // Deferred to a microtask so this dispatch always lands after every
    // effect from this same commit has run - including WorkspacePanel's
    // own effect that attaches its listener for this event. On a fresh
    // mount (a hard navigation such as "Back to candidate", or a page
    // reload) both effects fire within the same synchronous flush, in
    // JSX sibling order - WorkspacePanel is mounted after the page
    // content it sits alongside, so a synchronous dispatch here would
    // fire before that listener exists and be lost, leaving the right
    // rail on its default tab instead of Candidate Files.
    queueMicrotask(() => {
      if (!cancelled) window.dispatchEvent(new CustomEvent(CANDIDATE_FILES_FOCUS_EVENT, { detail }));
    });

    return () => {
      cancelled = true;
      window.dispatchEvent(new CustomEvent(CANDIDATE_FILES_CLEAR_EVENT, { detail: { id: candidateId } }));
    };
  }, [candidateId, explicitCandidateName, sourceFilename, resumeAvailable, focusInterviewId]);

  return null;
}
