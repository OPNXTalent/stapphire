'use client';

import { useRef, useState } from 'react';

type Requisition = {
  id: string;
  title: string;
  status: string;
  job_description: string;
};

type Org = {
  credits_remaining: number;
  credits_total: number;
  credits_refill_at: string | null;
};

export function RequisitionPanel({
  requisition,
  org,
  otherRequisitions,
  collapsed,
  onToggleCollapse,
  onUpload,
  candidateCount
}: {
  requisition: Requisition;
  org: Org;
  otherRequisitions: { id: string; title: string; status: string; candidateCount: number }[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onUpload: (file: File, onProgress: (status: string) => void) => Promise<void>;
  candidateCount: number;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setStatusMsg('Starting\u2026');
    try {
      await onUpload(file, setStatusMsg);
    } finally {
      setUploading(false);
      setStatusMsg('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const pct = org.credits_total > 0 ? (org.credits_remaining / org.credits_total) * 100 : 0;

  return (
    <div className="req-panel">
      <button className="panel-collapse-btn left-btn" onClick={onToggleCollapse}>
        {collapsed ? '\u203A' : '‹'}
      </button>

      {collapsed && (
        <div className="rail-only">
          <svg className="rail-gem" viewBox="0 0 24 24" fill="none">
            <polygon points="12,1 21,7 24,14 17,23 7,23 0,14 3,7" fill="url(#gemGrad2)" />
            <defs>
              <linearGradient id="gemGrad2" x1="0" y1="0" x2="24" y2="23">
                <stop offset="0%" stopColor="#5C87F5" />
                <stop offset="100%" stopColor="#123A8F" />
              </linearGradient>
            </defs>
          </svg>
          <div className="rail-dot" />
        </div>
      )}

      {!collapsed && (
        <div className="req-panel-inner">
          <span className="eyebrow">Open Requisition</span>
          <div className="req-active">
            <div className="req-title">{requisition.title}</div>
            <div className="req-status">{requisition.status === 'open' ? 'Open' : requisition.status}</div>

            <div className="credit-block">
              <div className="credit-count">
                {org.credits_remaining}
                <span> / {org.credits_total} profiles</span>
              </div>
              {org.credits_refill_at && <div className="credit-label">Refills {org.credits_refill_at}</div>}
              <div className="credit-bar">
                <div className="credit-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>

            <div className="jd-drop">
              <strong>Job description on file</strong>
              Parsed into evaluation pillars
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button
            className={`btn btn-upload ${uploading ? 'spent' : ''}`}
            disabled={uploading || org.credits_remaining <= 0}
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="btn-upload-content">
              {uploading && (
                <svg className="gem-loader" viewBox="0 0 24 24" fill="none">
                  <polygon points="12,1 21,7 24,14 17,23 7,23 0,14 3,7" fill="url(#gemLoaderGrad)" />
                  <polygon className="facet-a" points="12,1 21,7 12,9" fill="#fff" opacity="0.3" />
                  <polygon className="facet-b" points="3,7 12,1 12,9" fill="#fff" opacity="0.12" />
                  <polygon className="facet-c" points="0,14 3,7 12,9 7,23" fill="#0A2452" opacity="0.3" />
                  <defs>
                    <linearGradient id="gemLoaderGrad" x1="0" y1="0" x2="24" y2="23">
                      <stop offset="0%" stopColor="#5C87F5" />
                      <stop offset="100%" stopColor="#123A8F" />
                    </linearGradient>
                  </defs>
                </svg>
              )}
              {uploading ? statusMsg || 'Evaluating…' : 'Upload resume'}
            </span>
            <span style={{ color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              1 credit
            </span>
          </button>

          <div className="req-list">
            <span className="eyebrow">Other Requisitions</span>
            {otherRequisitions.map((r) => (
              <div key={r.id} className="req-list-item">
                <span className="req-list-name">{r.title}</span>
                <span className="req-list-meta">
                  {r.candidateCount} evaluated · {r.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!collapsed && (
        <div className="req-footer">
          <a href="/requisitions/new">+ New requisition</a>
          <a href="/sign-out">Sign out</a>
        </div>
      )}
    </div>
  );
}
