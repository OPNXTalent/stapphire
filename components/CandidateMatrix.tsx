'use client';

import { useMemo, useState } from 'react';
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
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [dispositions, setDispositions] = useState<Record<string, Disposition | null>>(() =>
    Object.fromEntries(candidates.map((c) => [c.id, c.disposition]))
  );
  const [savingId, setSavingId] = useState<string | null>(null);

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
        // A real action, not just a label - the candidate leaves the
        // matrix immediately, and a background refresh keeps the
        // trash bin's count (fed by the server) in sync.
        setRemovedIds((prev) => new Set(prev).add(id));
        router.refresh();
      }
    } catch {
      setDispositions((prev) => ({ ...prev, [id]: previous }));
    } finally {
      setSavingId(null);
    }
  }

  const rows = useMemo(
    () =>
      candidates.filter(
        (candidate) =>
          !removedIds.has(candidate.id) && (dispositionFilter === 'all' || dispositions[candidate.id] === dispositionFilter)
      ),
    [candidates, dispositionFilter, dispositions, removedIds]
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
                  <option value="delete">Delete</option>
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
