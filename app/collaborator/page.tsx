'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { supabase } from '@/lib/supabaseClient';

export const dynamic = 'force-dynamic';

type AssignedReq = { id: string; title: string; status: string; access_level: string };

export default function CollaboratorDashboard() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [requisitions, setRequisitions] = useState<AssignedReq[]>([]);
  const [needsName, setNeedsName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    async function init() {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const [reqRes, profileRes] = await Promise.all([
        fetch('/api/collaborator/requisitions', { cache: 'no-store' }),
        fetch('/api/collaborator/profile', { cache: 'no-store' })
      ]);

      const reqData = await reqRes.json();
      const profileData = await profileRes.json();

      setEmail(reqData.email ?? profileData.email ?? null);
      setRequisitions(reqData.requisitions ?? []);
      setNeedsName(!profileData.full_name);
      setChecking(false);
    }
    init();
  }, [router]);

  async function handleSaveName() {
    if (!nameInput.trim()) return;
    setSavingName(true);
    try {
      await fetch('/api/collaborator/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: nameInput.trim() })
      });
      setNeedsName(false);
    } finally {
      setSavingName(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (checking) {
    return (
      <>
        <TopBar />
        <div style={{ padding: 40 }}>Loading…</div>
      </>
    );
  }

  if (needsName) {
    return (
      <>
        <TopBar />
        <div className="share-gate" style={{ minHeight: 'calc(100vh - 48px)' }}>
          <div className="share-gate-card">
            <div className="share-gate-title">Welcome</div>
            <div className="share-gate-sub">Your name will be shown on any comments you leave.</div>
            <input
              type="text"
              className="share-gate-input"
              placeholder="Your name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
              autoFocus
            />
            <button className="btn btn-primary" disabled={!nameInput.trim() || savingName} onClick={handleSaveName}>
              <span>{savingName ? 'Saving…' : 'Continue'}</span>
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar requisitionTitle="Your Requisitions" />
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px 60px' }}>
        <span className="eyebrow">Signed in as {email}</span>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, margin: '4px 0 24px' }}>
          Your Requisitions
        </h1>

        {requisitions.length === 0 ? (
          <div className="trash-empty-hint">
            No requisitions have been assigned to you yet — check with your Talent Acquisition contact.
          </div>
        ) : (
          <div className="req-list">
            {requisitions.map((r) => (
              <div key={r.id} className="req-card" onClick={() => router.push(`/collaborator/${r.id}`)}>
                <div className="req-title-row">
                  <div className="req-title" title={r.title}>
                    {r.title}
                  </div>
                </div>
                <span className="req-list-meta">{r.status}</span>
              </div>
            ))}
          </div>
        )}

        <button className="qa-btn-text" style={{ marginTop: 24 }} onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </>
  );
}
