'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { MatrixPanel } from '@/components/MatrixPanel';
import { CollaborationPanel } from '@/components/CollaborationPanel';
import { supabase } from '@/lib/supabaseClient';

export const dynamic = 'force-dynamic';

export default function CollaboratorRequisitionPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [requisition, setRequisition] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [collaboratorName, setCollaboratorName] = useState('');
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      router.push('/login');
      return;
    }

    const [reqRes, profileRes] = await Promise.all([
      fetch(`/api/collaborator/requisitions/${params.id}`, { cache: 'no-store' }),
      fetch('/api/collaborator/profile', { cache: 'no-store' })
    ]);

    if (reqRes.status === 403 || reqRes.status === 401) {
      setForbidden(true);
      return;
    }

    const reqData = await reqRes.json();
    const profileData = await profileRes.json();

    setRequisition(reqData.requisition);
    setCandidates(reqData.candidates ?? []);
    setCollaboratorName(profileData.full_name ?? profileData.email ?? 'You');
  }, [params.id, router]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function handleDeleteCandidate(candidateId: string) {
    await fetch(`/api/candidates/${candidateId}`, { method: 'DELETE' });
    if (activeCandidateId === candidateId) setActiveCandidateId(null);
    await load();
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

  if (forbidden) {
    return (
      <>
        <TopBar />
        <div style={{ padding: 40 }}>
          You don't have access to this requisition. Ask your Talent Acquisition contact to grant it.
        </div>
      </>
    );
  }

  if (loading || !requisition) {
    return (
      <>
        <TopBar />
        <div style={{ padding: 40 }}>Loading…</div>
      </>
    );
  }

  const activeCandidateName = candidates.find((c: any) => c.id === activeCandidateId)?.full_name ?? null;

  return (
    <>
      <TopBar requisitionTitle={requisition.title} />
      <div className={`app shared-view ${rightCollapsed ? 'right-collapsed' : ''}`}>
        <div className="center-panel">
          <MatrixPanel
            candidates={candidates}
            requisitionId={requisition.id}
            requisitionTitle={requisition.title}
            hiringProfile={requisition.evaluation_pillars}
            profileRevision={requisition.profile_revision}
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
