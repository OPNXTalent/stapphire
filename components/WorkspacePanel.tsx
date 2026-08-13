'use client';

// Visual-only restoration of the old right-side panel shell. This is
// deliberately NOT the old CollaborationPanel - no realtime, no
// comments, no notes persistence, no Supabase subscriptions. It exists
// to hold the layout and establish the space for later hiring-team
// workflow, nothing more. Collapse state is local UI state only, not
// persisted anywhere.
export function WorkspacePanel({
  collapsed,
  onExpand,
  onCollapse
}: {
  collapsed: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
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
        <span className="side-tab active">Hiring Workspace</span>
      </div>
      <div className="side-content">
        <p className="muted">Candidate notes and hiring-team activity will appear here as the workflow expands.</p>
      </div>
    </div>
  );
}
