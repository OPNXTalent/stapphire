'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Verdict } from '@/lib/evaluation';
import { CandidateReport } from '@/components/CandidateReport';

export type Disposition = 'screen' | 'interview' | 'hire' | 'delete';

export type MatrixCandidate = {
  id: string;
  name: string;
  match: number | null;
  verdict: Verdict | null;
  responsibilities: number | null;
  hardSkills: number | null;
  softSkills: number | null;
  keywords: number | null;
  assessment: unknown;
  disposition: Disposition | null;
};

type DispositionFilter = 'all' | Disposition;

function facetTier(score: number | null): 'strong' | 'moderate' | 'limited' {
  if (score === null) return 'limited';
  if (score >= 85) return 'strong';
  if (score >= 69) return 'moderate';
  return 'limited';
}

export function CandidateMatrix({ candidates, positionTitle }: { candidates: MatrixCandidate[]; positionTitle: string }) {
  const router = useRouter();
  const [dispositionFilter, setDispositionFilter] = useState<DispositionFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dispositions, setDispositions] = useState<Record<string, Disposition | null>>(() =>
    Object.fromEntries(candidates.map((c) => [c.id, c.disposition]))
  );
  const [savingId, setSavingId] = useState<string | null>(null);

  // candidates is the single source of truth - it's server-fetched and
  // already excludes anyone soft-deleted. Re-sync whenever it changes
  // (e.g. after a delete or a restore triggers router.refresh()) rather
  // than tracking removal/disposition as separate local state that can
  // silently drift out of sync with what the server actually has. That
  // drift was exactly why restore appeared broken - a restored
  // candidate would come back in this prop, but a stale local "removed"
  // set kept hiding them anyway.
  useEffect(() => {
    setDispositions(Object.fromEntries(candidates.map((c) => [c.id, c.disposition])));
  }, [candidates]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function updateDisposition(id: string, value: string) {
    const next = (value || null) as Disposition | null;
    const previous = dispositions[id];
    setDispositions((prev) => ({ ...prev, [id]: next }));
    setSavingId(id);
    try {
      const res = await fetch(`/api/candidates/${id}/disposition`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disposition: next ?? '' })
      });
      if (!res.ok) throw new Error('Failed to save');
      if (next === 'delete') {
        // Refetch from the server, which now excludes this candidate -
        // no local "hide it" tracking needed, the prop update handles it.
        router.refresh();
      }
    } catch {
      setDispositions((prev) => ({ ...prev, [id]: previous }));
    } finally {
      setSavingId(null);
    }
  }

  const rows = useMemo(
    () => candidates.filter((candidate) => dispositionFilter === 'all' || dispositions[candidate.id] === dispositionFilter),
    [candidates, dispositionFilter, dispositions]
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
        <div className="matrix-filter" aria-label="Filter by disposition">
          {(
            [
              ['all', 'All'],
              ['screen', 'Screen'],
              ['interview', 'Interview'],
              ['hire', 'Hire']
            ] as const
          ).map(([value, label]) => (
            <button key={value} className={dispositionFilter === value ? 'active' : ''} onClick={() => setDispositionFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="matrix-list">
        {rows.map((candidate) => {
          const isOpen = expandedId === candidate.id;
          const disposition = dispositions[candidate.id];
          return (
            <div className={`matrix-row ${isOpen ? 'expanded' : ''}`} key={candidate.id}>
              <div
                className="matrix-row-head"
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => setExpandedId(isOpen ? null : candidate.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpandedId(isOpen ? null : candidate.id);
                  }
                }}
              >
                <input
                  type="checkbox"
                  className="matrix-row-checkbox"
                  checked={selectedIds.has(candidate.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelect(candidate.id)}
                  aria-label={`Select ${candidate.name}`}
                />
                <span className="matrix-row-name">{candidate.name}</span>
                <span className="facet-cell matrix-row-match">
                  <span className="score-num">{candidate.match === null ? '—' : `${candidate.match}%`}</span>
                  <span className={`facet-mini ${facetTier(candidate.match)}`} />
                </span>
                <select
                  className={`disposition-select ${disposition || ''}`}
                  value={disposition || ''}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateDisposition(candidate.id, e.target.value)}
                  disabled={savingId === candidate.id}
                >
                  <option value="">Disposition…</option>
                  <option value="screen">Screen</option>
                  <option value="interview">Interview</option>
                  <option value="hire">Hire</option>
                  <option value="delete">Did Not Select</option>
                </select>
              </div>

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
      {!rows.length && <p className="matrix-no-results">No candidates match this filter.</p>}
    </section>
  );
}
