'use client';

import { useRef, useState } from 'react';

type Requisition = {
  id: string;
  title: string;
  status: string;
  job_description: string;
  share_token?: string;
};

type Org = {
  credits_remaining: number;
  credits_total: number;
  credits_refill_at: string | null;
};

type BatchItem = {
  name: string;
  status: 'pending' | 'processing' | 'done' | 'duplicate' | 'non_resume' | 'error';
  message: string;
};

const STATUS_ICON: Record<BatchItem['status'], string> = {
  pending: '·',
  processing: '…',
  done: '✓',
  duplicate: '⤳',
  non_resume: '—',
  error: '✕'
};

export function RequisitionPanel({
  requisition,
  org,
  otherRequisitions,
  onSwitchRequisition,
  onArchiveRequisition,
  onOpenTrashModal,
  onOpenArchiveModal,
  collapsed,
  onToggleCollapse,
  onBatchUpload,
  batchQueue,
  batchActive,
  batchRequisitionId,
  onClearBatch,
  candidateCount,
  onAddRequisition
}: {
  requisition: Requisition;
  org: Org;
  otherRequisitions: { id: string; title: string; status: string; candidateCount: number }[];
  onSwitchRequisition: (id: string) => void;
  onArchiveRequisition: (id: string) => void;
  onOpenTrashModal: () => void;
  onOpenArchiveModal: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onBatchUpload: (files: File[]) => void;
  batchQueue: BatchItem[];
  batchActive: boolean;
  batchRequisitionId: string | null;
  onClearBatch: () => void;
  candidateCount: number;
  onAddRequisition: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  async function handleCopyLink() {
    if (!requisition.share_token) return;
    const url = `${window.location.origin}/shared/${requisition.share_token}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    if (files.length > org.credits_remaining) {
      const proceed = window.confirm(
        `You selected ${files.length} resumes but only have ${org.credits_remaining} credits remaining. ` +
          `The first ${org.credits_remaining} will be evaluated; the rest will fail for lack of credits. Continue?`
      );
      if (!proceed) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    }

    onBatchUpload(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleArchiveClick(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    onArchiveRequisition(id);
  }

  const pct = org.credits_total > 0 ? (org.credits_remaining / org.credits_total) * 100 : 0;

  const doneCount = batchQueue.filter((i) => i.status !== 'pending' && i.status !== 'processing').length;
  const successCount = batchQueue.filter((i) => i.status === 'done').length;
  const duplicateCount = batchQueue.filter((i) => i.status === 'duplicate').length;
  const errorCount = batchQueue.filter((i) => i.status === 'error' || i.status === 'non_resume').length;
  const batchIsHere = batchRequisitionId === requisition.id;

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
          <div className="credit-block credit-block-top">
            <div className="credit-count">
              {org.credits_remaining}
              <span> / {org.credits_total} profiles</span>
            </div>
            {org.credits_refill_at && <div className="credit-label">Refills {org.credits_refill_at}</div>}
            <div className="credit-bar">
              <div className="credit-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <button className="btn add-req-btn" onClick={onAddRequisition}>
            <span>+ Add Requisition</span>
          </button>

          <span className="eyebrow">Open Requisition</span>
          <div className="req-box">
            <div className="req-title-row">
              <div className="req-title" title={requisition.title}>{requisition.title}</div>
              <button
                className="archive-icon-btn"
                title="Archive requisition"
                onClick={(e) => handleArchiveClick(e, requisition.id)}
              >
                📦
              </button>
            </div>

            <button className="qa-btn-text share-link-btn" style={{ marginBottom: 14 }} onClick={handleCopyLink}>
              <span>{linkCopied ? 'Link copied' : 'Share Link'}</span>
              <span className="share-link-icon">{linkCopied ? '✓' : '⧉'}</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            {!(batchIsHere && (batchActive || batchQueue.length > 0)) && (
              <button
                className="btn btn-upload"
                disabled={org.credits_remaining <= 0}
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="btn-upload-content">Upload resumes</span>
                <span style={{ color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  1 credit each
                </span>
              </button>
            )}

            {batchIsHere && (batchActive || batchQueue.length > 0) && (
              <div className="batch-panel">
                <div
                  className={`batch-summary ${!batchActive ? 'batch-summary-clickable' : ''}`}
                  onClick={!batchActive ? onClearBatch : undefined}
                  title={!batchActive ? 'Click to close' : undefined}
                >
                  {batchActive ? (
                    <span className="btn-upload-content">
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
                      Evaluating {doneCount} / {batchQueue.length}
                    </span>
                  ) : (
                    <>
                      <span>
                        Done — {successCount} evaluated
                        {duplicateCount > 0 ? `, ${duplicateCount} duplicate` : ''}
                        {errorCount > 0 ? `, ${errorCount} skipped` : ''}
                      </span>
                      <span className="batch-close-hint">✕</span>
                    </>
                  )}
                </div>

                <div className="batch-list">
                  {batchQueue.map((item, i) => (
                    <div className={`batch-item batch-item-${item.status}`} key={i}>
                      <span className="batch-item-icon">{STATUS_ICON[item.status]}</span>
                      <span className="batch-item-name">{item.name}</span>
                      {item.status === 'processing' && item.message && (
                        <span className="batch-item-msg">{item.message}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="req-list">
            <span className="eyebrow">Other Requisitions</span>
            {otherRequisitions.map((r) => {
              const rBatchIsHere = batchRequisitionId === r.id;
              const rBatchLive = rBatchIsHere && (batchActive || batchQueue.length > 0);
              return (
                <div key={r.id} className="req-card req-card-compact" onClick={() => onSwitchRequisition(r.id)}>
                  <div className="req-title-row">
                    <div className="req-title req-title-compact" title={r.title}>{r.title}</div>
                    <button
                      className="archive-icon-btn archive-icon-btn-compact"
                      title="Archive requisition"
                      onClick={(e) => handleArchiveClick(e, r.id)}
                    >
                      📦
                    </button>
                  </div>
                  {rBatchLive ? (
                    <div className="req-list-meta batch-meta">
                      {batchActive
                        ? `Evaluating ${doneCount} / ${batchQueue.length}…`
                        : `Done — ${successCount} evaluated${duplicateCount > 0 ? `, ${duplicateCount} duplicate` : ''}${
                            errorCount > 0 ? `, ${errorCount} skipped` : ''
                          }`}
                    </div>
                  ) : (
                    <span className="req-list-meta">
                      {r.candidateCount} evaluated · {r.status}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!collapsed && (
        <div className="req-footer-links">
          <button className="footer-icon-link" onClick={onOpenArchiveModal}>
            <span className="footer-icon">📦</span> Archive
          </button>
          <button className="footer-icon-link" onClick={onOpenTrashModal}>
            <span className="footer-icon">🗑</span> Trash
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="req-footer">
          <a href="/sign-out">Sign out</a>
        </div>
      )}
    </div>
  );
}
