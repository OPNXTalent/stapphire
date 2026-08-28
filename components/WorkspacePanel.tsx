'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CandidateFilesPanel } from '@/components/CandidateFilesPanel';
import { CandidateTeamworkPanel } from '@/components/CandidateTeamworkPanel';
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
  // The internal completed-interview assessment view
  // (app/candidates/[id]/interviews/[invitationId]/page.tsx) has no
  // /requisitions/[id] segment of its own, but it already belongs to a
  // known candidate and requisition - CandidateDetailActions dispatches
  // the same CANDIDATE_FILES_FOCUS_EVENT there as it does from the
  // matrix, so Candidate Files should open there too, the same way,
  // without requiring a /requisitions/[id] context.
  const isCompletedInterviewRoute = /^\/candidates\/[^/]+\/interviews\/[^/]+/.test(pathname);
  const { state, update } = useRequisitionViewState(requisitionId || '');
  const tab = state.panelTab;
  const [candidate, setCandidate] = useState<CandidateFilesSelection | null>(null);
  const [candidatePanelTab, setCandidatePanelTab] = useState<'files' | 'teamwork'>('files');
  const [interviewContext, setInterviewContext] = useState<InterviewWorkspaceFocusDetail | null>(null);

  useEffect(() => {
    function focusCandidate(event: Event) {
      const detail = (event as CustomEvent<CandidateFilesSelection>).detail;
      if (detail?.id) {
        setCandidate(detail);
        setCandidatePanelTab('files');
      }
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
    setCandidatePanelTab('files');
    setInterviewContext(null);
  }, [pathname]);

  const showCandidateFiles = Boolean(candidate && (isCompletedInterviewRoute || (requisitionId && state.view === 'candidates')));
  const showQuestionBank = Boolean(
    isInterviewBuilder ||
    (requisitionId && state.view === 'requisition' && state.requisitionTab === 'interviews')
  );
  const showCandidateWorkspace = Boolean(requisitionId && state.view === 'candidates');
  const showRequisitionNotes = Boolean(
    requisitionId &&
    state.view === 'requisition' &&
    state.requisitionTab !== 'interviews'
  );

  if (collapsed) {
    const collapsedLabel = showQuestionBank
      ? 'Generated Questions'
      : showCandidateFiles
        ? (candidatePanelTab === 'teamwork' ? 'Teamwork' : 'Candidate Files')
        : showCandidateWorkspace
          ? (tab === 'teamwork' ? 'Teamwork' : 'Resume Upload')
          : showRequisitionNotes
            ? 'Teamwork'
            : 'Hiring Workspace';

    return (
      <div className="pull-tab" onClick={onExpand}>
        {collapsedLabel}
      </div>
    );
  }

  return (
    <div className="side-panel">
      <button className="panel-collapse-btn" onClick={onCollapse} aria-label="Collapse panel">
        ›
      </button>

      {showQuestionBank && requisitionId ? (
        <InterviewQuestionBankPanel
          requisitionId={requisitionId}
          initialStage={interviewContext?.stage}
          initialPositionTitle={interviewContext?.positionTitle}
        />
      ) : showCandidateFiles && candidate ? (
        <>
          <div className="side-tabs">
            <button type="button" className={`side-tab ${candidatePanelTab === 'files' ? 'active' : ''}`} onClick={() => setCandidatePanelTab('files')}>
              Candidate Files
            </button>
            <button type="button" className={`side-tab ${candidatePanelTab === 'teamwork' ? 'active' : ''}`} onClick={() => setCandidatePanelTab('teamwork')}>
              Teamwork
            </button>
          </div>
          <div className="side-content" style={{ padding: 0 }}>
            {candidatePanelTab === 'files' ? <CandidateFilesPanel candidate={candidate} /> : <CandidateTeamworkPanel candidate={candidate} />}
          </div>
        </>
      ) : showCandidateWorkspace && requisitionId ? (
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
            <div hidden={tab !== 'upload'}>
              <ResumeUpload requisitionId={requisitionId} />
            </div>
            <div hidden={tab !== 'teamwork'}>
              <RequisitionNotes requisitionId={requisitionId} />
            </div>
          </div>
        </>
      ) : showRequisitionNotes && requisitionId ? (
        <>
          <div className="side-tabs">
            <button type="button" className="side-tab active">
              Teamwork
            </button>
          </div>
          <div className="side-content">
            <RequisitionNotes requisitionId={requisitionId} />
          </div>
        </>
      ) : (
        <div className="side-content">
          <p className="muted">Open a requisition to access its workspace tools.</p>
        </div>
      )}
    </div>
  );
}
