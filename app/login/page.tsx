'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { TopBar } from '@/components/TopBar';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendLink() {
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      });
      if (error) {
        setError(error.message);
      } else {
        setSent(true);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <TopBar />
      <div className="share-gate" style={{ minHeight: 'calc(100vh - 48px)' }}>
        <div className="share-gate-card">
          <svg className="gem" viewBox="0 0 24 24" fill="none" style={{ width: 32, height: 32, marginBottom: 16 }}>
            <polygon points="12,1 21,7 24,14 17,23 7,23 0,14 3,7" fill="url(#loginGemGrad)" />
            <defs>
              <linearGradient id="loginGemGrad" x1="0" y1="0" x2="24" y2="23">
                <stop offset="0%" stopColor="#5C87F5" />
                <stop offset="100%" stopColor="#123A8F" />
              </linearGradient>
            </defs>
          </svg>

          {sent ? (
            <>
              <div className="share-gate-title">Check your email</div>
              <div className="share-gate-sub">
                We sent a sign-in link to <strong>{email}</strong>. Click it to continue — no password needed.
              </div>
            </>
          ) : (
            <>
              <div className="share-gate-title">Collaborator sign-in</div>
              <div className="share-gate-sub">
                Sign in with the email your Talent Acquisition team used to grant you access.
              </div>
              <input
                type="email"
                className="share-gate-input"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendLink()}
                autoFocus
              />
              {error && <div className="risk-note flagged" style={{ marginBottom: 14, width: '100%' }}>{error}</div>}
              <button className="btn btn-primary" disabled={!email.trim() || sending} onClick={handleSendLink}>
                <span>{sending ? 'Sending…' : 'Send sign-in link'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
