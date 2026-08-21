'use client';

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { RequisitionJobDescription } from '@/components/RequisitionJobDescription';
import { useRequisitionViewState, type RequisitionTab } from '@/components/RequisitionViewStateProvider';
import { subscribeToResumeOperationTerminal } from '@/lib/resumeTerminalSync';

const requisitionTabs: { id: RequisitionTab; label: string }[] = [
  { id: 'job-description', label: 'Job Description' },
  { id: 'hiring-criteria', label: 'Hiring Criteria' },
  { id: 'market-analysis', label: 'Market Analysis' }
];

// Two tabs shown side by side, matching the same visual pattern used
// in the WorkspacePanel (Communication / Resume Upload) - not a
// single destination-labeled button anymore. Both views' content is
// already rendered by the server (from the same existing components,
// nothing duplicated); this just shows/hides between them client-side.
// No route change, no reload, no lost scroll/context.
export function RequisitionViewToggle({
  title,
  requisitionId,
  jobDescription,
  dnsAction,
  hiringCriteriaView,
  marketAnalysisView,
  candidatesView
}: {
  title: string;
  requisitionId: string;
  jobDescription: string;
  dnsAction: ReactNode;
  hiringCriteriaView: ReactNode;
  marketAnalysisView: ReactNode;
  candidatesView: ReactNode;
}) {
  const router = useRouter();
  const { state, update } = useRequisitionViewState(requisitionId);
  const view = state.view;
  const requisitionTab = state.requisitionTab;
  const [archiving, setArchiving] = useState(false);

  // ResumeUpload lives in the shared WorkspacePanel, outside this
  // route's Server Component subtree. A terminal operation therefore
  // notifies the page-owned client boundary, which performs exactly
  // one refresh of the current requisition data. This is the refresh
  // that supplies CandidateMatrix with newly persisted candidates.
  useEffect(() => {
    return subscribeToResumeOperationTerminal(window, requisitionId, () => router.refresh());
  }, [requisitionId, router]);
  const activeRequisitionView = requisitionTab === 'hiring-criteria'
    ? hiringCriteriaView
    : requisitionTab === 'market-analysis'
      ? marketAnalysisView
      : <RequisitionJobDescription requisitionId={requisitionId} title={title} jobDescription={jobDescription} />;

  async function archiveRequisition() {
    setArchiving(true);
    try {
      const response = await fetch(`/api/requisitions/${requisitionId}/archive`, { method: 'PATCH' });
      if (!response.ok) throw new Error('Unable to archive requisition');
      router.push('/');
      router.refresh();
    } catch {
      setArchiving(false);
      alert('Unable to archive requisition. Try again.');
    }
  }

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % requisitionTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + requisitionTabs.length) % requisitionTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = requisitionTabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = requisitionTabs[nextIndex];
    update({ requisitionTab: nextTab.id });
    requestAnimationFrame(() => document.getElementById(`requisition-tab-${nextTab.id}`)?.focus());
  }

  return (
    <div className={`requisition-workspace ${view === 'candidates' ? 'candidates-active' : 'requisition-active'}`}>
      <div className="requisition-view-tabs side-tabs" role="tablist" aria-label="Workspace view">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'requisition'}
          className={`side-tab ${view === 'requisition' ? 'active' : ''}`}
          onClick={() => update({ view: 'requisition' })}
        >
          Requisition
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'candidates'}
          className={`side-tab ${view === 'candidates' ? 'active' : ''}`}
          onClick={() => update({ view: 'candidates' })}
        >
          Candidates
        </button>
      </div>

      <div className="requisition-title-row">
        <h1>{title}</h1>
        <div className="requisition-title-actions">
          <div className="requisition-title-action-stack">
            <button type="button" className="req-archive-btn" onClick={archiveRequisition} disabled={archiving}>
              {archiving ? 'Archiving…' : 'Archive requisition'}
            </button>
            {view === 'candidates' && dnsAction}
          </div>
        </div>
      </div>

      <div className="requisition-detail-view" hidden={view !== 'requisition'}>
        <div className="requisition-workspace-tabs" role="tablist" aria-label="Requisition workspace">
          {requisitionTabs.map((tab, index) => <button key={tab.id} id={`requisition-tab-${tab.id}`} type="button" role="tab" aria-selected={requisitionTab === tab.id} aria-controls="requisition-tab-panel" tabIndex={requisitionTab === tab.id ? 0 : -1} className={requisitionTab === tab.id ? 'active' : ''} onClick={() => update({ requisitionTab: tab.id })} onKeyDown={(event) => navigateTabs(event, index)}>{tab.label}</button>)}
        </div>
        <div id="requisition-tab-panel" className={`requisition-tab-panel${requisitionTab === 'job-description' ? ' job-description-panel' : ''}`} role="tabpanel" aria-labelledby={`requisition-tab-${requisitionTab}`}>{activeRequisitionView}</div>
      </div>
      <div className="requisition-candidates-view" hidden={view !== 'candidates'}>{candidatesView}</div>
    </div>
  );
}
