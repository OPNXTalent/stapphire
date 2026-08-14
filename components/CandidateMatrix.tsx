'use client';

import { useEffect, useState } from 'react';
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

const DISPOSITION_LABEL: Record<Disposition, string> = {
  screen: 'Screen',
  interview: 'Interview',
  hire: 'Hire',
  delete: 'Did Not Select'
};

function facetTier(score: number | null): 'strong' | 'moderate' | 'limited' {
  if (score === null) return 'limited';
  if (score >= 85) return 'strong';
  if (score >= 69) return 'moderate';
  return 'limited';
}

export function CandidateMatrix({ candidates, positionTitle }: { candidates: MatrixCandidate[]; positionTitle: string }) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dispositions, setDispositions] = useState<Record<string, Disposition | null>>(() =>
    Object.fromEntries(candidates.map((c) => [c.id, c.disposition]))
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // candidates is the single source of truth (server-fetched, already
  // excludes soft-deleted). Resync whenever it changes rather than
  // trusting local state, which can otherwise silently drift after a
  // refresh.
  useEffect(() => {
    setDispositions(Object.fromEntries(candidates.map((c) => [c.id, c.disposition])));
  }, [candidates]);

  const allSelected = candidates.length > 0 && selectedIds.size === candidates.length;

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(candidates.map((c) => c.id)));
  }

  // Sets disposition for exactly one candidate - the per-row dropdown.
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
      if (next === 'delete') router.refresh();
    } catch {
      setDispositions((prev) => ({ ...prev, [id]: previous }));
    } finally {
      setSavingId(null);
    }
  }

  // Sets the same disposition across every currently-selected candidate
  // at once - the bulk dropdown, driven by the checkboxes.
  async function applyDispositionToSelected(value: string) {
    if (!value || selectedIds.size === 0) return;
    const next = value as Disposition;
    const ids = Array.from(selectedIds);
    const previous = { ...dispositions };

    setDispositions((prev) => {
      const copy = { ...prev };
      ids.forEach((id) => (copy[id] = next));
      return copy;
    });
    setBulkBusy(true);
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/candidates/${id}/disposition`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ disposition: next })
          })
        )
      );
      if (results.some((r) => !r.ok)) throw new Error('One or more updates failed');
      setSelectedIds(new Set());
      if (next === 'delete') router.refresh();
    } catch {
      setDispositions(previous);
      alert('Unable to update one or more candidates. Try again.');
    } finally {
      setBulkBusy(false);
    }
  }

  const rows = expandedId
    ? [...candidates].sort((a, b) => (a.id === expandedId ? -1 : b.id === expandedId ? 1 : 0))
    : candidates;

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
        <label className="matrix-selectall">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          Select all
        </label>
        <select
          className="matrix-bulk-disposition"
          value=""
          onChange={(e) => applyDispositionToSelected(e.target.value)}
          disabled={bulkBusy || selectedIds.size === 0}
        >
          <option value="">
            {selectedIds.size === 0 ? 'Set disposition…' : `Set disposition for ${selectedIds.size} selected…`}
          </option>
          <option value="screen">{DISPOSITION_LABEL.screen}</option>
          <option value="interview">{DISPOSITION_LABEL.interview}</option>
          <option value="hire">{DISPOSITION_LABEL.hire}</option>
          <option value="delete">{DISPOSITION_LABEL.delete}</option>
        </select>
      </div>

      <div className="matrix-list">
        {rows.map((candidate) => {
          const isOpen = expandedId === candidate.id;
          const disposition = dispositions[candidate.id];
          return (
            <div className={`matrix-row ${isOpen ? 'expanded' : ''}`} key={candidate.id}>
              <div
                className={`matrix-row-head ${disposition || ''}`}
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
                  onChange={() => toggleOne(candidate.id)}
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
                  <option value="screen">{DISPOSITION_LABEL.screen}</option>
                  <option value="interview">{DISPOSITION_LABEL.interview}</option>
                  <option value="hire">{DISPOSITION_LABEL.hire}</option>
                  <option value="delete">{DISPOSITION_LABEL.delete}</option>
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
    </section>
  );
}
