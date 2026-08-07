'use client';

import { useEffect, useState } from 'react';

type ArchivedRequisition = { id: string; title: string; archived_at: string };

// Archived requisitions can be restored, or permanently deleted from
// here — permanent delete is the one destructive action for
// requisitions, deliberately gated behind already being archived first,
// so there's no accidental one-step path from an active role to
// permanent loss.
export function ArchiveModal({
  open,
  onClose,
  orgId,
  onRestoreRequisition,
  onDeleteRequisition
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  onRestoreRequisition: (id: string) => Promise<void>;
  onDeleteRequisition: (id: string) => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ArchivedRequisition[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/organizations/${orgId}/trash`, { cache: 'no-store' });
      const data = await res.json();
      setItems(data.archivedRequisitions ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRestore(id: string) {
    await onRestoreRequisition(id);
    await load();
  }

  async function handleDelete(id: string, title: string) {
    if (
      !window.confirm(
        `Permanently delete "${title}"? This removes every candidate, evaluation, and comment under it. This cannot be undone.`
      )
    )
      return;
    setDeletingId(id);
    try {
      await onDeleteRequisition(id);
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  if (!open) return null;

  return (
    <div className="trash-modal-backdrop" onClick={onClose}>
      <div className="trash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="trash-modal-header">
          <span className="trash-modal-title">Archive</span>
          <button className="trash-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="trash-modal-body">
          {loading ? (
            <div className="trash-empty-hint">Loading…</div>
          ) : items.length === 0 ? (
            <div className="trash-empty-hint">No archived requisitions</div>
          ) : (
            items.map((r) => (
              <div key={r.id} className="trash-item">
                <span className="trash-item-name">{r.title}</span>
                <span className="archive-item-actions">
                  <button className="qa-btn-text" onClick={() => handleRestore(r.id)}>
                    Restore
                  </button>
                  <button
                    className="qa-btn-text"
                    style={{ color: 'var(--red)', borderBottomColor: 'var(--red)' }}
                    disabled={deletingId === r.id}
                    onClick={() => handleDelete(r.id, r.title)}
                  >
                    {deletingId === r.id ? 'Deleting…' : 'Delete Permanently'}
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
