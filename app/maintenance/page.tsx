'use client';

import { useState } from 'react';

export default function MaintenancePage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        window.location.href = '/';
      } else {
        setError('Incorrect password.');
      }
    } catch {
      setError('Something went wrong — try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#030D26',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
          color: '#fff',
          textAlign: 'center',
          padding: '24px'
        }}
      >
        <div style={{ maxWidth: 380, width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 28 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <polygon points="12,1 21,7 24,14 17,23 7,23 0,14 3,7" fill="url(#g)" />
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="24" y2="23">
                  <stop offset="0%" stopColor="#5C87F5" />
                  <stop offset="100%" stopColor="#123A8F" />
                </linearGradient>
              </defs>
            </svg>
            <span style={{ fontWeight: 800, fontSize: 19, fontFamily: "'Manrope', sans-serif" }}>Stapphire</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px', fontFamily: "'Manrope', sans-serif" }}>
            This site is private.
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#B9C3E0', margin: '0 0 24px' }}>
            Enter the access password to continue.
          </p>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(255,255,255,0.06)',
                color: '#fff',
                fontSize: 14
              }}
            />
            {error && <div style={{ color: '#F5A6A6', fontSize: 13 }}>{error}</div>}
            <button
              type="submit"
              disabled={!password.trim() || submitting}
              style={{
                padding: '12px',
                borderRadius: 8,
                border: 'none',
                background: '#1E4FD8',
                color: '#fff',
                fontWeight: 700,
                fontSize: 14,
                cursor: submitting ? 'default' : 'pointer',
                opacity: submitting ? 0.7 : 1
              }}
            >
              {submitting ? 'Checking…' : 'Enter'}
            </button>
          </form>
        </div>
      </body>
    </html>
  );
}
