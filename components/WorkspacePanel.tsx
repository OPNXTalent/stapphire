'use client';

import { usePathname } from 'next/navigation';
import { ResumeUpload } from '@/components/ResumeUpload';
import { RequisitionNotes } from '@/components/RequisitionNotes';
import { useRequisitionViewState } from '@/components/RequisitionViewStateProvider';

// Visual-only restoration of the old right-side panel shell, now with
// its first real piece of hiring-team functionality: notes/teamwork,
// toggled against resume upload. Still deliberately NOT the old
// CollaborationPanel - no realtime, no Supabase subscriptions, no
// per-user accounts (none exist yet). Collapse state stays local UI
// state, not persisted - but which tab (Resume Upload vs Teamwork) is
// selected is now remembered per requisition, since this component
// never unmounts but the requisition being viewed does change.
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
  const { state, update } = useRequisitionViewState(requisitionId || '');
  const tab = state.panelTab;

  if (collapsed) {
    return (
      <div className="pull-tab" onClick={onExpand}>
        Hiring Workspace
      </div>
    );
  }

  return (
    <div className="side-panel">
      <button className="panel-collapse-btn" onClick={onCollapse} aria-label="Collapse panel">
        ›
      </button>
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
    </div>
  );
}
