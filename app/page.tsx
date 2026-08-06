'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { RequisitionPanel } from '@/components/RequisitionPanel';
import { MatrixPanel } from '@/components/MatrixPanel';
import { CollaborationPanel } from '@/components/CollaborationPanel';

// NOTE: org selection is hardcoded for a single-tenant v1. Swap for a
// real auth-derived org_id once auth is wired up. Requisition selection
// now comes from the URL (?requisition=<id>), set by the New Requisition
// flow, falling back to a demo default for local testing.
const DEMO_ORG_ID = process.env.NEXT_PUBLIC_DEMO_ORG_ID ?? '';
const DEMO_REQUISITION_ID = process.env.NEXT_PUBLIC_DEMO_REQUISITION_ID ?? '';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const requisitionId = searchParams.get('requisition') ?? DEMO_REQUISITION_ID;

  const [requisition, setRequisition] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [trashedCandidates, setTrashedCandidates] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [sidePanelTab, setSidePanelTab] = useState<'notes' | 'collaboration'>('notes');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadRequisition = useCallback(async () => {
    const res = await fetch(`/api/requisitions/${requisitionId}`, { cache: 'no-store' });
    const data = await res.json();
    setRequisition(data.requisition);
    setCandidates(data.candidates ?? []);
    setOrg(data.requisition?.organizations ?? null);
    if (!activeCandidateId && data.candidates?.[0]) {
      setActiveCandidateId(data.candidates[0].id);
    }
  }, [activeCandidateId]);

  // Both Notes and Collaboration are scoped to whichever candidate is
  // currently active — genuinely per-candidate, not just a generic
  // sidebar. Re-fetch whenever the active candidate changes.
  const loadNotes = useCallback(async (candidateId: string) => {
    const res = await fetch(`/api/notes?candidate_id=${candidateId}`, { cache: 'no-store' });
    const data = await res.json();
    setNotes(data.notes ?? []);
  }, []);

  const loadCollaboration = useCallback(
    async (candidateId?: string) => {
      const url = candidateId
        ? `/api/collaboration?requisition_id=${requisitionId}&candidate_id=${candidateId}`
        : `/api/collaboration?requisition_id=${requisitionId}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      setEvents(data.events ?? []);
    },
    [requisitionId]
  );

  const loadTrash = useCallback(async () => {
    const res = await fetch(`/api/requisitions/${requisitionId}/trash`, { cache: 'no-store' });
    const data = await res.json();
    setTrashedCandidates(data.candidates ?? []);
  }, [requisitionId]);

  useEffect(() => {
    Promise.all([loadRequisition(), loadCollaboration(), loadTrash()]).finally(() => setLoading(false));
  }, [requisitionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeCandidateId) {
      loadNotes(activeCandidateId);
      loadCollaboration(activeCandidateId);
    }
  }, [activeCandidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(file: File, onProgress: (status: string) => void) {
    const formData = new FormData();
    formData.append('requisition_id', requisitionId);
    formData.append('file', file);

    const res = await fetch('/api/evaluate', { method: 'POST', body: formData });

    if (!res.body) {
      console.error('No response stream from evaluate route');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep the last, possibly-incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);

        if (event.type === 'status' || event.type === 'progress') {
          onProgress(event.message);
        } else if (event.type === 'error') {
          console.error(event.message);
          onProgress('Something went wrong');
        } else if (event.type === 'done') {
          // Duplicate or freshly evaluated — either way, just refresh silently.
          await loadRequisition();
        }
      }
    }
  }

  async function handleSaveNote(body: string) {
    if (!activeCandidateId) return;
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_id: activeCandidateId, body })
    });
    await loadNotes(activeCandidateId);
  }

  async function handleComment(body: string) {
    if (!activeCandidateId) return;
    await fetch('/api/collaboration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requisition_id: requisitionId,
        candidate_id: activeCandidateId,
        event_type: 'commented',
        comment: body
      })
    });
    await loadCollaboration(activeCandidateId);
  }

  async function handleInvite(email: string) {
    await fetch('/api/collaboration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requisition_id: requisitionId,
        event_type: 'shared',
        comment: `Invited ${email}`
      })
    });
    await loadCollaboration(activeCandidateId ?? undefined);
  }

  // Called from the Matrix row buttons — jumps the side panel straight
  // to the right candidate and tab, expanding the panel if it was
  // collapsed.
  function handleOpenPanel(candidateId: string, tab: 'notes' | 'collaboration') {
    setActiveCandidateId(candidateId);
    setSidePanelTab(tab);
    setRightCollapsed(false);
  }

  async function handleDeleteCandidate(candidateId: string) {
    await fetch(`/api/candidates/${candidateId}`, { method: 'DELETE' });
    if (activeCandidateId === candidateId) setActiveCandidateId(null);
    await Promise.all([loadRequisition(), loadTrash()]);
  }

  async function handleRestoreCandidate(candidateId: string) {
    await fetch(`/api/candidates/${candidateId}/restore`, { method: 'POST' });
    await Promise.all([loadRequisition(), loadTrash()]);
  }

  async function handleEmptyTrash() {
    await fetch(`/api/requisitions/${requisitionId}/empty-trash`, { method: 'POST' });
    await loadTrash();
  }

  if (loading) return <div style={{ padding: 40 }}>Loading requisition…</div>;
  if (!requisition) return <div style={{ padding: 40 }}>Requisition not found.</div>;

  const appClass = [
    'app',
    leftCollapsed ? 'left-collapsed' : '',
    rightCollapsed ? 'right-collapsed' : ''
  ]
    .filter(Boolean)
    .join(' ');

  const activeCandidateName = candidates.find((c) => c.id === activeCandidateId)?.full_name ?? null;

  return (
    <>
      <TopBar requisitionTitle={requisition.title} />
      <div className={appClass}>
        <RequisitionPanel
          requisition={requisition}
          org={org ?? { credits_remaining: 0, credits_total: 0, credits_refill_at: null }}
          otherRequisitions={[]}
          collapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((c) => !c)}
          onUpload={handleUpload}
          candidateCount={candidates.length}
          trashedCandidates={trashedCandidates}
          onRestoreCandidate={handleRestoreCandidate}
          onEmptyTrash={handleEmptyTrash}
        />

        <div className="center-panel">
          <MatrixPanel
            candidates={candidates}
            onOpenNotes={(id) => handleOpenPanel(id, 'notes')}
            onOpenCollaboration={(id) => handleOpenPanel(id, 'collaboration')}
            onDelete={handleDeleteCandidate}
          />
        </div>

        <CollaborationPanel
          collapsed={rightCollapsed}
          onExpand={() => setRightCollapsed(false)}
          onCollapse={() => setRightCollapsed(true)}
          tab={sidePanelTab}
          onTabChange={setSidePanelTab}
          activeCandidateId={activeCandidateId}
          activeCandidateName={activeCandidateName}
          notes={notes}
          events={events}
          hasUnread={events.length > 0}
          onSaveNote={handleSaveNote}
          onComment={handleComment}
          onInvite={handleInvite}
        />
      </div>
    </>
  );
}
