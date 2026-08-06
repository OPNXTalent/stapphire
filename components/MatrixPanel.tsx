'use client';

import { useEffect, useMemo, useState } from 'react';

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
  evaluations: Evaluation[];
};

const FILTERS = ['All', 'Greenlight', 'Consider', 'Decline', 'Local', 'Relocation', 'Current Employee', 'Former Employee'];

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

// Expanding a row IS selecting it — no separate "Private Notes" /
// "Collaboration" buttons needed. The side panel just follows whichever
// candidate is currently expanded via onSelectCandidate.
export function MatrixPanel({
  candidates,
  onSelectCandidate,
  onDelete
}: {
  candidates: Candidate[];
  onSelectCandidate: (candidateId: string) => void;
  onDelete: (candidateId: string) => void;
}) {
  const [filter, setFilter] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    function clearPrint() {
      setPrintingId(null);
    }
    window.addEventListener('afterprint', clearPrint);
    return () => window.removeEventListener('afterprint', clearPrint);
  }, []);

  function handlePrint(id: string) {
    setPrintingId(id);
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
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

  function handleToggleRow(id: string, isOpen: boolean) {
    const opening = !isOpen;
    setExpandedId(opening ? id : null);
    if (opening) onSelectCandidate(id);
  }

  const scored = useMemo(
    () =>
      candidates
        .filter((c) => c.document_type === 'resume' && c.evaluations?.[0])
        .sort((a, b) => b.evaluations[0].overall_match - a.evaluations[0].overall_match),
    [candidates]
  );

  const filtered = useMemo(() => {
    if (filter === 'All') return scored;
    if (['Greenlight', 'Consider', 'Decline'].includes(filter)) {
      return scored.filter((c) => c.evaluations[0].status === filter.toLowerCase());
    }
    return scored.filter((c) => {
      const signals = c.evaluations[0].signals ?? {};
      const haystack = Object.values(signals).join(' ').toLowerCase();
      return haystack.includes(filter.toLowerCase());
    });
  }, [scored, filter]);

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

      <div className="matrix-wrap open">
        <div className="matrix-scroll">
          <div className="filter-row">
            {FILTERS.map((f) => (
              <span
                key={f}
                className={`filter-chip ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f}
              </span>
            ))}
          </div>

          <div className="matrix-list">
            {filtered.map((c, i) => {
              const evalu = c.evaluations[0];
              const badge = rankBadgeClass(i + 1);
              const isOpen = expandedId === c.id;

              return (
                <div
                  className={`matrix-row ${isOpen ? 'expanded' : ''} ${printingId === c.id ? 'print-target' : ''}`}
                  key={c.id}
                >
                  <div className="matrix-row-head" onClick={() => handleToggleRow(c.id, isOpen)}>
                    <span className="matrix-row-rank">
                      {badge ? <span className={badge}>{i + 1}</span> : <span className="rank-num">{i + 1}</span>}
                    </span>

                    <div className="matrix-row-main">
                      <div className="matrix-row-name">{c.full_name}</div>
                    </div>

                    <div className="facet-cell matrix-row-match">
                      <span className="score-num">{evalu.overall_match}%</span>
                      <div className={`facet-mini ${facetTier(evalu.overall_match)}`} />
                    </div>

                    <span className={`rec-pill ${evalu.status}`}>
                      {evalu.status.charAt(0).toUpperCase() + evalu.status.slice(1)}
                    </span>

                    <button
                      className="matrix-row-delete"
                      title="Move to trash"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(c.id);
                      }}
                    >
                      🗑
                    </button>

                    <span className="matrix-row-chev">▾</span>
                  </div>

                  {isOpen && (
                    <div className="matrix-row-body">
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
                          <ul className="plain gaps">
                            {evalu.gaps?.map((g, idx) => (
                              <li key={idx}>{g}</li>
                            ))}
                          </ul>
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
                            className="qa-btn-text"
                            disabled={downloading === c.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(c.id);
                            }}
                          >
                            {downloading === c.id ? 'Preparing download…' : 'Download Original Resume'}
                          </button>
                        )}
                        <button
                          className="qa-btn-text"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePrint(c.id);
                          }}
                        >
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
