'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type DNSCandidate = { id: string; name: string; deletedAt: string };

// "DNS" = Did Not Select. A holding area for candidates the team
// decided not to move forward with - restorable, not gone, and named
// in a way that doesn't treat the person as trash.
export function DNSBin({ candidates }: { candidates: DNSCandidate[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const allSelected = candidates.length > 0 && selectedIds.size === candidates.length;

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(candidates.map((c) => c.id)));
  }

  async function restoreSelected() {
    setBusy(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => fetch(`/api/candidates/${id}/restore`, { method: 'POST' })));
      setSelectedIds(new Set());
      router.refresh();
    } catch {
      alert('Unable to restore one or more candidates. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    const count = selectedIds.size;
    if (!confirm(`Permanently delete ${count} candidate${count === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => fetch(`/api/candidates/${id}`, { method: 'DELETE' })));
      setSelectedIds(new Set());
      router.refresh();
    } catch {
      alert('Unable to permanently delete one or more candidates. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!candidates.length) return null;

  return (
    <div className="dns-bin">
      <button type="button" className="dns-bin-toggle" onClick={() => setOpen((v) => !v)} title="Did Not Select">
        DNS ({candidates.length})
      </button>
      {open && (
        <div className="dns-bin-panel">
          <div className="dns-bin-actions">
            <label className="dns-bin-selectall">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Select all
            </label>
            <div className="dns-bin-actions-btns">
              <button type="button" onClick={restoreSelected} disabled={busy || selectedIds.size === 0}>
                Restore
              </button>
              <button type="button" className="dns-bin-delete" onClick={deleteSelected} disabled={busy || selectedIds.size === 0}>
                Delete
              </button>
            </div>
          </div>
          <ul className="dns-bin-list">
            {candidates.map((c) => (
              <li key={c.id} className="dns-bin-item">
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id)}
                  onChange={() => toggleOne(c.id)}
                  aria-label={`Select ${c.name}`}
                />
                <span className="dns-bin-name">{c.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
