'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type TrashedCandidate = { id: string; name: string; deletedAt: string };

export function TrashBin({ candidates }: { candidates: TrashedCandidate[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function restore(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/candidates/${id}/restore`, { method: 'POST' });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      alert('Unable to restore this candidate. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function permanentlyDelete(id: string, name: string) {
    if (!confirm(`Permanently delete ${name}? This cannot be undone.`)) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/candidates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      alert('Unable to permanently delete this candidate. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (!candidates.length) return null;

  return (
    <div className="trash-bin">
      <button type="button" className="trash-bin-toggle" onClick={() => setOpen((v) => !v)}>
        Trash ({candidates.length})
      </button>
      {open && (
        <ul className="trash-bin-list">
          {candidates.map((c) => (
            <li key={c.id} className="trash-bin-item">
              <span className="trash-bin-name">{c.name}</span>
              <button type="button" onClick={() => restore(c.id)} disabled={busyId === c.id}>
                Restore
              </button>
              <button type="button" className="trash-bin-delete" onClick={() => permanentlyDelete(c.id, c.name)} disabled={busyId === c.id}>
                Delete forever
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
