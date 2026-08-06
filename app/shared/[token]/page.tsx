'use client';

import { useCallback, useEffect, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { MatrixPanel } from '@/components/MatrixPanel';
import { CollaborationPanel } from '@/components/CollaborationPanel';

export const dynamic = 'force-dynamic';

// This route is deliberately its own page, not the recruiter dashboard
// with a flag toggled off. Structurally separating them guarantees
// Private Notes can never leak into a shared link, no matter what.
// Trash/restore IS available here — a hiring manager can move a
// candidate out of the active list and bring them back — but
// permanently emptying trash stays exclusive to the recruiter's own
// dashboard.

export default function SharedRequisitionPage({ params }: { params: { token: string } }) {
  const [requisition, setRequisition] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [trashedCandidates, setTrashedCandidates] = useState<any[]>([]);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
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
  }, [params.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTrash = useCallback(async () => {
    if (!requisition) return;
    const res = await fetch(`/api/requisitions/${requisition.id}/trash`, { cache: 'no-store' });
    const data = await res.json();
    setTrashedCandidates(data.candidates ?? []);
  }, [requisition]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (requisition) loadTrash();
  }, [requisition]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDeleteCandidate(candidateId: string) {
    await fetch(`/api/candidates/${candidateId}`, { method: 'DELETE' });
    if (activeCandidateId === candidateId) setActiveCandidateId(null);
    await Promise.all([load(), loadTrash()]);
  }

  async function handleRestoreCandidate(candidateId: string) {
    await fetch(`/api/candidates/${candidateId}/restore`, { method: 'POST' });
    await Promise.all([load(), loadTrash()]);
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
          <div className="shared-trash-bar">
            <span className="trash-header" onClick={() => setTrashOpen((o) => !o)} style={{ display: 'inline-flex' }}>
              <span className="eyebrow" style={{ marginBottom: 0 }}>
                Trash {trashedCandidates.length > 0 ? `(${trashedCandidates.length})` : ''}
              </span>
              {trashedCandidates.length > 0 && <span className="trash-chev">{trashOpen ? '▾' : '▸'}</span>}
            </span>
            {trashOpen && (
              <div className="shared-trash-list">
                {trashedCandidates.length === 0 ? (
                  <div className="trash-empty-hint">Nothing in trash</div>
                ) : (
                  trashedCandidates.map((c: any) => (
                    <div key={c.id} className="trash-item">
                      <span className="trash-item-name">{c.full_name}</span>
                      <button className="qa-btn-text" onClick={() => handleRestoreCandidate(c.id)}>
                        Restore
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <MatrixPanel
            candidates={candidates}
            onSelectCandidate={setActiveCandidateId}
            onDelete={handleDeleteCandidate}
          />
        </div>

        <CollaborationPanel
          collapsed={rightCollapsed}
          onExpand={() => setRightCollapsed(false)}
          onCollapse={() => setRightCollapsed(true)}
          requisitionId={requisition.id}
          activeCandidateId={activeCandidateId}
          activeCandidateName={activeCandidateName}
          hideNotesTab
        />
      </div>
    </>
  );
}
