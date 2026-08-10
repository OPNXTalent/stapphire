'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { TopBar } from '@/components/TopBar';

// Deliberately code-based, not a clickable link. Corporate email
// security (Microsoft Safe Links, Proofpoint, Mimecast, and similar)
// routinely "pre-clicks" links in incoming email to scan them before
// the person ever opens their inbox — which silently consumes a
// one-time magic link before the real person gets to it, and login
// just mysteriously fails. A 6-digit code typed in by hand has nothing
// for a security scanner to click, so it isn't vulnerable to this at all.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendCode() {
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
      if (error) {
        setError(error.message);
      } else {
        setStage('code');
      }
    } finally {
      setSending(false);
    }
  }

  async function handleVerifyCode() {
    if (!code.trim()) return;
    setVerifying(true);
    setError(null);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email'
      });
      if (error) {
        setError(error.message);
      } else {
        router.push('/collaborator');
      }
    } finally {
      setVerifying(false);
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

          {stage === 'email' ? (
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
                onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                autoFocus
              />
              {error && (
                <div className="risk-note flagged" style={{ marginBottom: 14, width: '100%' }}>
                  {error}
                </div>
              )}
              <button className="btn btn-primary" disabled={!email.trim() || sending} onClick={handleSendCode}>
                <span>{sending ? 'Sending…' : 'Send sign-in code'}</span>
              </button>
            </>
          ) : (
            <>
              <div className="share-gate-title">Check your email</div>
              <div className="share-gate-sub">
                We sent a 6-digit code to <strong>{email}</strong>. Enter it below to continue.
              </div>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="share-gate-input"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                autoFocus
                style={{ textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: 20, letterSpacing: '0.3em' }}
              />
              {error && (
                <div className="risk-note flagged" style={{ marginBottom: 14, width: '100%' }}>
                  {error}
                </div>
              )}
              <button className="btn btn-primary" disabled={code.length !== 6 || verifying} onClick={handleVerifyCode}>
                <span>{verifying ? 'Verifying…' : 'Sign In'}</span>
              </button>
              <button
                className="qa-btn-text"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setStage('email');
                  setCode('');
                  setError(null);
                }}
              >
                Use a different email
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
