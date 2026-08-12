'use client';

// TEMPORARY DEVELOPER TOOLING — not part of the product. Safe to
// delete this whole file (and the app/diagnostic folder) once the
// Jeanleshea A/B diagnostic is done. Protected by the same site
// password gate as everything else (middleware.ts already covers any
// page route by default; this one adds nothing new to the surface).

import { useState } from 'react';

const CANDIDATE_ID = '54ec7fcf-fceb-4fa6-a0d1-19a7b57b976e';

export default function DiagnosticPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [result, setResult] = useState<any>(null);

  async function runTest() {
    setLoading(true);
    setError(null);
    setResult(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/diagnostic/ab-test/${CANDIDATE_ID}`, { cache: 'no-store' });
      setStatus(res.status);
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        setError(`Response was not JSON (content-type: ${contentType || 'none'}). First 500 chars:\n\n${text.slice(0, 500)}`);
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed with status ${res.status}`);
        return;
      }
      setResult(data);
    } catch (err: any) {
      setError(err?.message ?? 'Request threw an exception before a response was received.');
    } finally {
      setLoading(false);
    }
  }

  const scoreA = result?.test_a?.overall_match ?? null;
  const verdictA = result?.test_a?.status ?? null;
  const scoreB = result?.test_b?.overall_match ?? null;
  const verdictB = result?.test_b?.status ?? null;
  const delta = result?.delta ?? null;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 24px', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <h1 style={{ fontFamily: "'Manrope', sans-serif", fontSize: 22, marginBottom: 6 }}>
        Diagnostic — Jeanleshea A/B Test
      </h1>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 24 }}>
        Temporary developer tooling. Candidate: <code>{CANDIDATE_ID}</code>. Does not modify any stored data.
      </p>

      <button
        onClick={runTest}
        disabled={loading}
        style={{
          padding: '12px 22px',
          borderRadius: 8,
          border: 'none',
          background: loading ? '#8FA8E8' : '#1E4FD8',
          color: '#fff',
          fontWeight: 700,
          fontSize: 14,
          cursor: loading ? 'default' : 'pointer',
          marginBottom: 28
        }}
      >
        {loading ? 'Running both evaluations…' : 'Run Jeanleshea A/B Test'}
      </button>

      {status !== null && (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
          HTTP status: <strong>{status}</strong>
        </div>
      )}

      {error && (
        <div
          style={{
            background: '#FDEDEA',
            border: '1px solid #E8A6A6',
            borderRadius: 8,
            padding: '14px 16px',
            marginBottom: 24,
            color: '#8A2A2A',
            fontSize: 13,
            whiteSpace: 'pre-wrap',
            fontFamily: 'monospace'
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 12,
              marginBottom: 24
            }}
          >
            <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>TEST A — Original GPT</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{scoreA !== null ? `${scoreA}%` : '—'}</div>
              <div style={{ fontSize: 13, color: '#444' }}>{verdictA ?? '—'}</div>
            </div>
            <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>TEST B — Stapphire Current</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{scoreB !== null ? `${scoreB}%` : '—'}</div>
              <div style={{ fontSize: 13, color: '#444' }}>{verdictB ?? '—'}</div>
            </div>
            <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>DELTA (B − A)</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>
                {delta !== null ? `${delta > 0 ? '+' : ''}${delta}` : '—'}
              </div>
            </div>
          </div>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Full raw response</h2>
          <pre
            style={{
              background: '#0C1220',
              color: '#D6DEF5',
              padding: 16,
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.5,
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}
