'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { RequisitionPanel } from '@/components/RequisitionPanel';
import { MatrixPanel } from '@/components/MatrixPanel';
import { CollaborationPanel } from '@/components/CollaborationPanel';

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

  const loadTrash = useCallback(async () => {
    const res = await fetch(`/api/requisitions/${requisitionId}/trash`, { cache: 'no-store' });
    const data = await res.json();
    setTrashedCandidates(data.candidates ?? []);
  }, [requisitionId]);

  useEffect(() => {
    Promise.all([loadRequisition(), loadTrash()]).finally(() => setLoading(false));
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
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);

        if (event.type === 'status' || event.type === 'progress') {
          onProgress(event.message);
        } else if (event.type === 'error') {
          console.error(event.message);
          onProgress('Something went wrong');
        } else if (event.type === 'done') {
          await loadRequisition();
        }
      }
    }
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
            onSelectCandidate={setActiveCandidateId}
            onDelete={handleDeleteCandidate}
          />
        </div>

        <CollaborationPanel
          collapsed={rightCollapsed}
          onExpand={() => setRightCollapsed(false)}
          onCollapse={() => setRightCollapsed(true)}
          requisitionId={requisitionId}
          activeCandidateId={activeCandidateId}
          activeCandidateName={activeCandidateName}
          collaboratorName="You"
        />
      </div>
    </>
  );
}
