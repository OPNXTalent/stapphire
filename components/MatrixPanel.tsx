'use client';

import { useMemo, useState } from 'react';

type Candidate = {
  id: string;
  full_name: string;
  document_type: string;
  evaluations: {
    overall_match: number;
    status: 'greenlight' | 'consider' | 'decline';
    signals: Record<string, string>;
    matrix_dimensions: Record<string, string>;
    risk_flags: string[];
  }[];
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

// Matrix cells are for scanning, not reading — full reasoning belongs in
// the candidate card below. Show a short lead-in here, full text on
// hover via the native title tooltip.
function shortLabel(text: string, maxLen = 28): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 12 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

export function MatrixPanel({ candidates }: { candidates: Candidate[] }) {
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState('All');

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

  const dimensionKeys = useMemo(() => {
    const first = scored.find((c) => c.evaluations[0]?.matrix_dimensions);
    return first ? Object.keys(first.evaluations[0].matrix_dimensions) : [];
  }, [scored]);

  return (
    <>
      <div className={`matrix-toggle ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}>
        <svg className="facet-icon" viewBox="0 0 24 24" fill="none">
          <polygon points="12,1 21,7 24,14 17,23 7,23 0,14 3,7" fill="var(--sapphire)" />
        </svg>
        <div className="matrix-toggle-label">Candidate Matrix</div>
        <div className="matrix-toggle-sub">Same rubric, every candidate — evidence compared side by side</div>
        <div className="matrix-toggle-chev">▾</div>
      </div>

      <div className={`matrix-wrap ${open ? 'open' : ''}`}>
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

          <table className="matrix">
            <thead>
              <tr>
                <th className="matrix-sticky matrix-sticky-1">Rank</th>
                <th className="matrix-sticky matrix-sticky-2">Candidate</th>
                <th className="matrix-sticky matrix-sticky-3">Job Match</th>
                {dimensionKeys.map((k) => (
                  <th key={k}>{k}</th>
                ))}
                <th>Key Risk</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const evalu = c.evaluations[0];
                const badge = rankBadgeClass(i + 1);
                const topRisk = evalu.risk_flags?.[0];
                return (
                  <tr key={c.id}>
                    <td className="matrix-sticky matrix-sticky-1">
                      {badge ? <span className={badge}>{i + 1}</span> : i + 1}
                    </td>
                    <td className="cand-name matrix-sticky matrix-sticky-2">{c.full_name}</td>
                    <td className="matrix-sticky matrix-sticky-3">
                      <div className="facet-cell">
                        <span className="score-num">{evalu.overall_match}%</span>
                        <div className={`facet-mini ${facetTier(evalu.overall_match)}`} />
                      </div>
                    </td>
                    {dimensionKeys.map((k) => {
                      const value = evalu.matrix_dimensions?.[k];
                      return (
                        <td key={k} title={value ?? undefined}>
                          {value ? shortLabel(value) : '—'}
                        </td>
                      );
                    })}
                    <td title={topRisk ?? undefined}>{topRisk ? shortLabel(topRisk, 34) : '—'}</td>
                    <td>
                      <span className={`rec-pill ${evalu.status}`}>
                        {evalu.status.charAt(0).toUpperCase() + evalu.status.slice(1)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
