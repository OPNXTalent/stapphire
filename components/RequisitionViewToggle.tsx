'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

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
  requisitionId,
  requisitionView,
  candidatesView
}: {
  title: string;
  requisitionId: string;
  requisitionView: ReactNode;
  candidatesView: ReactNode;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>('candidates');
  const [archiving, setArchiving] = useState(false);
  const goingTo = view === 'requisition' ? 'candidates' : 'requisition';

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

  return (
    <div className={`requisition-workspace ${view === 'candidates' ? 'candidates-active' : ''}`}>
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

      <div className="requisition-title-row">
        <h1>{title}</h1>
        <button type="button" className="req-archive-btn" onClick={archiveRequisition} disabled={archiving}>
          {archiving ? 'Archiving…' : 'Archive requisition'}
        </button>
      </div>

      <div className="requisition-detail-view" hidden={view !== 'requisition'}>{requisitionView}</div>
      <div className="requisition-candidates-view" hidden={view !== 'candidates'}>{candidatesView}</div>
    </div>
  );
}
