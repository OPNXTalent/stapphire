'use client';

import { useEffect, useState } from 'react';

type ArchivedRequisition = { id: string; title: string; archived_at: string };
type TrashedCandidate = { id: string; full_name: string; deleted_at: string; requisitions: { title: string } | null };

export function TrashArchiveModal({
  open,
  onClose,
  orgId,
  onRestoreCandidate,
  onRestoreRequisition,
  onEmptyTrash
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  onRestoreCandidate: (id: string) => Promise<void>;
  onRestoreRequisition: (id: string) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [archivedRequisitions, setArchivedRequisitions] = useState<ArchivedRequisition[]>([]);
  const [trashedCandidates, setTrashedCandidates] = useState<TrashedCandidate[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/organizations/${orgId}/trash`, { cache: 'no-store' });
      const data = await res.json();
      setArchivedRequisitions(data.archivedRequisitions ?? []);
      setTrashedCandidates(data.trashedCandidates ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRestoreReq(id: string) {
    await onRestoreRequisition(id);
    await load();
  }

  async function handleRestoreCand(id: string) {
    await onRestoreCandidate(id);
    await load();
  }

  async function handleEmpty() {
    if (
      !window.confirm(
        `Permanently delete ${trashedCandidates.length} resume(s) across all requisitions? This cannot be undone.`
      )
    )
      return;
    await onEmptyTrash();
    await load();
  }

  if (!open) return null;

  return (
    <div className="trash-modal-backdrop" onClick={onClose}>
      <div className="trash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="trash-modal-header">
          <span className="trash-modal-title">Trash &amp; Archive</span>
          <button className="trash-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="trash-modal-body">
          {loading ? (
            <div className="trash-empty-hint">Loading…</div>
          ) : (
            <>
              <div className="trash-modal-section-label">
                Archived Requisitions {archivedRequisitions.length > 0 ? `(${archivedRequisitions.length})` : ''}
              </div>
              {archivedRequisitions.length === 0 ? (
                <div className="trash-empty-hint">No archived requisitions</div>
              ) : (
                archivedRequisitions.map((r) => (
                  <div key={r.id} className="trash-item">
                    <span className="trash-item-name">{r.title}</span>
                    <button className="qa-btn-text" onClick={() => handleRestoreReq(r.id)}>
                      Restore
                    </button>
                  </div>
                ))
              )}

              <div className="trash-modal-section-label">
                Trashed Resumes {trashedCandidates.length > 0 ? `(${trashedCandidates.length})` : ''}
              </div>
              {trashedCandidates.length === 0 ? (
                <div className="trash-empty-hint">No trashed resumes</div>
              ) : (
                <>
                  {trashedCandidates.map((c) => (
                    <div key={c.id} className="trash-item">
                      <span className="trash-item-name">
                        {c.full_name}
                        {c.requisitions?.title && <span className="trash-item-sub"> — {c.requisitions.title}</span>}
                      </span>
                      <button className="qa-btn-text" onClick={() => handleRestoreCand(c.id)}>
                        Restore
                      </button>
                    </div>
                  ))}
                  <button
                    className="qa-btn-text"
                    style={{ marginTop: 10, color: 'var(--red)', borderBottomColor: 'var(--red)' }}
                    onClick={handleEmpty}
                  >
                    Empty Trash (resumes only)
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
