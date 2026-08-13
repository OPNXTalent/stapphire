'use client';

import { useState, type ReactNode } from 'react';

type View = 'requisition' | 'candidates';

// A mode switch, not navigation - both views' content is already
// rendered by the server (from the same existing components, nothing
// duplicated); this just shows/hides between them client-side. No
// route change, no reload, no lost scroll/context.
//
// One button, not a tab pair - it always names where a click takes
// you, never which view you're already in. The current view has to
// read from the page heading/content itself, not from this control.
export function RequisitionViewToggle({
  title,
  requisitionView,
  candidatesView
}: {
  title: string;
  requisitionView: ReactNode;
  candidatesView: ReactNode;
}) {
  const [view, setView] = useState<View>('requisition');
  const goingTo = view === 'requisition' ? 'candidates' : 'requisition';

  return (
    <div>
      <button
        type="button"
        className="view-switch-btn"
        onClick={() => setView(goingTo)}
        aria-label={goingTo === 'candidates' ? 'Switch to Candidates view' : 'Switch to Requisition view'}
      >
        <span key={view} className="view-switch-label">
          {goingTo === 'candidates' ? 'Candidates →' : '← Requisition'}
        </span>
      </button>

      <h1>{title}</h1>

      <div hidden={view !== 'requisition'}>{requisitionView}</div>
      <div hidden={view !== 'candidates'}>{candidatesView}</div>
    </div>
  );
}
