'use client';

import { useEffect, useState } from 'react';

type TrashedCandidate = { id: string; full_name: string; deleted_at: string; requisitions: { title: string } | null };

// Trashed resumes only, across every requisition in the org. This is
// the one place with a genuinely permanent action (Empty Trash) —
// archived requisitions never appear here.
export function TrashModal({
  open,
  onClose,
  orgId,
  onRestoreCandidate,
  onEmptyTrash
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  onRestoreCandidate: (id: string) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<TrashedCandidate[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/organizations/${orgId}/trash`, { cache: 'no-store' });
      const data = await res.json();
      setItems(data.trashedCandidates ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRestore(id: string) {
    await onRestoreCandidate(id);
    await load();
  }

  async function handleEmpty() {
    if (!window.confirm(`Permanently delete ${items.length} resume(s) across all requisitions? This cannot be undone.`)) return;
    await onEmptyTrash();
    await load();
  }

  if (!open) return null;

  return (
    <div className="trash-modal-backdrop" onClick={onClose}>
      <div className="trash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="trash-modal-header">
          <span className="trash-modal-title">Trash</span>
          <button className="trash-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="trash-modal-body">
          {loading ? (
            <div className="trash-empty-hint">Loading…</div>
          ) : items.length === 0 ? (
            <div className="trash-empty-hint">No trashed resumes</div>
          ) : (
            <>
              {items.map((c) => (
                <div key={c.id} className="trash-item">
                  <span className="trash-item-name">
                    {c.full_name}
                    {c.requisitions?.title && <span className="trash-item-sub"> — {c.requisitions.title}</span>}
                  </span>
                  <button className="qa-btn-text" onClick={() => handleRestore(c.id)}>
                    Restore
                  </button>
                </div>
              ))}
              <button
                className="qa-btn-text"
                style={{ marginTop: 10, color: 'var(--red)', borderBottomColor: 'var(--red)' }}
                onClick={handleEmpty}
              >
                Empty Trash
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
