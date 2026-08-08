'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DISPOSITIONS } from '@/lib/dispositions';
import { normalizeHiringProfile, type HiringProfile } from '@/lib/hiringProfile';
import { MultiSelectFilter } from '@/components/MultiSelectFilter';

type ContextAssessment = {
  newly_established?: string[];
  strengthened?: string[];
  still_unverified?: string[];
  new_concerns?: string[];
};

type GapItem = {
  description: string;
  category: 'critical' | 'moderate' | 'trainable' | 'resume_gap' | 'verification' | 'employer_specific' | 'superseded';
};

type Evaluation = {
  overall_match: number;
  job_description_match: number | null;
  status: 'greenlight' | 'consider' | 'decline';
  signals: Record<string, string>;
  matrix_dimensions: Record<string, string>;
  strengths: string[];
  gaps: string[];
  gaps_structured?: GapItem[] | null;
  risk_flags: string[];
  resume_gap_flag?: string | null;
  context_assessment?: ContextAssessment | null;
};

type Candidate = {
  id: string;
  full_name: string;
  document_type: string;
  source_filename: string | null;
  original_file_url: string | null;
  disposition: string | null;
  additional_context: string | null;
  evaluations: Evaluation[];
};

type DiscoveryMessage = { id: string; role: 'user' | 'assistant'; content: string; created_at: string };

const GAP_CATEGORY_LABELS: Record<GapItem['category'], string> = {
  critical: 'Critical Gap',
  moderate: 'Moderate Gap',
  trainable: 'Trainable Gap',
  resume_gap: 'Résumé Gap',
  verification: 'Verification Item',
  employer_specific: 'Employer-Specific Knowledge',
  superseded: 'Superseded'
};
const GAP_CATEGORY_ORDER: GapItem['category'][] = [
  'critical',
  'moderate',
  'resume_gap',
  'verification',
  'trainable',
  'employer_specific',
  'superseded'
];

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

// Master-detail layout: the top pane is role-level only — title, and
// a toggleable discovery chat that shapes the living Hiring Decision
// Model. The bottom pane is everything candidate-related: the compact
// list plus whichever row is expanded.
export function MatrixPanel({
  candidates,
  requisitionId,
  requisitionTitle,
  shareToken,
  hiringProfile,
  profileRevision,
  discoverySource = 'recruiter_discovery',
  onProfileUpdated,
  onSelectCandidate,
  onDelete,
  onSetDisposition,
  onBulkSetDisposition,
  onBulkReevaluate
}: {
  candidates: Candidate[];
  requisitionId: string;
  requisitionTitle: string;
  shareToken?: string;
  hiringProfile?: unknown;
  profileRevision?: number;
  discoverySource?: 'recruiter_discovery' | 'hiring_leader_discovery';
  onProfileUpdated?: () => void;
  onSelectCandidate: (candidateId: string | null) => void;
  onDelete: (candidateId: string) => void;
  onSetDisposition: (candidateId: string, disposition: string) => void;
  onBulkSetDisposition: (candidateIds: string[], disposition: string) => void;
  onBulkReevaluate?: (candidateIds: string[]) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [dispositionFilter, setDispositionFilter] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (expandedId && !candidateMessagesLoaded[expandedId]) {
      loadCandidateMessages(expandedId);
    }
  }, [expandedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [downloading, setDownloading] = useState<string | null>(null);
  const [candidateMessages, setCandidateMessages] = useState<Record<string, DiscoveryMessage[]>>({});
  const [candidateMessagesLoaded, setCandidateMessagesLoaded] = useState<Record<string, boolean>>({});
  const [candidateChatDrafts, setCandidateChatDrafts] = useState<Record<string, string>>({});
  const [candidateChatSending, setCandidateChatSending] = useState<string | null>(null);
  const [candidateChatError, setCandidateChatError] = useState<string | null>(null);
  const [localDisposition, setLocalDisposition] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDisposition, setBulkDisposition] = useState('');
  const [applyingBulk, setApplyingBulk] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);

  const [messages, setMessages] = useState<DiscoveryMessage[]>([]);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [chatText, setChatText] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [liveProfile, setLiveProfile] = useState<HiringProfile | null>(null);
  const [liveRevision, setLiveRevision] = useState<number | undefined>(profileRevision);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const profile = liveProfile ?? normalizeHiringProfile(hiringProfile);

  useEffect(() => {
    setLiveProfile(null);
    setLiveRevision(profileRevision);
  }, [requisitionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (discoveryOpen && !messagesLoaded) {
      fetch(`/api/requisitions/${requisitionId}/discovery`, { cache: 'no-store' })
        .then((res) => res.json())
        .then((data) => {
          setMessages(data.messages ?? []);
          setMessagesLoaded(true);
        });
    }
  }, [discoveryOpen, messagesLoaded, requisitionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSendChat() {
    if (!chatText.trim() || sending) return;
    const text = chatText.trim();
    setChatText('');
    setSending(true);
    setChatError(null);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content: text, created_at: new Date().toISOString() }]);

    try {
      const res = await fetch(`/api/requisitions/${requisitionId}/discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, source: discoverySource })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Discovery failed');

      setMessages((prev) => [
        ...prev,
        { id: `local-reply-${Date.now()}`, role: 'assistant', content: data.reply ?? '', created_at: new Date().toISOString() }
      ]);

      if (data.profile_changed) {
        setLiveProfile(data.profile);
        setLiveRevision(data.revision);
        onProfileUpdated?.();
      }
    } catch (err: any) {
      setChatError(err?.message ?? 'Something went wrong.');
    } finally {
      setSending(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  async function loadCandidateMessages(candidateId: string) {
    const res = await fetch(`/api/candidates/${candidateId}/discovery`, { cache: 'no-store' });
    const data = await res.json();
    setCandidateMessages((prev) => ({ ...prev, [candidateId]: data.messages ?? [] }));
    setCandidateMessagesLoaded((prev) => ({ ...prev, [candidateId]: true }));
  }

  async function handleSendCandidateChat(candidateId: string) {
    const text = (candidateChatDrafts[candidateId] ?? '').trim();
    if (!text || candidateChatSending === candidateId) return;
    setCandidateChatDrafts((prev) => ({ ...prev, [candidateId]: '' }));
    setCandidateChatSending(candidateId);
    setCandidateChatError(null);
    setCandidateMessages((prev) => ({
      ...prev,
      [candidateId]: [
        ...(prev[candidateId] ?? []),
        { id: `local-${Date.now()}`, role: 'user', content: text, created_at: new Date().toISOString() }
      ]
    }));

    try {
      const res = await fetch(`/api/candidates/${candidateId}/discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Discovery failed');

      setCandidateMessages((prev) => ({
        ...prev,
        [candidateId]: [
          ...(prev[candidateId] ?? []),
          { id: `local-reply-${Date.now()}`, role: 'assistant', content: data.reply ?? '', created_at: new Date().toISOString() }
        ]
      }));
    } catch (err: any) {
      setCandidateChatError(err?.message ?? 'Something went wrong.');
    } finally {
      setCandidateChatSending(null);
    }
  }

  function handleReevaluateSingle(candidateId: string, name: string) {
    if (!onBulkReevaluate) return;
    if (
      window.confirm(
        `Re-evaluate ${name} with this additional context? This uses 1 credit, same as a fresh evaluation.`
      )
    ) {
      onBulkReevaluate([candidateId]);
    }
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

  function handleToggleRow(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      onSelectCandidate(null);
    } else {
      setExpandedId(id);
      onSelectCandidate(id);
    }
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
    const ids = Array.from(selectedIds);

    if (bulkDisposition === '__trash__') {
      if (
        !window.confirm(
          `Move ${ids.length} candidate${ids.length !== 1 ? 's' : ''} to trash? They stay recoverable until trash is emptied.`
        )
      )
        return;
      setApplyingBulk(true);
      try {
        ids.forEach((id) => onDelete(id));
        setSelectedIds(new Set());
        setBulkDisposition('');
      } finally {
        setApplyingBulk(false);
      }
      return;
    }

    setApplyingBulk(true);
    try {
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
        `Re-evaluate ${ids.length} candidate${ids.length !== 1 ? 's' : ''} against the current Hiring Decision Model? This uses ${ids.length} credit${ids.length !== 1 ? 's' : ''} — one per candidate, same as a fresh evaluation.`
      )
    ) {
      onBulkReevaluate(ids);
      setSelectedIds(new Set());
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

  useEffect(() => {
    if (expandedId && !filtered.some((c) => c.id === expandedId)) {
      setExpandedId(null);
    }
  }, [filtered, expandedId]);

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
        {/* ── Top: role-level only — title, and a toggleable discovery chat that shapes the Hiring Decision Model. ── */}
        <div className={`matrix-role-pane ${discoveryOpen ? 'matrix-role-pane-full' : ''}`}>
          <div className="matrix-title-row" onClick={() => setDiscoveryOpen((o) => !o)} style={{ cursor: 'pointer' }}>
            <div className="matrix-req-title" title={requisitionTitle}>
              <span className="matrix-title-chev">{discoveryOpen ? '▾' : '▸'}</span>
              {requisitionTitle}
              {liveRevision !== undefined && <span className="profile-revision-badge">Rev {liveRevision}</span>}
            </div>
            {shareToken && (
              <button
                className="qa-btn-text share-link-btn matrix-share-link"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyLink();
                }}
              >
                <span>{linkCopied ? 'Link copied' : 'Share Link'}</span>
                <span className="share-link-icon">{linkCopied ? '✓' : '⧉'}</span>
              </button>
            )}
          </div>

          {discoveryOpen && (
            <div onClick={(e) => e.stopPropagation()}>
              <div className="section-label">Hiring Discovery</div>
              <div className="discovery-chat">
                <div className="discovery-messages">
                  {!messagesLoaded ? (
                    <div className="trash-empty-hint">Loading…</div>
                  ) : messages.length === 0 ? (
                    <div className="trash-empty-hint">
                      Tell me what matters most for this role — I'll shape the Hiring Decision Model as we talk.
                    </div>
                  ) : (
                    messages.map((m) => (
                      <div key={m.id} className={`discovery-msg discovery-msg-${m.role}`}>
                        {m.content}
                      </div>
                    ))
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="prompt-box" style={{ marginTop: 8 }}>
                  <textarea
                    className="prompt-input"
                    placeholder="+ Stapphire Prompt"
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    disabled={sending}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendChat();
                      }
                    }}
                  />
                  <div className="prompt-footer">
                    <span className="upload-hint" style={{ margin: 0 }}>
                      {chatError ? (
                        <span style={{ color: 'var(--red)' }}>{chatError}</span>
                      ) : (
                        'Updates the model when it materially changes understanding of the role. Existing candidates only reflect it once re-evaluated.'
                      )}
                    </span>
                    <button className="qa-btn-text" disabled={sending || !chatText.trim()} onClick={handleSendChat}>
                      {sending ? 'Thinking…' : 'Send'}
                    </button>
                  </div>
                </div>
              </div>

              {profile.categories.length > 0 && (
                <div className="pillars-table-wrap">
                  <div className="section-label">Hiring Decision Model</div>
                  {profile.categories.map((cat) => (
                    <div className="hdm-category" key={cat.name}>
                      <div className="hdm-category-head">
                        <span>{cat.name}</span>
                        <span>{cat.weight}%</span>
                      </div>
                      {cat.subcriteria.length > 0 && (
                        <table className="pillars-table">
                          <tbody>
                            {cat.subcriteria.map((s, i) => (
                              <tr key={i}>
                                <td>{s.name}</td>
                                <td>{s.weight}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Bottom: everything candidate-related — the compact list, and the focused candidate's full evaluation. ── */}
        <div className={`matrix-list-pane ${discoveryOpen ? 'matrix-list-pane-hidden' : ''}`}>
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
                <option value="__trash__">Move to Trash</option>
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
              const isOpen = expandedId === c.id;

              return (
                <div className={`matrix-row ${isOpen ? 'expanded' : ''}`} key={c.id}>
                  <div className="matrix-row-head" onClick={() => handleToggleRow(c.id)}>
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

                    <div className="matrix-row-main">
                      <div className="matrix-row-name">{c.full_name}</div>
                    </div>

                    <div className="facet-cell matrix-row-match">
                      <span className="score-num">{evalu.overall_match}%</span>
                      {evalu.job_description_match !== null && evalu.job_description_match !== undefined ? (
                        <div
                          className="dual-bar-mini"
                          title={`Job Description Match: ${evalu.job_description_match}% · Hiring Profile Match: ${evalu.overall_match}%`}
                        >
                          <div className="dual-bar-track">
                            <div className="dual-bar-fill dual-bar-jd" style={{ width: `${evalu.job_description_match}%` }} />
                          </div>
                          <div className="dual-bar-track">
                            <div className="dual-bar-fill dual-bar-profile" style={{ width: `${evalu.overall_match}%` }} />
                          </div>
                        </div>
                      ) : (
                        <div className={`facet-mini ${facetTier(evalu.overall_match)}`} />
                      )}
                    </div>

                    <span className={`rec-pill ${evalu.status}`}>
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

                    <span className="matrix-row-chev">{isOpen ? '▾' : '▸'}</span>
                  </div>

                  {isOpen && (
                    <div className="matrix-row-body">
                      {evalu.job_description_match !== null && evalu.job_description_match !== undefined && (
                        <div className="dual-match-row">
                          <div className="dual-match-item">
                            <span className="signal-label">Job Description Match</span>
                            <span className="dual-match-num">{evalu.job_description_match}%</span>
                          </div>
                          <div className="dual-match-item">
                            <span className="signal-label">Hiring Profile Match</span>
                            <span className="dual-match-num dual-match-primary">
                              {evalu.overall_match}%
                              {c.evaluations.length > 1 &&
                                (() => {
                                  const delta = evalu.overall_match - c.evaluations[1].overall_match;
                                  if (delta === 0) return null;
                                  return (
                                    <span className={`match-delta ${delta > 0 ? 'match-delta-up' : 'match-delta-down'}`}>
                                      {delta > 0 ? '↑' : '↓'} {Math.abs(delta)}
                                    </span>
                                  );
                                })()}
                            </span>
                          </div>
                        </div>
                      )}

                      {evalu.resume_gap_flag && (
                        <div className="risk-note flagged" style={{ marginBottom: 16 }}>
                          Résumé Gap: {evalu.resume_gap_flag}
                        </div>
                      )}

                      <div className="section-label">Additional Candidate Context</div>
                      <div className="discovery-chat" onClick={(e) => e.stopPropagation()}>
                        <div className="discovery-messages">
                          {!candidateMessagesLoaded[c.id] ? (
                            <div className="trash-empty-hint">Loading…</div>
                          ) : (candidateMessages[c.id] ?? []).length === 0 ? (
                            <div className="trash-empty-hint">
                              Tell me anything about this candidate that isn't on their résumé — current role, internal
                              feedback, confirmed skills.
                            </div>
                          ) : (
                            (candidateMessages[c.id] ?? []).map((m) => (
                              <div key={m.id} className={`discovery-msg discovery-msg-${m.role}`}>
                                {m.content}
                              </div>
                            ))
                          )}
                        </div>

                        <div className="prompt-box" style={{ marginTop: 8 }}>
                          <textarea
                            className="prompt-input"
                            placeholder="Tell me..."
                            value={candidateChatDrafts[c.id] ?? ''}
                            onChange={(e) => setCandidateChatDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            disabled={candidateChatSending === c.id}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendCandidateChat(c.id);
                              }
                            }}
                          />
                          <div className="prompt-footer">
                            <span className="upload-hint" style={{ margin: 0 }}>
                              {candidateChatError ? (
                                <span style={{ color: 'var(--red)' }}>{candidateChatError}</span>
                              ) : (
                                'Free to discuss — re-evaluate separately to see it reflected in scoring.'
                              )}
                            </span>
                            <span style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
                              <button
                                className="qa-btn-text"
                                disabled={candidateChatSending === c.id || !(candidateChatDrafts[c.id] ?? '').trim()}
                                onClick={() => handleSendCandidateChat(c.id)}
                              >
                                {candidateChatSending === c.id ? 'Thinking…' : 'Send'}
                              </button>
                              {onBulkReevaluate && (
                                <button
                                  className="qa-btn-text"
                                  style={{ color: 'var(--deep)', borderBottomColor: 'var(--deep)' }}
                                  onClick={() => handleReevaluateSingle(c.id, c.full_name)}
                                >
                                  Re-evaluate (1 credit)
                                </button>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>

                      {evalu.context_assessment && (
                        <>
                          {(evalu.context_assessment.newly_established?.length ?? 0) > 0 && (
                            <>
                              <div className="section-label">Newly Established</div>
                              <ul className="plain evidence">
                                {evalu.context_assessment!.newly_established!.map((s, idx) => (
                                  <li key={idx}>{s}</li>
                                ))}
                              </ul>
                            </>
                          )}
                          {(evalu.context_assessment.strengthened?.length ?? 0) > 0 && (
                            <>
                              <div className="section-label">Strengthened</div>
                              <ul className="plain evidence">
                                {evalu.context_assessment!.strengthened!.map((s, idx) => (
                                  <li key={idx}>{s}</li>
                                ))}
                              </ul>
                            </>
                          )}
                          {(evalu.context_assessment.still_unverified?.length ?? 0) > 0 && (
                            <>
                              <div className="section-label">Still Unverified</div>
                              <ul className="plain gaps">
                                {evalu.context_assessment!.still_unverified!.map((s, idx) => (
                                  <li key={idx}>{s}</li>
                                ))}
                              </ul>
                            </>
                          )}
                          {(evalu.context_assessment.new_concerns?.length ?? 0) > 0 && (
                            <>
                              <div className="section-label">New Concerns</div>
                              <ul className="plain gaps">
                                {evalu.context_assessment!.new_concerns!.map((s, idx) => (
                                  <li key={idx}>{s}</li>
                                ))}
                              </ul>
                            </>
                          )}
                        </>
                      )}

                      {Object.keys(evalu.matrix_dimensions ?? {}).length > 0 && (
                        <>
                          <div className="section-label">Job-Specific Fit</div>
                          <div className="signal-row">
                            {Object.entries(evalu.matrix_dimensions).map(([k, v]) => (
                              <div className="signal-chip" key={k}>
                                <span className="signal-label">{k}</span>
                                <span className="signal-value">{v}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}

                      {Object.keys(evalu.signals ?? {}).length > 0 && (
                        <>
                          <div className="section-label">Evaluation Signals</div>
                          <div className="signal-row">
                            {Object.entries(evalu.signals).map(
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
                            {evalu.strengths?.map((s, idx) => (
                              <li key={idx}>{s}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="section-label">Gaps</div>
                          {evalu.gaps_structured && evalu.gaps_structured.length > 0 ? (
                            GAP_CATEGORY_ORDER.map((cat) => {
                              const items = evalu.gaps_structured!.filter((g) => g.category === cat);
                              if (items.length === 0) return null;
                              return (
                                <div key={cat} className="gap-category-group">
                                  <div className="gap-category-label">{GAP_CATEGORY_LABELS[cat]}</div>
                                  <ul className="plain gaps">
                                    {items.map((g, idx) => (
                                      <li key={idx}>{g.description}</li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            })
                          ) : (
                            <ul className="plain gaps">
                              {evalu.gaps?.map((g, idx) => (
                                <li key={idx}>{g}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      {evalu.risk_flags?.length > 0 && (
                        <>
                          <div className="section-label">Risk Flags</div>
                          <ul className="plain gaps">
                            {evalu.risk_flags.map((r, idx) => (
                              <li key={idx}>{r}</li>
                            ))}
                          </ul>
                        </>
                      )}

                      <div className="matrix-row-actions">
                        {c.original_file_url && (
                          <button
                            className="qa-btn-text qa-btn-icon"
                            disabled={downloading === c.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(c.id);
                            }}
                          >
                            <span className="qa-btn-icon-glyph">📄</span>
                            {downloading === c.id ? 'Preparing download…' : 'Download Original Resume'}
                          </button>
                        )}
                        <button
                          className="qa-btn-text qa-btn-icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePrint();
                          }}
                        >
                          <span className="qa-btn-icon-glyph">🖨</span>
                          Print this evaluation
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
