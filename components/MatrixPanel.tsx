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
  profile_revision?: number | null;
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
  resume_text: string | null;
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

const STATUS_BADGE: Record<string, { icon: string; label: string; tier: string }> = {
  greenlight: { icon: '🟢', label: 'Recommend Interview', tier: 'Strong Match' },
  consider: { icon: '🟡', label: 'Consider', tier: 'Possible Match' },
  decline: { icon: '🔴', label: 'Decline', tier: 'Limited Match' }
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
  const [fullEvidenceOpen, setFullEvidenceOpen] = useState<Record<string, boolean>>({});
  const [resumeTextOpen, setResumeTextOpen] = useState<Record<string, boolean>>({});

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
  const [justRescored, setJustRescored] = useState<string | null>(null);
  const [justAppliedGlobally, setJustAppliedGlobally] = useState<string | null>(null);

  const [jdAttachedFile, setJdAttachedFile] = useState<File | null>(null);
  const [jdListening, setJdListening] = useState(false);
  const [jdVoiceSupported, setJdVoiceSupported] = useState(false);
  const jdFileInputRef = useRef<HTMLInputElement>(null);
  const jdRecognitionRef = useRef<any>(null);

  const [candidateAttachedFile, setCandidateAttachedFile] = useState<File | null>(null);
  const [candidateListening, setCandidateListening] = useState(false);
  const [candidateVoiceSupported, setCandidateVoiceSupported] = useState(false);
  const candidateFileInputRef = useRef<HTMLInputElement>(null);
  const candidateRecognitionRef = useRef<any>(null);
  const candidateListeningFor = useRef<string | null>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const supported = !!SpeechRecognition;
    setJdVoiceSupported(supported);
    setCandidateVoiceSupported(supported);
  }, []);
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
  const currentRevision = liveRevision ?? profileRevision;

  function isEvalStale(evalu: Evaluation): boolean {
    if (currentRevision === undefined) return false;
    if (evalu.profile_revision === null || evalu.profile_revision === undefined) return currentRevision > 1;
    return evalu.profile_revision !== currentRevision;
  }

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
    if ((!chatText.trim() && !jdAttachedFile) || sending) return;
    const text = chatText.trim();
    const file = jdAttachedFile;
    setChatText('');
    setJdAttachedFile(null);
    setSending(true);
    setChatError(null);
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: 'user', content: text || `Attached: ${file?.name}`, created_at: new Date().toISOString() }
    ]);

    try {
      const formData = new FormData();
      formData.append('message', text);
      formData.append('source', discoverySource);
      if (file) formData.append('file', file);

      const res = await fetch(`/api/requisitions/${requisitionId}/discovery`, { method: 'POST', body: formData });
      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error('That took too long to process — try again, or with a shorter message.');
      }
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

  function toggleJdListening() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (jdListening) {
      jdRecognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setChatText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setJdListening(false);
    recognition.onerror = () => setJdListening(false);
    jdRecognitionRef.current = recognition;
    recognition.start();
    setJdListening(true);
  }

  function handlePrint(candidateId?: string) {
    if (candidateId && !fullEvidenceOpen[candidateId]) {
      setFullEvidenceOpen((prev) => ({ ...prev, [candidateId]: true }));
      setTimeout(() => window.print(), 50);
      return;
    }
    window.print();
  }

  async function loadCandidateMessages(candidateId: string) {
    const res = await fetch(`/api/candidates/${candidateId}/discovery`, { cache: 'no-store' });
    const data = await res.json();
    setCandidateMessages((prev) => ({ ...prev, [candidateId]: data.messages ?? [] }));
    setCandidateMessagesLoaded((prev) => ({ ...prev, [candidateId]: true }));
  }

  function toggleCandidateListening(candidateId: string) {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (candidateListening) {
      candidateRecognitionRef.current?.stop();
      return;
    }
    candidateListeningFor.current = candidateId;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setCandidateChatDrafts((prev) => {
        const id = candidateListeningFor.current;
        if (!id) return prev;
        return { ...prev, [id]: (prev[id] ? `${prev[id]} ` : '') + transcript };
      });
    };
    recognition.onend = () => setCandidateListening(false);
    recognition.onerror = () => setCandidateListening(false);
    candidateRecognitionRef.current = recognition;
    recognition.start();
    setCandidateListening(true);
  }

  async function handleSendCandidateChat(candidateId: string) {
    const text = (candidateChatDrafts[candidateId] ?? '').trim();
    const file = candidateAttachedFile;
    if ((!text && !file) || candidateChatSending === candidateId) return;
    setCandidateChatDrafts((prev) => ({ ...prev, [candidateId]: '' }));
    setCandidateAttachedFile(null);
    setCandidateChatSending(candidateId);
    setCandidateChatError(null);
    setCandidateMessages((prev) => ({
      ...prev,
      [candidateId]: [
        ...(prev[candidateId] ?? []),
        { id: `local-${Date.now()}`, role: 'user', content: text || `Attached: ${file?.name}`, created_at: new Date().toISOString() }
      ]
    }));

    try {
      const formData = new FormData();
      formData.append('message', text);
      if (file) formData.append('file', file);

      const res = await fetch(`/api/candidates/${candidateId}/discovery`, { method: 'POST', body: formData });
      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error('That took too long to process — try again, or with a shorter message.');
      }
      if (!res.ok) throw new Error(data.error ?? 'Discovery failed');

      setCandidateMessages((prev) => ({
        ...prev,
        [candidateId]: [
          ...(prev[candidateId] ?? []),
          { id: `local-reply-${Date.now()}`, role: 'assistant', content: data.reply ?? '', created_at: new Date().toISOString() }
        ]
      }));

      if (data.reevaluated) {
        setJustRescored(candidateId);
        setTimeout(() => setJustRescored((id) => (id === candidateId ? null : id)), 3000);
        onProfileUpdated?.();
      }

      if (data.profile_changed) {
        setLiveProfile(data.profile);
        setLiveRevision(data.revision);
        setJustAppliedGlobally(candidateId);
        setTimeout(() => setJustAppliedGlobally((id) => (id === candidateId ? null : id)), 4000);
      }
    } catch (err: any) {
      setCandidateChatError(err?.message ?? 'Something went wrong.');
    } finally {
      setCandidateChatSending(null);
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
        `Re-evaluate ${ids.length} candidate${ids.length !== 1 ? 's' : ''} against the current Hiring Decision Model?`
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

  const staleCandidateIds = useMemo(
    () => scored.filter((c) => isEvalStale(c.evaluations[0])).map((c) => c.id),
    [scored, currentRevision]
  ); // eslint-disable-line react-hooks/exhaustive-deps

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
                  {jdAttachedFile && (
                    <div className="attach-pending" style={{ marginBottom: 8 }}>
                      {jdAttachedFile.name}
                      <button type="button" className="attach-remove" onClick={() => setJdAttachedFile(null)}>
                        ✕
                      </button>
                    </div>
                  )}
                  {chatError && (
                    <div className="upload-hint" style={{ color: 'var(--red)', marginBottom: 4 }}>
                      {chatError}
                    </div>
                  )}
                  <div className="composer-footer">
                    <input
                      ref={jdFileInputRef}
                      type="file"
                      accept=".pdf,.docx,.txt"
                      style={{ display: 'none' }}
                      onChange={(e) => setJdAttachedFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      className="composer-btn"
                      title="Attach a document"
                      onClick={() => jdFileInputRef.current?.click()}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className={`composer-btn ${jdListening ? 'composer-btn-active' : ''}`}
                      title={jdVoiceSupported ? 'Dictate' : 'Voice dictation not supported in this browser'}
                      disabled={!jdVoiceSupported}
                      onClick={toggleJdListening}
                    >
                      🎤
                    </button>
                    <div style={{ flex: 1 }} />
                    <button
                      type="button"
                      className="composer-send"
                      disabled={sending || (!chatText.trim() && !jdAttachedFile)}
                      onClick={handleSendChat}
                      title="Send"
                    >
                      {sending ? '…' : '↑'}
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
          {staleCandidateIds.length > 0 && onBulkReevaluate && (
            <div className="stale-consistency-banner">
              <span>
                ⚠ {staleCandidateIds.length} candidate{staleCandidateIds.length !== 1 ? 's' : ''} still scored against an
                outdated version of the Hiring Decision Model — not the same standard as the rest of the pool.
              </span>
              <button
                className="qa-btn-text"
                style={{ flexShrink: 0 }}
                onClick={() => onBulkReevaluate(staleCandidateIds)}
              >
                Re-evaluate All Outdated
              </button>
            </div>
          )}

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
                  Re-evaluate ({selectedIds.size})
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
                      {evalu.job_description_match !== null && evalu.job_description_match !== undefined ? (
                        <div className="dual-bar-mini">
                          <div className="dual-bar-row">
                            <span className="dual-bar-label dual-bar-label-jd">JD</span>
                            <div className="dual-bar-track">
                              <div className="dual-bar-fill dual-bar-jd" style={{ width: `${evalu.job_description_match}%` }} />
                            </div>
                            <span className="dual-bar-num dual-bar-num-jd">{evalu.job_description_match}%</span>
                          </div>
                          <div className="dual-bar-row">
                            <span className="dual-bar-label dual-bar-label-profile">HP</span>
                            <div className="dual-bar-track">
                              <div className="dual-bar-fill dual-bar-profile" style={{ width: `${evalu.overall_match}%` }} />
                            </div>
                            <span className="dual-bar-num dual-bar-num-profile">{evalu.overall_match}%</span>
                          </div>
                        </div>
                      ) : (
                        <>
                          <span className="score-num">{evalu.overall_match}%</span>
                          <div className={`facet-mini ${facetTier(evalu.overall_match)}`} />
                        </>
                      )}
                    </div>

                    <span className={`rec-pill ${evalu.status}`}>
                      {evalu.status.charAt(0).toUpperCase() + evalu.status.slice(1)}
                    </span>

                    {isEvalStale(evalu) && (
                      <span className="stale-badge" title="Scored against an earlier version of the Hiring Decision Model">
                        Outdated Standard
                      </span>
                    )}

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
                      <div className="candidate-decision-header">
                        <div className="candidate-decision-score">
                          <span className="candidate-decision-num">{evalu.overall_match}%</span>
                          <span className="candidate-decision-tier">{STATUS_BADGE[evalu.status]?.tier ?? ''}</span>
                        </div>
                        <div className={`candidate-decision-badge candidate-decision-badge-${evalu.status}`}>
                          <span>{STATUS_BADGE[evalu.status]?.icon}</span>
                          {STATUS_BADGE[evalu.status]?.label ?? evalu.status}
                        </div>
                      </div>

                      {evalu.resume_gap_flag && (
                        <div className="risk-note flagged" style={{ marginBottom: 16 }}>
                          Résumé Gap: {evalu.resume_gap_flag}
                        </div>
                      )}

                      {evalu.strengths?.length > 0 && (
                        <>
                          <div className="section-label">Why</div>
                          <ul className="plain evidence" style={{ marginBottom: 16 }}>
                            {evalu.strengths.map((s, idx) => (
                              <li key={idx}>{s}</li>
                            ))}
                          </ul>
                        </>
                      )}

                      {(() => {
                        const verify = (evalu.gaps_structured ?? []).filter(
                          (g) => g.category === 'verification' || g.category === 'resume_gap'
                        );
                        if (verify.length === 0) return null;
                        return (
                          <>
                            <div className="section-label">What to Verify</div>
                            <ul className="plain verify-list" style={{ marginBottom: 16 }}>
                              {verify.map((g, idx) => (
                                <li key={idx}>{g.description}</li>
                              ))}
                            </ul>
                          </>
                        );
                      })()}

                      {(() => {
                        const trainable = (evalu.gaps_structured ?? []).filter(
                          (g) => g.category === 'trainable' || g.category === 'employer_specific'
                        );
                        if (trainable.length === 0) return null;
                        return (
                          <>
                            <div className="section-label">Trainable After Hire</div>
                            <ul className="plain trainable-list" style={{ marginBottom: 16 }}>
                              {trainable.map((g, idx) => (
                                <li key={idx}>{g.description}</li>
                              ))}
                            </ul>
                          </>
                        );
                      })()}

                      {(() => {
                        const realGaps = (evalu.gaps_structured ?? []).filter(
                          (g) => g.category === 'critical' || g.category === 'moderate'
                        );
                        if (realGaps.length === 0 && !evalu.gaps_structured) {
                          // fall back to legacy flat gaps for old evaluations
                          return evalu.gaps?.length > 0 ? (
                            <>
                              <div className="section-label">Gap</div>
                              <ul className="plain gaps" style={{ marginBottom: 16 }}>
                                {evalu.gaps.map((g, idx) => (
                                  <li key={idx}>{g}</li>
                                ))}
                              </ul>
                            </>
                          ) : null;
                        }
                        if (realGaps.length === 0) return null;
                        return (
                          <>
                            <div className="section-label">Gap</div>
                            <ul className="plain gaps" style={{ marginBottom: 16 }}>
                              {realGaps.map((g, idx) => (
                                <li key={idx}>{g.description}</li>
                              ))}
                            </ul>
                          </>
                        );
                      })()}

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

                        {justAppliedGlobally === c.id && (
                          <div className="rescored-banner rescored-banner-global">
                            🌐 Applied to the Hiring Decision Model — this now applies to every candidate in this requisition
                          </div>
                        )}
                        {justRescored === c.id && <div className="rescored-banner">↻ Re-scored based on this conversation</div>}

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
                          {candidateAttachedFile && (
                            <div className="attach-pending" style={{ marginBottom: 8 }}>
                              {candidateAttachedFile.name}
                              <button type="button" className="attach-remove" onClick={() => setCandidateAttachedFile(null)}>
                                ✕
                              </button>
                            </div>
                          )}
                          {candidateChatError && (
                            <div className="upload-hint" style={{ color: 'var(--red)', marginBottom: 4 }}>
                              {candidateChatError}
                            </div>
                          )}
                          <div className="composer-footer">
                            <input
                              ref={candidateFileInputRef}
                              type="file"
                              accept=".pdf,.docx,.txt"
                              style={{ display: 'none' }}
                              onChange={(e) => setCandidateAttachedFile(e.target.files?.[0] ?? null)}
                            />
                            <button
                              type="button"
                              className="composer-btn"
                              title="Attach a document"
                              onClick={() => candidateFileInputRef.current?.click()}
                            >
                              +
                            </button>
                            <button
                              type="button"
                              className={`composer-btn ${candidateListening ? 'composer-btn-active' : ''}`}
                              title={candidateVoiceSupported ? 'Dictate' : 'Voice dictation not supported in this browser'}
                              disabled={!candidateVoiceSupported}
                              onClick={() => toggleCandidateListening(c.id)}
                            >
                              🎤
                            </button>
                            <div style={{ flex: 1 }} />
                            <button
                              type="button"
                              className="composer-send"
                              disabled={
                                candidateChatSending === c.id || (!(candidateChatDrafts[c.id] ?? '').trim() && !candidateAttachedFile)
                              }
                              onClick={() => handleSendCandidateChat(c.id)}
                              title="Send"
                            >
                              {candidateChatSending === c.id ? '…' : '↑'}
                            </button>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="full-evidence-toggle"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFullEvidenceOpen((prev) => ({ ...prev, [c.id]: !prev[c.id] }));
                        }}
                      >
                        {fullEvidenceOpen[c.id] ? 'Hide Full Evidence ▴' : 'View Full Evidence ▾'}
                      </button>

                      {fullEvidenceOpen[c.id] && (
                        <div className="full-evidence-panel" onClick={(e) => e.stopPropagation()}>
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

                          {evalu.gaps_structured && evalu.gaps_structured.length > 0 && (
                            <>
                              <div className="section-label">All Gaps, Categorized</div>
                              {GAP_CATEGORY_ORDER.map((cat) => {
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
                              })}
                            </>
                          )}

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
                        </div>
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
                          disabled={!c.resume_text}
                          title={c.resume_text ? undefined : 'Not available for this candidate yet — re-evaluate to extract it'}
                          onClick={(e) => {
                            e.stopPropagation();
                            setResumeTextOpen((prev) => ({ ...prev, [c.id]: !prev[c.id] }));
                          }}
                        >
                          <span className="qa-btn-icon-glyph">📝</span>
                          {resumeTextOpen[c.id] ? 'Hide Résumé Text' : 'View Résumé Text'}
                        </button>
                        <button
                          className="qa-btn-text qa-btn-icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePrint(c.id);
                          }}
                        >
                          <span className="qa-btn-icon-glyph">🖨</span>
                          Print this evaluation
                        </button>
                      </div>

                      {resumeTextOpen[c.id] && c.resume_text && (
                        <div className="resume-text-panel" onClick={(e) => e.stopPropagation()}>
                          <div className="section-label">Résumé Text</div>
                          <pre className="resume-text-content">{c.resume_text}</pre>
                        </div>
                      )}
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
