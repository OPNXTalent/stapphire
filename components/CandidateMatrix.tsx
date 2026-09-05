'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CandidateReport } from '@/components/CandidateReport';
import { CandidateDetailActions } from '@/components/CandidateDetailActions';
import { CandidateInterviewRounds } from '@/components/CandidateInterviewRounds';
import type { CandidateContact } from '@/lib/candidateContact';

export type Disposition = 'screen' | 'interview' | 'hire' | 'delete';

export type MatrixCandidate = {
  id: string;
  name: string;
  sourceFilename: string;
  resumeAvailable: boolean;
  match: number | null;
  rankOrder: number | null;
  createdAt: string;
  evaluationDate: string;
  evaluationBasisId: string | null;
  responsibilities: number | null;
  hardSkills: number | null;
  softSkills: number | null;
  keywords: number | null;
  otherRequirements: number | null;
  assessment: unknown;
  disposition: Disposition | null;
  interviewScore: number | null;
  interviewSubmitted: number;
  contact: CandidateContact;
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

function categoryAssessment(score: number | null): string {
  if (score === null) return '—';
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Strong';
  if (score >= 55) return 'Moderate';
  return 'Limited';
}

export function CandidateMatrix({ candidates, positionTitle, requisitionId, headerAction }: { candidates: MatrixCandidate[]; positionTitle: string; requisitionId: string; headerAction?: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [orderedCandidates, setOrderedCandidates] = useState(candidates);
  const [expandedId, setExpandedId] = useState<string | null>(() => {
    const requestedId = searchParams.get('candidate');
    return requestedId && candidates.some((c) => c.id === requestedId) ? requestedId : null;
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dispositions, setDispositions] = useState<Record<string, Disposition | null>>(() =>
    Object.fromEntries(candidates.map((c) => [c.id, c.disposition]))
  );
  const [bulkBusy, setBulkBusy] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  useEffect(() => {
    setOrderedCandidates(candidates);
    setDispositions(Object.fromEntries(candidates.map((c) => [c.id, c.disposition])));
  }, [candidates]);

  const allSelected = orderedCandidates.length > 0 && selectedIds.size === orderedCandidates.length;

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(orderedCandidates.map((c) => c.id)));
  }

  async function moveCandidate(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const previous = orderedCandidates;
    const source = previous.find((candidate) => candidate.id === sourceId);
    const targetIndex = previous.findIndex((candidate) => candidate.id === targetId);
    if (!source || targetIndex < 0) return;
    const reordered = previous.filter((candidate) => candidate.id !== sourceId);
    reordered.splice(targetIndex, 0, source);
    const next = reordered.map((candidate, index) => ({ ...candidate, rankOrder: index + 1 }));
    setOrderedCandidates(next);
    try {
      const response = await fetch(`/api/requisitions/${requisitionId}/candidate-rank`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: next.map((candidate) => candidate.id) })
      });
      if (!response.ok) throw new Error('Unable to save ranking');
      router.refresh();
    } catch {
      setOrderedCandidates(previous);
      alert('Unable to save candidate ranking. Refresh and try again.');
    }
  }

  function moveCandidateByKeyboard(id: string, direction: -1 | 1) {
    const index = orderedCandidates.findIndex((candidate) => candidate.id === id);
    const target = orderedCandidates[index + direction];
    if (index >= 0 && target) void moveCandidate(id, target.id);
  }

  async function applyDispositionToSelected(value: string) {
    if (!value || selectedIds.size === 0) return;
    const next: Disposition | null = value === '__clear__' ? null : value as Disposition;
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
            body: JSON.stringify({ disposition: next ?? '' })
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

  function renderBanner(candidate: MatrixCandidate, isOpen: boolean, rank: number, extraClass = ''): ReactNode {
    const disposition = dispositions[candidate.id];
    const dispositionLabel = disposition ? DISPOSITION_LABEL[disposition] : 'No status';

    return (
      <div
        className={`matrix-row-head ${disposition || ''} ${extraClass} ${draggedId === candidate.id ? 'dragging' : ''} ${dropTargetId === candidate.id ? 'drop-target' : ''}`}
        style={{ gridTemplateColumns: '80px minmax(190px,1.7fr) 78px repeat(5,minmax(70px,1fr))' }}
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
        onDragOver={(e) => {
          if (!isOpen && draggedId && draggedId !== candidate.id) {
            e.preventDefault();
            setDropTargetId(candidate.id);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          const sourceId = draggedId || e.dataTransfer.getData('text/plain');
          setDropTargetId(null);
          setDraggedId(null);
          if (sourceId) void moveCandidate(sourceId, candidate.id);
        }}
      >
        <span className="matrix-rank-controls">
          <span className="matrix-rank">
            <button
              type="button"
              className="matrix-drag-handle"
              draggable={!isOpen}
              aria-label={`Rank ${candidate.name}, currently ${rank}. Use arrow keys to move.`}
              title="Drag or use arrow keys to rank"
              onClick={(e) => e.stopPropagation()}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', candidate.id);
                setDraggedId(candidate.id);
              }}
              onDragEnd={() => {
                setDraggedId(null);
                setDropTargetId(null);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (isOpen) return;
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  moveCandidateByKeyboard(candidate.id, e.key === 'ArrowUp' ? -1 : 1);
                }
              }}
            >⠿</button>
            <span className="matrix-rank-number">{rank}.</span>
          </span>
          <input
            type="checkbox"
            className="matrix-row-checkbox"
            checked={selectedIds.has(candidate.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleOne(candidate.id)}
            aria-label={`Select ${candidate.name}`}
          />
        </span>
        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '3px' }}>
          <span className="matrix-row-name" style={{ width: '100%' }}>{candidate.name}</span>
          <span
            aria-label={`Status: ${dispositionLabel}`}
            style={{
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--muted)',
              fontFamily: 'var(--mono)',
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '.04em',
              lineHeight: 1.1,
              textTransform: 'uppercase'
            }}
          >
            {dispositionLabel}
          </span>
        </span>
        <span className="facet-cell matrix-row-match">
          <span className="score-num">{candidate.match === null ? '—' : `${candidate.match}%`}</span>
          <span className={`facet-mini ${facetTier(candidate.match)}`} />
        </span>
        <span className="matrix-big4" aria-label="Big 5 category assessments">
          {([
            ['Duties', 'Job Responsibilities', candidate.responsibilities],
            ['Hard Skills', 'Hard Skills', candidate.hardSkills],
            ['Soft Skills', 'Soft Skills', candidate.softSkills],
            ['Keywords', 'Keywords', candidate.keywords],
            ['Other', 'Other Requirements', candidate.otherRequirements]
          ] as const).map(([label, fullLabel, score]) => (
            <span className="matrix-assessment" key={fullLabel} title={`${fullLabel}: ${score === null ? '—' : `${score}%`} (${categoryAssessment(score)})`}>
              <span className="matrix-assessment-label">{label}</span>
              <span className="matrix-assessment-value">{score === null ? '—' : `${score}%`}</span>
            </span>
          ))}
        </span>
      </div>
    );
  }

  const expandedCandidate = orderedCandidates.find((c) => c.id === expandedId) ?? null;
  const expandedRank = expandedCandidate ? orderedCandidates.findIndex((candidate) => candidate.id === expandedCandidate.id) + 1 : 0;

  const matrixToolbar = <div className="matrix-toolbar">
    <div className="matrix-heading-copy">
      <div className="matrix-header-row"><h2>Candidate Matrix</h2>{headerAction}</div>
      <p className="muted">Compare evaluated candidates — click a name to expand the full assessment.</p>
    </div>
    <div className="matrix-controls">
      <label className="matrix-selectall">
        <input type="checkbox" checked={allSelected} onChange={toggleAll} />
        Select all
      </label>
      <select className="matrix-bulk-disposition" value="" onChange={(e) => applyDispositionToSelected(e.target.value)} disabled={bulkBusy || selectedIds.size === 0}>
        <option value="">{selectedIds.size === 0 ? 'Set status…' : `Set status (${selectedIds.size})…`}</option>
        <option value="screen">{DISPOSITION_LABEL.screen}</option>
        <option value="interview">{DISPOSITION_LABEL.interview}</option>
        <option value="hire">{DISPOSITION_LABEL.hire}</option>
        <option value="__clear__">No status — clear</option>
        <option value="delete">{DISPOSITION_LABEL.delete}</option>
      </select>
    </div>
  </div>;

  if (!orderedCandidates.length) {
    return (
      <section className="candidate-matrix">
        {matrixToolbar}
        <div className="matrix-empty">
          <strong>No candidates evaluated yet.</strong>
          <p>Add a resume to begin building the candidate comparison.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="candidate-matrix">
      {matrixToolbar}

      {expandedCandidate ? (
        <div className="matrix-selected">
          <div className="matrix-selected-banner">
            <div className="matrix-row">
              {renderBanner(expandedCandidate, true, expandedRank, 'pinned')}
            </div>
            <CandidateDetailActions candidateId={expandedCandidate.id} requisitionId={requisitionId} sourceFilename={expandedCandidate.sourceFilename} resumeAvailable={expandedCandidate.resumeAvailable}/>
          </div>
          <div className="matrix-selected-detail">
            <div className="matrix-row expanded">
              <div className="matrix-row-body">
                {expandedCandidate.match !== null ? (
                  <CandidateInterviewRounds
                    candidateId={expandedCandidate.id}
                    candidateName={expandedCandidate.name}
                    positionTitle={positionTitle}
                    evaluationContent={
                      <CandidateReport
                        candidateName={expandedCandidate.name}
                        positionTitle={positionTitle}
                        overallMatch={expandedCandidate.match}
                        responsibilities={expandedCandidate.responsibilities}
                        hardSkills={expandedCandidate.hardSkills}
                        softSkills={expandedCandidate.softSkills}
                        keywords={expandedCandidate.keywords}
                        assessment={expandedCandidate.assessment}
                        evaluationDate={expandedCandidate.evaluationDate}
                      />
                    }
                    contact={expandedCandidate.contact}
                  />
                ) : (
                  <p className="muted">No evaluation available for this candidate yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="matrix-list">
          {orderedCandidates.map((candidate, index) => (
            <div className="matrix-row" key={candidate.id}>
              {renderBanner(candidate, false, index + 1)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
