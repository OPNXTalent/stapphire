'use client';

import { useEffect, useMemo, useState } from 'react';
import { DISPOSITIONS } from '@/lib/dispositions';
import { normalizePillars } from '@/lib/pillars';
import { MultiSelectFilter } from '@/components/MultiSelectFilter';

type Evaluation = {
  overall_match: number;
  status: 'greenlight' | 'consider' | 'decline';
  signals: Record<string, string>;
  matrix_dimensions: Record<string, string>;
  strengths: string[];
  gaps: string[];
  risk_flags: string[];
};

type Candidate = {
  id: string;
  full_name: string;
  document_type: string;
  source_filename: string | null;
  original_file_url: string | null;
  disposition: string | null;
  evaluations: Evaluation[];
};

function facetTier(score: number): 'strong' | 'moderate' | 'limited' {
  if (score >= 85) return 'strong';
  if (score >= 69) return 'moderate';
  return 'limited';
}

function rankBadgeClass(rank: number) {
  if (rank === 1) return 'gembadge r1';
  if (rank === 2) return 'gembadge r2';
  if (rank === 3) return 'gembadge r3';
  return null;
}

// Master-detail layout: the top pane always shows one candidate's full
// evaluation (whichever is "focused"), the bottom pane is a compact,
// scannable list used to change focus and run bulk actions. Clicking a
// name in the list sets focus — it doesn't expand the row itself.
export function MatrixPanel({
  candidates,
  requisitionTitle,
  shareToken,
  onSelectCandidate,
  onDelete,
  onSetDisposition,
  onBulkSetDisposition,
  onBulkReevaluate,
  evaluationPillars,
  onRefinePillars
}: {
  candidates: Candidate[];
  requisitionTitle: string;
  shareToken?: string;
  onSelectCandidate: (candidateId: string | null) => void;
  onDelete: (candidateId: string) => void;
  onSetDisposition: (candidateId: string, disposition: string) => void;
  onBulkSetDisposition: (candidateIds: string[], disposition: string) => void;
  onBulkReevaluate?: (candidateIds: string[]) => void;
  evaluationPillars?: unknown;
  onRefinePillars?: (prompt: string) => Promise<void>;
}) {
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [dispositionFilter, setDispositionFilter] = useState<string[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [localDisposition, setLocalDisposition] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDisposition, setBulkDisposition] = useState('');
  const [applyingBulk, setApplyingBulk] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const pillars = useMemo(() => normalizePillars(evaluationPillars), [evaluationPillars]);

  function handlePrint() {
    window.print();
  }

  async function handleDownload(id: string) {
    setDownloading(id);
    try {
      const res = await fetch(`/api/candidates/${id}/resume-url`);
      const data = await res.json();
      if (data.url) {
        window.open(data.url, '_blank');
      } else {
        console.error(data.error);
      }
    } finally {
      setDownloading(null);
    }
  }

  function handleFocus(id: string) {
    setFocusedId(id);
    onSelectCandidate(id);
  }

  function handleDispositionChange(candidateId: string, value: string) {
    if (value === '__trash__') {
      onDelete(candidateId);
      return;
    }
    setLocalDisposition((prev) => ({ ...prev, [candidateId]: value }));
    onSetDisposition(candidateId, value);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((c) => c.id)));
    }
  }

  async function handleApplyBulk() {
    if (!bulkDisposition || selectedIds.size === 0) return;
    setApplyingBulk(true);
    try {
      const ids = Array.from(selectedIds);
      setLocalDisposition((prev) => {
        const next = { ...prev };
        ids.forEach((id) => (next[id] = bulkDisposition));
        return next;
      });
      await onBulkSetDisposition(ids, bulkDisposition);
      setSelectedIds(new Set());
      setBulkDisposition('');
    } finally {
      setApplyingBulk(false);
    }
  }

  function handleReevaluateClick() {
    if (!onBulkReevaluate || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (
      window.confirm(
        `Re-evaluate ${ids.length} candidate${ids.length !== 1 ? 's' : ''} against the current job description and prompt? This uses ${ids.length} credit${ids.length !== 1 ? 's' : ''} — one per candidate, same as a fresh evaluation.`
      )
    ) {
      onBulkReevaluate(ids);
      setSelectedIds(new Set());
    }
  }

  async function handleSubmitPrompt() {
    if (!onRefinePillars || !promptText.trim()) return;
    setSavingPrompt(true);
    setPromptError(null);
    try {
      await onRefinePillars(promptText.trim());
      setPromptText('');
    } catch (err: any) {
      setPromptError(err?.message ?? 'Something went wrong updating the criteria.');
    } finally {
      setSavingPrompt(false);
    }
  }

  async function handleCopyLink() {
    if (!shareToken) return;
    const url = `${window.location.origin}/shared/${shareToken}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  const scored = useMemo(
    () =>
      candidates
        .filter((c) => c.document_type === 'resume' && c.evaluations?.[0])
        .sort((a, b) => b.evaluations[0].overall_match - a.evaluations[0].overall_match),
    [candidates]
  );

  const filtered = useMemo(() => {
    return scored.filter((c) => {
      const statusOk = statusFilter.length === 0 || statusFilter.includes(c.evaluations[0].status);
      const dispositionOk =
        dispositionFilter.length === 0 ||
        (c.disposition ? dispositionFilter.includes(c.disposition) : dispositionFilter.includes('none'));
      return statusOk && dispositionOk;
    });
  }, [scored, statusFilter, dispositionFilter]);

  // Keep focus pointed at something real — default to the top result,
  // and re-anchor if a filter change drops the focused candidate out
  // of view.
  useEffect(() => {
    if (filtered.length === 0) {
      if (focusedId !== null) setFocusedId(null);
      return;
    }
    if (!focusedId || !filtered.some((c) => c.id === focusedId)) {
      setFocusedId(filtered[0].id);
    }
  }, [filtered, focusedId]);

  const focused = filtered.find((c) => c.id === focusedId) ?? null;
  const focusedEval = focused?.evaluations?.[0];

  return (
    <>
      <div className="matrix-toggle open">
        <svg className="facet-icon" viewBox="0 0 24 24" fill="none">
          <polygon points="12,1 21,7 24,14 17,23 7,23 0,14 3,7" fill="var(--sapphire)" />
        </svg>
        <div className="matrix-toggle-label">Candidate Matrix</div>
        <div className="matrix-toggle-sub">Same rubric, every candidate — tap a name for the full picture</div>
      </div>

      <div className="print-header">
        <svg className="gem" viewBox="0 0 24 24" fill="none">
          <polygon points="12,1 21,7 24,14 17,23 7,23 0,14 3,7" fill="url(#printGemGrad)" />
          <polygon points="12,1 21,7 12,9" fill="#fff" opacity="0.22" />
          <polygon points="3,7 12,1 12,9" fill="#fff" opacity="0.1" />
          <polygon points="0,14 3,7 12,9 7,23" fill="#0A2452" opacity="0.35" />
          <polygon points="24,14 21,7 12,9 17,23" fill="#0A2452" opacity="0.2" />
          <defs>
            <linearGradient id="printGemGrad" x1="0" y1="0" x2="24" y2="23">
              <stop offset="0%" stopColor="#5C87F5" />
              <stop offset="100%" stopColor="#123A8F" />
            </linearGradient>
          </defs>
        </svg>
        <span className="print-header-word">Stapphire</span>
        <span className="print-header-tag">Hiring Quality Control</span>
        <span className="print-header-date">Generated {new Date().toLocaleDateString()}</span>
      </div>

      <div className="matrix-split">
        {/* ── Top: detail pane for the focused candidate ── */}
        <div className="matrix-detail-pane">
          <div className="matrix-title-row">
            <div className="matrix-req-title" title={requisitionTitle}>
              {requisitionTitle}
            </div>
            {shareToken && (
              <button className="qa-btn-text share-link-btn matrix-share-link" onClick={handleCopyLink}>
                <span>{linkCopied ? 'Link copied' : 'Share Link'}</span>
                <span className="share-link-icon">{linkCopied ? '✓' : '⧉'}</span>
              </button>
            )}
          </div>

          {onRefinePillars && (
            <div className="prompt-box">
              <div className="prompt-title">Job Specific Fit Prompt</div>
              <textarea
                className="prompt-input"
                placeholder="Enter to submit, Shift+Enter for a new line"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                disabled={savingPrompt}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitPrompt();
                  }
                }}
              />
              <div className="prompt-footer">
                <span className="upload-hint" style={{ margin: 0 }}>
                  {promptError ? (
                    <span style={{ color: 'var(--red)' }}>{promptError}</span>
                  ) : (
                    'Updates the criteria below immediately. Existing candidates only reflect it once re-evaluated.'
                  )}
                </span>
                <button
                  className="qa-btn-text"
                  disabled={savingPrompt || !promptText.trim()}
                  onClick={handleSubmitPrompt}
                >
                  {savingPrompt ? 'Updating criteria…' : 'Submit'}
                </button>
              </div>
            </div>
          )}

          {pillars.length > 0 && (
            <div className="pillars-table-wrap">
              <div className="section-label">Job-Specific Fit Criteria</div>
              <table className="pillars-table">
                <thead>
                  <tr>
                    <th>Requirement</th>
                    <th>Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {pillars.map((p, i) => (
                    <tr key={i}>
                      <td>{p.requirement}</td>
                      <td>{p.weight !== null ? `${p.weight}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!focused || !focusedEval ? (
            <div className="trash-empty-hint">Select a candidate below to see the full evaluation.</div>
          ) : (
            <div className="matrix-detail-card">
              <div className="matrix-detail-head">
                <div className="matrix-row-name" style={{ fontSize: 18 }}>
                  {focused.full_name}
                </div>
                <div className="facet-cell matrix-row-match">
                  <span className="score-num">{focusedEval.overall_match}%</span>
                  <div className={`facet-mini ${facetTier(focusedEval.overall_match)}`} />
                </div>
                <span className={`rec-pill ${focusedEval.status}`}>
                  {focusedEval.status.charAt(0).toUpperCase() + focusedEval.status.slice(1)}
                </span>
              </div>

              {Object.keys(focusedEval.matrix_dimensions ?? {}).length > 0 && (
                <>
                  <div className="section-label">Job-Specific Fit</div>
                  <div className="signal-row">
                    {Object.entries(focusedEval.matrix_dimensions).map(([k, v]) => (
                      <div className="signal-chip" key={k}>
                        <span className="signal-label">{k}</span>
                        <span className="signal-value">{v}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {Object.keys(focusedEval.signals ?? {}).length > 0 && (
                <>
                  <div className="section-label">Evaluation Signals</div>
                  <div className="signal-row">
                    {Object.entries(focusedEval.signals).map(
                      ([k, v]) =>
                        v && (
                          <div className="signal-chip" key={k}>
                            <span className="signal-label">{k.replace(/_/g, ' ')}</span>
                            <span className="signal-value">{v}</span>
                          </div>
                        )
                    )}
                  </div>
                </>
              )}

              <div className="two-col">
                <div>
                  <div className="section-label">Evidence</div>
                  <ul className="plain evidence">
                    {focusedEval.strengths?.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="section-label">Gaps</div>
                  <ul className="plain gaps">
                    {focusedEval.gaps?.map((g, idx) => (
                      <li key={idx}>{g}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {focusedEval.risk_flags?.length > 0 && (
                <>
                  <div className="section-label">Risk Flags</div>
                  <ul className="plain gaps">
                    {focusedEval.risk_flags.map((r, idx) => (
                      <li key={idx}>{r}</li>
                    ))}
                  </ul>
                </>
              )}

              <div className="matrix-row-actions">
                {focused.original_file_url && (
                  <button
                    className="qa-btn-text qa-btn-icon"
                    disabled={downloading === focused.id}
                    onClick={() => handleDownload(focused.id)}
                  >
                    <span className="qa-btn-icon-glyph">📄</span>
                    {downloading === focused.id ? 'Preparing download…' : 'Download Original Resume'}
                  </button>
                )}
                <button className="qa-btn-text qa-btn-icon" onClick={handlePrint}>
                  <span className="qa-btn-icon-glyph">🖨</span>
                  Print this evaluation
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Bottom: compact scannable list ── */}
        <div className="matrix-list-pane">
          <div className="filter-row">
            <MultiSelectFilter
              label="Status"
              options={[
                { value: 'greenlight', label: 'Greenlight' },
                { value: 'consider', label: 'Consider' },
                { value: 'decline', label: 'Decline' }
              ]}
              selected={statusFilter}
              onChange={setStatusFilter}
            />

            <MultiSelectFilter
              label="Disposition"
              options={[{ value: 'none', label: 'No Disposition' }, ...DISPOSITIONS]}
              selected={dispositionFilter}
              onChange={setDispositionFilter}
            />
          </div>

          <div className="bulk-bar">
            <label className="bulk-select-all">
              <input
                type="checkbox"
                checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
                onChange={toggleSelectAll}
              />
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
            </label>

            <div className={`bulk-actions ${selectedIds.size > 0 ? 'bulk-actions-visible' : ''}`}>
              <select
                className="disposition-select"
                value={bulkDisposition}
                onChange={(e) => setBulkDisposition(e.target.value)}
                disabled={selectedIds.size === 0}
              >
                <option value="">Set disposition…</option>
                {DISPOSITIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              <button
                className="qa-btn-text"
                disabled={!bulkDisposition || applyingBulk || selectedIds.size === 0}
                onClick={handleApplyBulk}
              >
                {applyingBulk ? 'Applying…' : 'Apply'}
              </button>
              {onBulkReevaluate && (
                <button
                  className="qa-btn-text"
                  disabled={selectedIds.size === 0}
                  onClick={handleReevaluateClick}
                  style={{ color: 'var(--deep)', borderBottomColor: 'var(--deep)' }}
                >
                  Re-evaluate ({selectedIds.size} credit{selectedIds.size !== 1 ? 's' : ''})
                </button>
              )}
              <button
                className="qa-btn-text"
                disabled={selectedIds.size === 0}
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="matrix-list">
            {filtered.map((c, i) => {
              const evalu = c.evaluations[0];
              const badge = rankBadgeClass(i + 1);
              const isFocused = focusedId === c.id;

              return (
                <div className={`matrix-row-compact ${isFocused ? 'matrix-row-focused' : ''}`} key={c.id}>
                  <input
                    type="checkbox"
                    className="matrix-row-checkbox"
                    checked={selectedIds.has(c.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelect(c.id)}
                  />
                  <span className="matrix-row-rank">
                    {badge ? <span className={badge}>{i + 1}</span> : <span className="rank-num">{i + 1}</span>}
                  </span>

                  <div className="matrix-row-main" onClick={() => handleFocus(c.id)}>
                    <div className="matrix-row-name">{c.full_name}</div>
                  </div>

                  <div className="facet-cell matrix-row-match" onClick={() => handleFocus(c.id)}>
                    <span className="score-num">{evalu.overall_match}%</span>
                    <div className={`facet-mini ${facetTier(evalu.overall_match)}`} />
                  </div>

                  <span className={`rec-pill ${evalu.status}`} onClick={() => handleFocus(c.id)}>
                    {evalu.status.charAt(0).toUpperCase() + evalu.status.slice(1)}
                  </span>

                  <select
                    className={`disposition-select ${
                      (localDisposition[c.id] ?? c.disposition) ? 'disposition-set' : ''
                    }`}
                    value={localDisposition[c.id] ?? c.disposition ?? ''}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleDispositionChange(c.id, e.target.value)}
                  >
                    <option value="">Disposition</option>
                    {DISPOSITIONS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                    <option value="__trash__">Move to Trash</option>
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
