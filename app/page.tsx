'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { RequisitionPanel } from '@/components/RequisitionPanel';
import { MatrixPanel } from '@/components/MatrixPanel';
import { CandidateCard } from '@/components/CandidateCard';
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
  const [events, setEvents] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
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

  const loadCollaboration = useCallback(async () => {
    const res = await fetch(`/api/collaboration?requisition_id=${requisitionId}`, { cache: 'no-store' });
    const data = await res.json();
    setEvents(data.events ?? []);
  }, []);

  useEffect(() => {
    Promise.all([loadRequisition(), loadCollaboration()]).finally(() => setLoading(false));
  }, [requisitionId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // A dedicated /api/notes route mirrors the pattern of /api/collaboration;
    // omitted here for brevity but follows the same shape.
    console.log('save note', activeCandidateId, body);
  }

  async function handleInvite(email: string) {
    await fetch('/api/collaboration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requisition_id: requisitionId,
        actor_id: org?.currentUserId,
        event_type: 'shared',
        comment: `Invited ${email}`
      })
    });
    await loadCollaboration();
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
        />

        <div className="center-panel">
          <MatrixPanel candidates={candidates} />
          <div className="main-view">
            {candidates
              .filter((c) => c.document_type === 'resume')
              .map((c, i) => (
                <div key={c.id} onClick={() => setActiveCandidateId(c.id)}>
                  <CandidateCard
                    candidate={c}
                    index={i}
                    onAddNote={setActiveCandidateId}
                    onShare={(id) => handleInvite('')}
                  />
                </div>
              ))}
          </div>
        </div>

        <CollaborationPanel
          collapsed={rightCollapsed}
          onExpand={() => setRightCollapsed(false)}
          onCollapse={() => setRightCollapsed(true)}
          activeCandidateId={activeCandidateId}
          notes={notes}
          events={events}
          hasUnread={events.length > 0}
          onSaveNote={handleSaveNote}
          onInvite={handleInvite}
        />
      </div>
    </>
  );
}
