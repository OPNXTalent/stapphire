'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TopBar } from '@/components/TopBar';

const DEMO_ORG_ID = process.env.NEXT_PUBLIC_DEMO_ORG_ID ?? '';

export default function NewRequisitionPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<'paste' | 'upload'>('paste');
  const [title, setTitle] = useState('');
  const [jdText, setJdText] = useState('');
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim() && (mode === 'paste' ? jdText.trim() : jdFile);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('org_id', DEMO_ORG_ID);
      formData.append('title', title.trim());
      if (mode === 'paste') {
        formData.append('job_description', jdText.trim());
      } else if (jdFile) {
        formData.append('file', jdFile);
      }

      const res = await fetch('/api/requisitions', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong creating the requisition.');
        return;
      }

      router.push(`/?requisition=${data.requisition.id}`);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong creating the requisition.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <TopBar />
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '80px 24px 60px' }}>
        <span className="eyebrow">New Requisition</span>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 26,
            margin: '4px 0 28px'
          }}
        >
          Open a requisition
        </h1>

        <div style={{ marginBottom: 22 }}>
          <label
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: 'var(--ink-faint)',
              display: 'block',
              marginBottom: 7
            }}
          >
            Role Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Customer Service Representative II"
            style={{
              width: '100%',
              padding: '11px 13px',
              border: '1px solid var(--line-strong)',
              borderRadius: 'var(--radius)',
              fontSize: 14,
              fontFamily: 'var(--font-body)'
            }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: 'var(--ink-faint)',
              display: 'block',
              marginBottom: 10
            }}
          >
            Job Description
          </label>

          <div className="filter-row" style={{ marginBottom: 14 }}>
            <span
              className={`filter-chip ${mode === 'paste' ? 'active' : ''}`}
              onClick={() => setMode('paste')}
            >
              Paste text
            </span>
            <span
              className={`filter-chip ${mode === 'upload' ? 'active' : ''}`}
              onClick={() => setMode('upload')}
            >
              Upload file
            </span>
          </div>

          {mode === 'paste' ? (
            <textarea
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              placeholder="Paste the full job description here..."
              style={{
                width: '100%',
                minHeight: 220,
                padding: 13,
                border: '1px solid var(--line-strong)',
                borderRadius: 'var(--radius)',
                fontSize: 13.5,
                fontFamily: 'var(--font-body)',
                resize: 'vertical'
              }}
            />
          ) : (
            <div
              className="jd-drop"
              style={{ cursor: 'pointer', padding: '28px 16px' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt"
                style={{ display: 'none' }}
                onChange={(e) => setJdFile(e.target.files?.[0] ?? null)}
              />
              {jdFile ? (
                <>
                  <strong>{jdFile.name}</strong>
                  Click to choose a different file
                </>
              ) : (
                <>
                  <strong>Click to upload</strong>
                  PDF, DOCX, or TXT
                </>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="risk-note flagged" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button
          className={`btn btn-upload ${submitting ? 'spent' : ''}`}
          disabled={!canSubmit || submitting}
          onClick={handleSubmit}
          style={{ width: 'auto', padding: '10px 20px' }}
        >
          <span>{submitting ? 'Parsing job description…' : 'Create requisition'}</span>
        </button>
      </div>
    </>
  );
}
