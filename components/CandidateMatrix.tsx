'use client';

import { useMemo, useState } from 'react';
import { verdictLabel, type Verdict } from '@/lib/evaluation';
import { CandidateReport } from '@/components/CandidateReport';

export type MatrixCandidate = {
  id: string;
  name: string;
  match: number | null;
  verdict: Verdict | null;
  responsibilities: number | null;
  hardSkills: number | null;
  softSkills: number | null;
  keywords: number | null;
  transitEmployer: boolean | null;
  assessment: unknown;
};

type SortKey = 'match' | 'name' | 'responsibilities' | 'hardSkills' | 'softSkills' | 'keywords';
type VerdictFilter = 'all' | Verdict;
type TransitFilter = 'all' | 'yes' | 'no';

function facetTier(score: number | null): 'strong' | 'moderate' | 'limited' {
  if (score === null) return 'limited';
  if (score >= 85) return 'strong';
  if (score >= 69) return 'moderate';
  return 'limited';
}

export function CandidateMatrix({ candidates, positionTitle }: { candidates: MatrixCandidate[]; positionTitle: string }) {
  const [sortKey, setSortKey] = useState<SortKey>('match');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all');
  const [transitFilter, setTransitFilter] = useState<TransitFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDirection(key === 'name' ? 'asc' : 'desc');
    }
  }

  const rows = useMemo(
    () =>
      candidates
        .filter(
          (candidate) =>
            (verdictFilter === 'all' || candidate.verdict === verdictFilter) &&
            (transitFilter === 'all' || candidate.transitEmployer === (transitFilter === 'yes'))
        )
        .sort((a, b) => {
          if (sortKey === 'name') return sortDirection === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
          const av = a[sortKey],
            bv = b[sortKey];
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return sortDirection === 'asc' ? av - bv : bv - av;
        }),
    [candidates, sortKey, sortDirection, verdictFilter, transitFilter]
  );

  const sortLabel = (label: string, key: SortKey) => (
    <button className="matrix-sort" onClick={() => sortBy(key)} aria-label={`Sort by ${label}`}>
      {label}
      {sortKey === key ? <span aria-hidden="true"> {sortDirection === 'asc' ? '↑' : '↓'}</span> : null}
    </button>
  );

  if (!candidates.length) {
    return (
      <div className="matrix-empty">
        <strong>No candidates evaluated yet.</strong>
        <p>Add a resume to begin building the candidate comparison.</p>
      </div>
    );
  }

  return (
    <section className="candidate-matrix">
      <div className="matrix-controls">
        <div className="matrix-filter" aria-label="Filter by verdict">
          {(
            [
              ['all', 'All'],
              ['greenlight', 'Recommend'],
              ['consider', 'Hold / Clarify'],
              ['decline', 'Decline']
            ] as const
          ).map(([value, label]) => (
            <button key={value} className={verdictFilter === value ? 'active' : ''} onClick={() => setVerdictFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="matrix-sort-row">
          Sort: {sortLabel('Match', 'match')} {sortLabel('Name', 'name')} {sortLabel('Responsibilities', 'responsibilities')}{' '}
          {sortLabel('Hard Skills', 'hardSkills')} {sortLabel('Soft Skills', 'softSkills')} {sortLabel('Keywords', 'keywords')}
        </div>
        <label className="transit-filter">
          Transit Employer
          <select value={transitFilter} onChange={(event) => setTransitFilter(event.target.value as TransitFilter)}>
            <option value="all">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>

      <div className="matrix-list">
        {rows.map((candidate) => {
          const isOpen = expandedId === candidate.id;
          return (
            <div className={`matrix-row ${isOpen ? 'expanded' : ''}`} key={candidate.id}>
              <button
                type="button"
                className="matrix-row-head"
                onClick={() => setExpandedId(isOpen ? null : candidate.id)}
                aria-expanded={isOpen}
              >
                <span className="matrix-row-name">{candidate.name}</span>
                <span className="facet-cell matrix-row-match">
                  <span className="score-num">{candidate.match === null ? '—' : `${candidate.match}%`}</span>
                  <span className={`facet-mini ${facetTier(candidate.match)}`} />
                </span>
                <span className={`rec-pill ${candidate.verdict || ''}`}>
                  {candidate.verdict ? verdictLabel[candidate.verdict].split(' —')[0] : '—'}
                </span>
              </button>

              {isOpen && (
                <div className="matrix-row-body">
                  {candidate.match !== null && candidate.verdict !== null ? (
                    <CandidateReport
                      candidateName={candidate.name}
                      positionTitle={positionTitle}
                      overallMatch={candidate.match}
                      verdict={candidate.verdict}
                      responsibilities={candidate.responsibilities ?? 0}
                      hardSkills={candidate.hardSkills ?? 0}
                      softSkills={candidate.softSkills ?? 0}
                      keywords={candidate.keywords ?? 0}
                      assessment={candidate.assessment}
                    />
                  ) : (
                    <p className="muted">No evaluation available for this candidate yet.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!rows.length && <p className="matrix-no-results">No candidates match these filters.</p>}
    </section>
  );
}
