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
//
// Visitors pass through a one-time name gate before seeing anything.
// It's not a real login (no password) — just enough to give every
// collaborator a fixed, database-backed identity instead of an
// editable text field, so comments are reliably attributable.

function storageKey(token: string) {
  return `stapphire_collab_${token}`;
}

export default function SharedRequisitionPage({ params }: { params: { token: string } }) {
  const [requisition, setRequisition] = useState<any>(null);
  const [promptVersion, setPromptVersion] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [trashedCandidates, setTrashedCandidates] = useState<any[]>([]);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [collaboratorName, setCollaboratorName] = useState<string | null>(null);
  const [gateChecked, setGateChecked] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey(params.token));
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed?.name) setCollaboratorName(parsed.name);
      } catch {
        // ignore malformed storage
      }
    }
    setGateChecked(true);
  }, [params.token]);

  async function handleEnter() {
    if (!nameInput.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/shared/${params.token}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput.trim() })
      });
      const data = await res.json();
      if (data.collaborator) {
        window.localStorage.setItem(
          storageKey(params.token),
          JSON.stringify({ id: data.collaborator.id, name: data.collaborator.name })
        );
        setCollaboratorName(data.collaborator.name);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const load = useCallback(async () => {
    const res = await fetch(`/api/shared/${params.token}`, { cache: 'no-store' });
    if (!res.ok) {
      setNotFound(true);
      return;
    }
    const data = await res.json();
    setRequisition(data.requisition);
    setCandidates(data.candidates ?? []);
    setPromptVersion(data.promptVersion ?? null);
  }, [params.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTrash = useCallback(async () => {
    if (!requisition) return;
    const res = await fetch(`/api/requisitions/${requisition.id}/trash`, { cache: 'no-store' });
    const data = await res.json();
    setTrashedCandidates(data.candidates ?? []);
  }, [requisition]);

  useEffect(() => {
    if (collaboratorName) load().finally(() => setLoading(false));
  }, [collaboratorName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (requisition) loadTrash();
  }, [requisition]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDeleteCandidate(candidateId: string) {
    await fetch(`/api/candidates/${candidateId}`, { method: 'DELETE' });
    if (activeCandidateId === candidateId) setActiveCandidateId(null);
    await Promise.all([load(), loadTrash()]);
  }

  async function handleSetDisposition(candidateId: string, disposition: string) {
    await fetch(`/api/candidates/${candidateId}/disposition`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disposition, actor_name: collaboratorName })
    });
    await load();
  }

  async function handleBulkSetDisposition(candidateIds: string[], disposition: string) {
    await Promise.all(
      candidateIds.map((candidateId) =>
        fetch(`/api/candidates/${candidateId}/disposition`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disposition, actor_name: collaboratorName })
        })
      )
    );
    await load();
  }

  async function handleRestoreCandidate(candidateId: string) {
    await fetch(`/api/candidates/${candidateId}/restore`, { method: 'POST' });
    await Promise.all([load(), loadTrash()]);
  }

  if (!gateChecked) {
    return null;
  }

  if (!collaboratorName) {
    return (
      <div className="share-gate">
        <div className="share-gate-card">
          <svg className="gem" viewBox="0 0 24 24" fill="none" style={{ width: 32, height: 32, marginBottom: 16 }}>
            <polygon points="12,1 21,7 24,14 17,23 7,23 0,14 3,7" fill="url(#gateGemGrad)" />
            <defs>
              <linearGradient id="gateGemGrad" x1="0" y1="0" x2="24" y2="23">
                <stop offset="0%" stopColor="#5C87F5" />
                <stop offset="100%" stopColor="#123A8F" />
              </linearGradient>
            </defs>
          </svg>
          <div className="share-gate-title">Who's joining?</div>
          <div className="share-gate-sub">Your name will be shown on any comments you leave.</div>
          <input
            type="text"
            className="share-gate-input"
            placeholder="Your name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleEnter()}
            autoFocus
          />
          <button className="btn btn-primary" disabled={!nameInput.trim() || submitting} onClick={handleEnter}>
            {submitting ? 'Joining…' : 'Continue'}
          </button>
        </div>
      </div>
    );
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
            requisitionId={requisition.id}
            requisitionTitle={requisition.title}
            hiringProfile={requisition.evaluation_pillars}
            profileRevision={requisition.profile_revision}
            currentPromptVersion={promptVersion}
            discoverySource="hiring_leader_discovery"
            onProfileUpdated={load}
            onSelectCandidate={setActiveCandidateId}
            onDelete={handleDeleteCandidate}
            onSetDisposition={handleSetDisposition}
            onBulkSetDisposition={handleBulkSetDisposition}
          />
        </div>

        <CollaborationPanel
          collapsed={rightCollapsed}
          onExpand={() => setRightCollapsed(false)}
          onCollapse={() => setRightCollapsed(true)}
          requisitionId={requisition.id}
          requisitionTitle={requisition.title}
          activeCandidateId={activeCandidateId}
          activeCandidateName={activeCandidateName}
          collaboratorName={collaboratorName}
          hideNotesTab
        />
      </div>
    </>
  );
}
