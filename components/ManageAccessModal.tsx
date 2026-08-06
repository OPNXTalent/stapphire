'use client';

import { useEffect, useState } from 'react';

type Share = { id: string; shared_with_email: string; access_level: string; created_at: string };

export function ManageAccessModal({
  open,
  onClose,
  requisitionId,
  requisitionTitle
}: {
  open: boolean;
  onClose: () => void;
  requisitionId: string;
  requisitionTitle: string;
}) {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [granting, setGranting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/requisitions/${requisitionId}/shares`, { cache: 'no-store' });
      const data = await res.json();
      setShares(data.shares ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGrant() {
    if (!email.trim()) return;
    setGranting(true);
    try {
      await fetch(`/api/requisitions/${requisitionId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), access_level: 'collaborate' })
      });
      setEmail('');
      await load();
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(shareId: string) {
    await fetch(`/api/requisitions/${requisitionId}/shares/${shareId}`, { method: 'DELETE' });
    await load();
  }

  if (!open) return null;

  return (
    <div className="trash-modal-backdrop" onClick={onClose}>
      <div className="trash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="trash-modal-header">
          <span className="trash-modal-title">Manage Access</span>
          <button className="trash-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="trash-modal-body">
          <div className="upload-hint" style={{ marginBottom: 14 }}>
            Anyone below can sign in at <strong>/login</strong> with their email and see {requisitionTitle} —
            nothing else on your account.
          </div>

          <div className="invite-row" style={{ marginBottom: 16 }}>
            <input
              type="email"
              placeholder="colleague@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGrant()}
            />
            <button className="invite-btn" disabled={!email.trim() || granting} onClick={handleGrant}>
              {granting ? 'Adding…' : 'Grant access'}
            </button>
          </div>

          <div className="trash-modal-section-label">
            Has access {shares.length > 0 ? `(${shares.length})` : ''}
          </div>
          {loading ? (
            <div className="trash-empty-hint">Loading…</div>
          ) : shares.length === 0 ? (
            <div className="trash-empty-hint">No one else has access yet</div>
          ) : (
            shares.map((s) => (
              <div key={s.id} className="trash-item">
                <span className="trash-item-name">{s.shared_with_email}</span>
                <button
                  className="qa-btn-text"
                  style={{ color: 'var(--red)', borderBottomColor: 'var(--red)' }}
                  onClick={() => handleRevoke(s.id)}
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
