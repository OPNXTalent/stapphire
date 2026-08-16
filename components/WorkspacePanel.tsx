'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { ResumeUpload } from '@/components/ResumeUpload';
import { RequisitionNotes } from '@/components/RequisitionNotes';

type PanelTab = 'communication' | 'upload';

// Visual-only restoration of the old right-side panel shell, now with
// its first real piece of hiring-team functionality: notes/communication,
// toggled against resume upload. Still deliberately NOT the old
// CollaborationPanel - no realtime, no Supabase subscriptions, no
// per-user accounts (none exist yet). Collapse state stays local UI
// state, not persisted.
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
  const [tab, setTab] = useState<PanelTab>('communication');

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
        <button type="button" className={`side-tab ${tab === 'communication' ? 'active' : ''}`} onClick={() => setTab('communication')}>
          Communication
        </button>
        <button type="button" className={`side-tab ${tab === 'upload' ? 'active' : ''}`} onClick={() => setTab('upload')}>
          Resume Upload
        </button>
      </div>
      <div className="side-content">
        {!requisitionId && <p className="muted">Open a requisition to see its notes and upload resumes.</p>}
        {requisitionId && tab === 'communication' && <RequisitionNotes requisitionId={requisitionId} />}
        {requisitionId && tab === 'upload' && <ResumeUpload requisitionId={requisitionId} />}
      </div>
    </div>
  );
}
