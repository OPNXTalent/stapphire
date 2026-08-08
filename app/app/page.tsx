'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { RequisitionPanel } from '@/components/RequisitionPanel';
import { MatrixPanel } from '@/components/MatrixPanel';
import { CollaborationPanel } from '@/components/CollaborationPanel';
import { NewRequisitionForm } from '@/components/NewRequisitionForm';
import { TrashModal } from '@/components/TrashModal';
import { ArchiveModal } from '@/components/ArchiveModal';

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
  const router = useRouter();
  const requisitionId = searchParams.get('requisition') ?? DEMO_REQUISITION_ID;
  const requisitionIdRef = useRef(requisitionId);
  useEffect(() => {
    requisitionIdRef.current = requisitionId;
  }, [requisitionId]);

  const [requisition, setRequisition] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [promptVersion, setPromptVersion] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [trashedCandidates, setTrashedCandidates] = useState<any[]>([]);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creatingRequisition, setCreatingRequisition] = useState(false);
  const [trashModalOpen, setTrashModalOpen] = useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [batchQueue, setBatchQueue] = useState<
    { name: string; status: 'pending' | 'processing' | 'done' | 'duplicate' | 'non_resume' | 'error'; message: string }[]
  >([]);
  const [batchActive, setBatchActive] = useState(false);
  const [batchRequisitionId, setBatchRequisitionId] = useState<string | null>(null);
  const [allRequisitions, setAllRequisitions] = useState<any[]>([]);

  const loadAllRequisitions = useCallback(async () => {
    const res = await fetch(`/api/requisitions?org_id=${DEMO_ORG_ID}`, { cache: 'no-store' });
    const data = await res.json();
    setAllRequisitions(data.requisitions ?? []);
  }, []);

  const loadRequisition = useCallback(async () => {
    const res = await fetch(`/api/requisitions/${requisitionId}`, { cache: 'no-store' });
    const data = await res.json();
    setRequisition(data.requisition);
    setCandidates(data.candidates ?? []);
    setOrg(data.requisition?.organizations ?? null);
    setPromptVersion(data.promptVersion ?? null);
  }, [requisitionId]);

  const loadTrash = useCallback(async () => {
    const res = await fetch(`/api/requisitions/${requisitionId}/trash`, { cache: 'no-store' });
    const data = await res.json();
    setTrashedCandidates(data.candidates ?? []);
  }, [requisitionId]);

  useEffect(() => {
    Promise.all([loadRequisition(), loadTrash(), loadAllRequisitions()]).finally(() => setLoading(false));
  }, [requisitionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Evaluates one file, reading its progress stream, and reports back
  // the final outcome without touching any batch-wide state itself —
  // that's handled by the caller so this stays reusable for both a
  // single upload and one slot in a concurrent batch.
  async function evaluateOneFile(
    file: File,
    targetRequisitionId: string,
    onProgress: (message: string) => void
  ): Promise<{ status: 'done' | 'duplicate' | 'non_resume' | 'error'; message: string }> {
    const formData = new FormData();
    formData.append('requisition_id', targetRequisitionId);
    formData.append('file', file);

    const res = await fetch('/api/evaluate', { method: 'POST', body: formData });
    if (!res.body) return { status: 'error', message: 'No response from server' };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let outcome: { status: 'done' | 'duplicate' | 'non_resume' | 'error'; message: string } = {
      status: 'error',
      message: 'Did not complete'
    };

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
          outcome = { status: 'error', message: event.message };
        } else if (event.type === 'done') {
          if (event.deduped) outcome = { status: 'duplicate', message: 'Already evaluated' };
          else if (event.skipped === 'non_resume') outcome = { status: 'non_resume', message: 'Not a resume' };
          else outcome = { status: 'done', message: '' };
        }
      }
    }

    return outcome;
  }

  // Runs a fixed number of files at once instead of strictly one after
  // another — real wall-clock speedup for a large batch, since each
  // evaluation's 10-15s isn't spent waiting in a single-file line.
  async function handleBatchUpload(files: File[]) {
    const targetRequisitionId = requisitionId;

    setBatchQueue(files.map((f) => ({ name: f.name, status: 'pending', message: '' })));
    setBatchActive(true);
    setBatchRequisitionId(targetRequisitionId);

    const CONCURRENCY = 3;
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < files.length) {
        const myIndex = nextIndex++;
        const file = files[myIndex];

        setBatchQueue((q) => q.map((item, i) => (i === myIndex ? { ...item, status: 'processing' } : item)));

        const result = await evaluateOneFile(file, targetRequisitionId, (msg) => {
          setBatchQueue((q) => q.map((item, i) => (i === myIndex ? { ...item, message: msg } : item)));
        });

        setBatchQueue((q) =>
          q.map((item, i) => (i === myIndex ? { ...item, status: result.status, message: result.message } : item))
        );

        // Only refresh the visible matrix if the batch's target is still
        // the requisition currently on screen — checked live via ref,
        // since a plain closure would only ever see the value from when
        // the batch started, never a navigation that happens mid-run.
        if (targetRequisitionId === requisitionIdRef.current) await loadRequisition();
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

    setBatchActive(false);
    if (targetRequisitionId === requisitionIdRef.current) await loadTrash();
    await loadAllRequisitions();
  }

  async function handleDeleteCandidate(candidateId: string) {
    await fetch(`/api/candidates/${candidateId}`, { method: 'DELETE' });
    if (activeCandidateId === candidateId) setActiveCandidateId(null);
    await Promise.all([loadRequisition(), loadTrash()]);
  }

  async function handleSetDisposition(candidateId: string, disposition: string) {
    await fetch(`/api/candidates/${candidateId}/disposition`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disposition, actor_name: 'You' })
    });
    await loadRequisition();
  }

  async function handleBulkSetDisposition(candidateIds: string[], disposition: string) {
    await Promise.all(
      candidateIds.map((candidateId) =>
        fetch(`/api/candidates/${candidateId}/disposition`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disposition, actor_name: 'You' })
        })
      )
    );
    await loadRequisition();
  }

  async function handleBulkReevaluate(candidateIds: string[]) {
    const CONCURRENCY = 3;
    let nextIndex = 0;
    const errors: string[] = [];

    async function worker() {
      while (nextIndex < candidateIds.length) {
        const id = candidateIds[nextIndex++];
        const res = await fetch(`/api/candidates/${id}/reevaluate`, { method: 'POST' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          errors.push(data.error ?? `Failed to re-evaluate candidate ${id}`);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidateIds.length) }, worker));
    await loadRequisition();

    if (errors.length > 0) {
      alert(`${errors.length} re-evaluation(s) didn't complete:\n\n${errors.join('\n')}`);
    }
  }

  async function handleRestoreCandidate(candidateId: string) {
    await fetch(`/api/candidates/${candidateId}/restore`, { method: 'POST' });
    await Promise.all([loadRequisition(), loadTrash()]);
  }

  // Archiving is non-destructive — if the archived requisition is the
  // one currently on screen, jump to another open one, or start the
  // creation flow if none are left.
  async function handleArchiveRequisition(id: string) {
    await fetch(`/api/requisitions/${id}/archive`, { method: 'POST' });

    if (id === requisitionId) {
      const res = await fetch(`/api/requisitions?org_id=${DEMO_ORG_ID}`, { cache: 'no-store' });
      const data = await res.json();
      const remaining = (data.requisitions ?? []).filter((r: any) => r.id !== id);
      if (remaining.length > 0) {
        router.push(`/app?requisition=${remaining[0].id}`);
      } else {
        setCreatingRequisition(true);
      }
    }
    await loadAllRequisitions();
  }

  async function handleRestoreRequisition(id: string) {
    await fetch(`/api/requisitions/${id}/restore`, { method: 'POST' });
    await loadAllRequisitions();
  }

  async function handleDeleteRequisitionPermanently(id: string) {
    const res = await fetch(`/api/requisitions/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? 'Failed to permanently delete');
    }
    await loadAllRequisitions();
  }

  async function handleEmptyAllTrash() {
    await fetch(`/api/organizations/${DEMO_ORG_ID}/empty-trash`, { method: 'POST' });
    await loadTrash();
  }

  function handleRequisitionCreated(newId: string) {
    setCreatingRequisition(false);
    router.push(`/app?requisition=${newId}`);
  }

  function handleSwitchRequisition(id: string) {
    router.push(`/app?requisition=${id}`);
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
          otherRequisitions={allRequisitions
            .filter((r) => r.id !== requisitionId)
            .map((r) => ({
              id: r.id,
              title: r.title,
              status: r.status,
              candidateCount: r.candidates?.[0]?.count ?? 0
            }))}
          onSwitchRequisition={handleSwitchRequisition}
          onArchiveRequisition={handleArchiveRequisition}
          onOpenTrashModal={() => setTrashModalOpen(true)}
          onOpenArchiveModal={() => setArchiveModalOpen(true)}
          collapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((c) => !c)}
          onBatchUpload={handleBatchUpload}
          batchQueue={batchQueue}
          batchActive={batchActive}
          batchRequisitionId={batchRequisitionId}
          onClearBatch={() => {
            setBatchQueue([]);
            setBatchRequisitionId(null);
          }}
          candidateCount={candidates.length}
          onAddRequisition={() => setCreatingRequisition((c) => !c)}
          isAddingRequisition={creatingRequisition}
        />

        <div className="center-panel">
          {creatingRequisition ? (
            <NewRequisitionForm onCreated={handleRequisitionCreated} onCancel={() => setCreatingRequisition(false)} />
          ) : (
            <MatrixPanel
              candidates={candidates}
              requisitionId={requisitionId}
              requisitionTitle={requisition.title}
              shareToken={requisition.share_token}
              hiringProfile={requisition.evaluation_pillars}
              profileRevision={requisition.profile_revision}
              currentPromptVersion={promptVersion}
              discoverySource="recruiter_discovery"
              onProfileUpdated={loadRequisition}
              onSelectCandidate={setActiveCandidateId}
              onDelete={handleDeleteCandidate}
              onSetDisposition={handleSetDisposition}
              onBulkSetDisposition={handleBulkSetDisposition}
              onBulkReevaluate={handleBulkReevaluate}
            />
          )}
        </div>

        <CollaborationPanel
          collapsed={rightCollapsed}
          onExpand={() => setRightCollapsed(false)}
          onCollapse={() => setRightCollapsed(true)}
          requisitionId={requisitionId}
          requisitionTitle={requisition.title}
          activeCandidateId={activeCandidateId}
          activeCandidateName={activeCandidateName}
          collaboratorName="You"
        />
      </div>

      <TrashModal
        open={trashModalOpen}
        onClose={() => setTrashModalOpen(false)}
        orgId={DEMO_ORG_ID}
        onRestoreCandidate={handleRestoreCandidate}
        onEmptyTrash={handleEmptyAllTrash}
      />
      <ArchiveModal
        open={archiveModalOpen}
        onClose={() => setArchiveModalOpen(false)}
        orgId={DEMO_ORG_ID}
        onRestoreRequisition={handleRestoreRequisition}
        onDeleteRequisition={handleDeleteRequisitionPermanently}
      />
    </>
  );
}
