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
  collapsed,
  onToggleCollapse,
  onBatchUpload,
  batchQueue,
  batchActive,
  batchBelongsHere,
  batchRequisitionId,
  batchRequisitionTitle,
  onClearBatch,
  candidateCount,
  trashedCandidates,
  onRestoreCandidate,
  onEmptyTrash,
  onAddRequisition
}: {
  requisition: Requisition;
  org: Org;
  otherRequisitions: { id: string; title: string; status: string; candidateCount: number }[];
  onSwitchRequisition: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onBatchUpload: (files: File[]) => void;
  batchQueue: BatchItem[];
  batchActive: boolean;
  batchBelongsHere: boolean;
  batchRequisitionId: string | null;
  batchRequisitionTitle: string;
  onClearBatch: () => void;
  candidateCount: number;
  trashedCandidates: { id: string; full_name: string }[];
  onRestoreCandidate: (id: string) => void;
  onEmptyTrash: () => void;
  onAddRequisition: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [trashOpen, setTrashOpen] = useState(false);
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

  const pct = org.credits_total > 0 ? (org.credits_remaining / org.credits_total) * 100 : 0;

  const doneCount = batchQueue.filter((i) => i.status !== 'pending' && i.status !== 'processing').length;
  const successCount = batchQueue.filter((i) => i.status === 'done').length;
  const duplicateCount = batchQueue.filter((i) => i.status === 'duplicate').length;
  const errorCount = batchQueue.filter((i) => i.status === 'error' || i.status === 'non_resume').length;

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
            <div className="req-title">{requisition.title}</div>

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

            {!batchActive && batchQueue.length === 0 && (
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

            {(batchActive || batchQueue.length > 0) && !batchBelongsHere && (
              <div className="batch-elsewhere">
                <span>
                  {batchActive ? 'Batch running' : 'Batch finished'} for <strong>{batchRequisitionTitle}</strong>
                </span>
                {batchRequisitionId && (
                  <button className="qa-btn-text" onClick={() => onSwitchRequisition(batchRequisitionId)}>
                    Go there
                  </button>
                )}
              </div>
            )}

            {(batchActive || batchQueue.length > 0) && batchBelongsHere && (
              <div className="batch-panel">
                <div className="batch-summary">
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
                    <span>
                      Done — {successCount} evaluated
                      {duplicateCount > 0 ? `, ${duplicateCount} duplicate` : ''}
                      {errorCount > 0 ? `, ${errorCount} skipped` : ''}
                    </span>
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

                {!batchActive && (
                  <button
                    className="qa-btn-text"
                    style={{ marginTop: 10 }}
                    onClick={() => {
                      onClearBatch();
                      fileInputRef.current?.click();
                    }}
                  >
                    Upload more
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="req-list">
            <span className="eyebrow">Other Requisitions</span>
            {otherRequisitions.map((r) => (
              <div key={r.id} className="req-list-item" onClick={() => onSwitchRequisition(r.id)}>
                <span className="req-list-name">{r.title}</span>
                <span className="req-list-meta">
                  {r.candidateCount} evaluated · {r.status}
                </span>
              </div>
            ))}
          </div>

          <div className="req-list">
            <div className="trash-header" onClick={() => setTrashOpen((o) => !o)}>
              <span className="eyebrow" style={{ marginBottom: 0 }}>
                Trash {trashedCandidates.length > 0 ? `(${trashedCandidates.length})` : ''}
              </span>
              {trashedCandidates.length > 0 && (
                <span className="trash-chev">{trashOpen ? '▾' : '▸'}</span>
              )}
            </div>

            {trashOpen && (
              <>
                {trashedCandidates.length === 0 ? (
                  <div className="trash-empty-hint">Nothing in trash</div>
                ) : (
                  <>
                    {trashedCandidates.map((c) => (
                      <div key={c.id} className="trash-item">
                        <span className="trash-item-name">{c.full_name}</span>
                        <button className="qa-btn-text" onClick={() => onRestoreCandidate(c.id)}>
                          Restore
                        </button>
                      </div>
                    ))}
                    <button
                      className="qa-btn-text"
                      style={{ marginTop: 10, color: 'var(--red)', borderBottomColor: 'var(--red)' }}
                      onClick={() => {
                        if (window.confirm(`Permanently delete ${trashedCandidates.length} candidate(s)? This cannot be undone.`)) {
                          onEmptyTrash();
                        }
                      }}
                    >
                      Empty Trash
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {!collapsed && (
        <div className="req-footer" style={{ justifyContent: 'flex-end' }}>
          <a href="/sign-out">Sign out</a>
        </div>
      )}
    </div>
  );
}
