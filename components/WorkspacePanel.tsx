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
import {
  INTERVIEW_WORKSPACE_CLEAR_EVENT,
  INTERVIEW_WORKSPACE_FOCUS_EVENT,
  type InterviewWorkspaceFocusDetail
} from '@/lib/interviewQuestionBankEvents';

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
  const [interviewContext, setInterviewContext] = useState<InterviewWorkspaceFocusDetail | null>(null);

  useEffect(() => {
    function focusCandidate(event: Event) {
      const detail = (event as CustomEvent<CandidateFilesSelection>).detail;
      if (detail?.id) setCandidate(detail);
    }

    function clearCandidate(event: Event) {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      setCandidate((current) => !detail?.id || current?.id === detail.id ? null : current);
    }

    function focusInterview(event: Event) {
      const detail = (event as CustomEvent<InterviewWorkspaceFocusDetail>).detail;
      if (detail?.stage && detail?.positionTitle) setInterviewContext(detail);
    }

    function clearInterview() {
      setInterviewContext(null);
    }

    window.addEventListener(CANDIDATE_FILES_FOCUS_EVENT, focusCandidate);
    window.addEventListener(CANDIDATE_FILES_CLEAR_EVENT, clearCandidate);
    window.addEventListener(INTERVIEW_WORKSPACE_FOCUS_EVENT, focusInterview);
    window.addEventListener(INTERVIEW_WORKSPACE_CLEAR_EVENT, clearInterview);
    return () => {
      window.removeEventListener(CANDIDATE_FILES_FOCUS_EVENT, focusCandidate);
      window.removeEventListener(CANDIDATE_FILES_CLEAR_EVENT, clearCandidate);
      window.removeEventListener(INTERVIEW_WORKSPACE_FOCUS_EVENT, focusInterview);
      window.removeEventListener(INTERVIEW_WORKSPACE_CLEAR_EVENT, clearInterview);
    };
  }, []);

  useEffect(() => {
    setCandidate(null);
    setInterviewContext(null);
  }, [pathname]);

  const showCandidateFiles = Boolean(requisitionId && state.view === 'candidates' && candidate);
  const showInterviewBank = Boolean(
    requisitionId &&
    state.view === 'requisition' &&
    state.requisitionTab === 'interviews' &&
    interviewContext
  );
  const showQuestionBank = isInterviewBuilder || showInterviewBank;

  if (collapsed) {
    return (
      <div className="pull-tab" onClick={onExpand}>
        {showQuestionBank ? 'Question Bank' : 'Hiring Workspace'}
      </div>
    );
  }

  return (
    <div className="side-panel">
      <button className="panel-collapse-btn" onClick={onCollapse} aria-label="Collapse panel">
        ›
      </button>

      {showQuestionBank ? (
        <InterviewQuestionBankPanel
          initialStage={interviewContext?.stage}
          initialPositionTitle={interviewContext?.positionTitle}
        />
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
