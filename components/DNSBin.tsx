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
    <div className="dns-bin">
      <button type="button" className="dns-bin-toggle" onClick={() => setOpen((v) => !v)} title="Did Not Select">
        DNS ({candidates.length})
      </button>
      {open && (
        <ul className="dns-bin-list">
          {candidates.map((c) => (
            <li key={c.id} className="dns-bin-item">
              <span className="dns-bin-name">{c.name}</span>
              <button type="button" onClick={() => restore(c.id)} disabled={busyId === c.id}>
                Restore
              </button>
              <button type="button" className="dns-bin-delete" onClick={() => permanentlyDelete(c.id, c.name)} disabled={busyId === c.id}>
                Delete forever
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
