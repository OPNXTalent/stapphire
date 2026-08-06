'use client';

import { useEffect, useState } from 'react';

type ArchivedRequisition = { id: string; title: string; archived_at: string };

// Archived requisitions only. No permanent-deletion path exists here —
// archiving is entirely non-destructive, so this modal only ever shows
// a Restore action, never anything resembling Empty.
export function ArchiveModal({
  open,
  onClose,
  orgId,
  onRestoreRequisition
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  onRestoreRequisition: (id: string) => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ArchivedRequisition[]>([]);

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
                <button className="qa-btn-text" onClick={() => handleRestore(r.id)}>
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
