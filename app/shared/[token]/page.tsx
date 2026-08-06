'use client';

import { useCallback, useEffect, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { MatrixPanel } from '@/components/MatrixPanel';
import { CollaborationPanel } from '@/components/CollaborationPanel';

export const dynamic = 'force-dynamic';

// This route is deliberately its own page, not the recruiter dashboard
// with a flag toggled off. Structurally separating them guarantees
// Private Notes can never leak into a shared link, no matter what.

export default function SharedRequisitionPage({ params }: { params: { token: string } }) {
  const [requisition, setRequisition] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/shared/${params.token}`, { cache: 'no-store' });
    if (!res.ok) {
      setNotFound(true);
      return;
    }
    const data = await res.json();
    setRequisition(data.requisition);
    setCandidates(data.candidates ?? []);
    if (!activeCandidateId && data.candidates?.[0]) {
      setActiveCandidateId(data.candidates[0].id);
    }
  }, [params.token, activeCandidateId]);

  const loadCollaboration = useCallback(
    async (candidateId?: string) => {
      if (!requisition) return;
      const url = candidateId
        ? `/api/collaboration?requisition_id=${requisition.id}&candidate_id=${candidateId}`
        : `/api/collaboration?requisition_id=${requisition.id}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      setEvents(data.events ?? []);
    },
    [requisition]
  );

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeCandidateId) loadCollaboration(activeCandidateId);
  }, [activeCandidateId, requisition]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleComment(body: string) {
    if (!activeCandidateId || !requisition) return;
    await fetch('/api/collaboration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requisition_id: requisition.id,
        candidate_id: activeCandidateId,
        event_type: 'commented',
        comment: body
      })
    });
    await loadCollaboration(activeCandidateId);
  }

  if (notFound) {
    return <div style={{ padding: 40 }}>This share link is invalid or no longer active.</div>;
  }
  if (loading || !requisition) {
    return <div style={{ padding: 40 }}>Loading…</div>;
  }

  const activeCandidateName = candidates.find((c: any) => c.id === activeCandidateId)?.full_name ?? null;

  return (
    <>
      <TopBar requisitionTitle={`${requisition.title} — Shared View`} />
      <div className={`app shared-view ${rightCollapsed ? 'right-collapsed' : ''}`}>
        <div className="center-panel">
          <MatrixPanel
            candidates={candidates}
            showPrivateActions={false}
            onOpenNotes={() => {}}
            onOpenCollaboration={(id) => setActiveCandidateId(id)}
            onDelete={() => {}}
          />
        </div>

        <CollaborationPanel
          collapsed={rightCollapsed}
          onExpand={() => setRightCollapsed(false)}
          onCollapse={() => setRightCollapsed(true)}
          tab="collaboration"
          onTabChange={() => {}}
          activeCandidateId={activeCandidateId}
          activeCandidateName={activeCandidateName}
          notes={[]}
          events={events}
          hasUnread={false}
          onSaveNote={() => {}}
          onComment={handleComment}
          onInvite={() => {}}
          hideNotesTab
        />
      </div>
    </>
  );
}
