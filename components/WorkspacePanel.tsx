'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CandidateFilesPanel } from '@/components/CandidateFilesPanel';
import { InterviewQuestionBankPanel } from '@/components/InterviewQuestionBankPanel';
import { ResumeUpload } from '@/components/ResumeUpload';
import { RequisitionNotes } from '@/components/RequisitionNotes';
import { useRequisitionViewState } from '@/components/RequisitionViewStateProvider';
import {
  CANDIDATE_FILES_CLEAR_EVENT,
  CANDIDATE_FILES_FOCUS_EVENT,
  type CandidateFilesSelection
} from '@/lib/candidateFilesEvents';

export function WorkspacePanel({
  collapsed,
  onExpand,
  onCollapse
}: {
  collapsed: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const pathname = usePathname();
  const requisitionId = pathname.match(/^\/requisitions\/([^/]+)/)?.[1] || null;
  const isInterviewBuilder = /^\/requisitions\/[^/]+\/interviews\/builder\/?$/.test(pathname);
  const { state, update } = useRequisitionViewState(requisitionId || '');
  const tab = state.panelTab;
  const [candidate, setCandidate] = useState<CandidateFilesSelection | null>(null);

  useEffect(() => {
    function focusCandidate(event: Event) {
      const detail = (event as CustomEvent<CandidateFilesSelection>).detail;
      if (detail?.id) setCandidate(detail);
    }

    function clearCandidate(event: Event) {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      setCandidate((current) => !detail?.id || current?.id === detail.id ? null : current);
    }

    window.addEventListener(CANDIDATE_FILES_FOCUS_EVENT, focusCandidate);
    window.addEventListener(CANDIDATE_FILES_CLEAR_EVENT, clearCandidate);
    return () => {
      window.removeEventListener(CANDIDATE_FILES_FOCUS_EVENT, focusCandidate);
      window.removeEventListener(CANDIDATE_FILES_CLEAR_EVENT, clearCandidate);
    };
  }, []);

  useEffect(() => {
    setCandidate(null);
  }, [pathname]);

  if (collapsed) {
    return (
      <div className="pull-tab" onClick={onExpand}>
        {isInterviewBuilder ? 'Question Bank' : 'Hiring Workspace'}
      </div>
    );
  }

  const showCandidateFiles = Boolean(requisitionId && state.view === 'candidates' && candidate);

  return (
    <div className="side-panel">
      <button className="panel-collapse-btn" onClick={onCollapse} aria-label="Collapse panel">
        ›
      </button>

      {isInterviewBuilder ? (
        <InterviewQuestionBankPanel />
      ) : showCandidateFiles && candidate ? (
        <CandidateFilesPanel candidate={candidate} />
      ) : (
        <>
          <div className="side-tabs">
            <button type="button" className={`side-tab ${tab === 'upload' ? 'active' : ''}`} onClick={() => update({ panelTab: 'upload' })}>
              Resume Upload
            </button>
            <button type="button" className={`side-tab ${tab === 'teamwork' ? 'active' : ''}`} onClick={() => update({ panelTab: 'teamwork' })}>
              Teamwork
            </button>
          </div>
          <div className="side-content">
            {!requisitionId && <p className="muted">Open a requisition to see its notes and upload resumes.</p>}
            {requisitionId && (
              <>
                <div hidden={tab !== 'upload'}>
                  <ResumeUpload requisitionId={requisitionId} />
                </div>
                <div hidden={tab !== 'teamwork'}>
                  <RequisitionNotes requisitionId={requisitionId} />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
