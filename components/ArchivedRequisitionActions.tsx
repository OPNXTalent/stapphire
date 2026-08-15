'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ArchivedRequisitionActions({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'restore' | 'delete' | null>(null);

  async function restore() {
    setBusy('restore');
    try {
      const response = await fetch(`/api/requisitions/${id}/restore`, { method: 'POST' });
      if (!response.ok) throw new Error('Unable to restore');
      router.refresh();
    } catch {
      setBusy(null);
      alert('Unable to restore requisition. Try again.');
    }
  }

  async function permanentlyDelete() {
    const confirmed = window.confirm(`Permanently delete "${title}" and its candidate/evaluation history? This cannot be undone.`);
    if (!confirmed) return;
    setBusy('delete');
    try {
      const response = await fetch(`/api/requisitions/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Unable to delete');
      router.refresh();
    } catch {
      setBusy(null);
      alert('Unable to permanently delete requisition. Try again.');
    }
  }

  return (
    <span className="archived-actions">
      <button type="button" onClick={restore} disabled={busy !== null}>{busy === 'restore' ? 'Restoring…' : 'Restore'}</button>
      <button type="button" className="archived-delete" onClick={permanentlyDelete} disabled={busy !== null}>{busy === 'delete' ? 'Deleting…' : 'Delete permanently'}</button>
    </span>
  );
}
