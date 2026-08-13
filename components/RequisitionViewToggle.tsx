'use client';

import { useState, type ReactNode } from 'react';

type View = 'requisition' | 'candidates';

// A mode switch, not navigation - both views' content is already
// rendered by the server (from the same existing components, nothing
// duplicated); this just shows/hides between them client-side. No
// route change, no reload, no lost scroll/context.
export function RequisitionViewToggle({
  requisitionView,
  candidatesView
}: {
  requisitionView: ReactNode;
  candidatesView: ReactNode;
}) {
  const [view, setView] = useState<View>('requisition');

  return (
    <div>
      <div className="view-toggle" role="tablist" aria-label="Workspace view">
        <button
          role="tab"
          aria-selected={view === 'requisition'}
          className={`view-toggle-btn ${view === 'requisition' ? 'active' : ''}`}
          onClick={() => setView('requisition')}
        >
          Requisition
        </button>
        <button
          role="tab"
          aria-selected={view === 'candidates'}
          className={`view-toggle-btn ${view === 'candidates' ? 'active' : ''}`}
          onClick={() => setView('candidates')}
        >
          Candidates
        </button>
        <div className={`view-toggle-indicator ${view === 'candidates' ? 'right' : ''}`} aria-hidden="true" />
      </div>

      <div className="view-panel" role="tabpanel" hidden={view !== 'requisition'}>
        {requisitionView}
      </div>
      <div className="view-panel" role="tabpanel" hidden={view !== 'candidates'}>
        {candidatesView}
      </div>
    </div>
  );
}
