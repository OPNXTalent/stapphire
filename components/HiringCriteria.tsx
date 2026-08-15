'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { HiringCriteriaCategory, HiringCriteriaModel } from '@/lib/hiringCriteria';

const categories: { id: HiringCriteriaCategory; label: string }[] = [
  { id: 'responsibilities', label: 'Job Responsibilities' },
  { id: 'hard_skills', label: 'Hard Skills' },
  { id: 'soft_skills', label: 'Soft Skills' },
  { id: 'keywords', label: 'Keywords' }
];

export function HiringCriteria({ model, requisitionId }: { model: HiringCriteriaModel | null; requisitionId: string }) {
  const router = useRouter();
  const [weights, setWeights] = useState<Record<string, number>>(() => Object.fromEntries((model?.criteria || []).map((criterion) => [criterion.id, criterion.draftWeight])));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [action, setAction] = useState<'apply' | 'reset' | null>(null);
  const criteria = model?.criteria || [];
  const total = criteria.reduce((sum, criterion) => sum + (weights[criterion.id] ?? criterion.draftWeight), 0);
  const meterState = total < 100 ? 'under' : total > 100 ? 'over' : 'balanced';
  const meterCopy = total < 100 ? `${100 - total} points remain to allocate` : total > 100 ? `${total - 100} points must be removed` : 'Balanced';
  const ready = model?.extractionStatus === 'ready' && criteria.length > 0;
  const changedFromDefault = criteria.some((criterion) => (weights[criterion.id] ?? criterion.draftWeight) !== criterion.defaultWeight);

  useEffect(() => {
    setWeights(Object.fromEntries((model?.criteria || []).map((criterion) => [criterion.id, criterion.draftWeight])));
  }, [model]);

  async function adjustWeight(criterionId: string, delta: -1 | 1) {
    const previous = weights[criterionId] ?? 0;
    const next = Math.max(0, previous + delta);
    if (next === previous) return;
    setWeights((current) => ({ ...current, [criterionId]: next }));
    setSavingId(criterionId);
    try {
      const response = await fetch(`/api/requisitions/${requisitionId}/hiring-criteria`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criterionId, delta })
      });
      if (!response.ok) throw new Error('Unable to save draft weight');
    } catch {
      setWeights((current) => ({ ...current, [criterionId]: previous }));
    } finally {
      setSavingId(null);
    }
  }

  async function runAction(nextAction: 'apply' | 'reset') {
    setAction(nextAction);
    try {
      const response = await fetch(`/api/requisitions/${requisitionId}/hiring-criteria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: nextAction })
      });
      if (!response.ok) throw new Error(`Unable to ${nextAction} criteria`);
      if (nextAction === 'reset') setWeights(Object.fromEntries(criteria.map((criterion) => [criterion.id, criterion.defaultWeight])));
      router.refresh();
    } catch {
      alert(`Unable to ${nextAction} Hiring Criteria. Try again.`);
    } finally {
      setAction(null);
    }
  }

  return (
    <section className="hiring-criteria" aria-labelledby="hiring-criteria-heading">
      <div className="hiring-criteria-heading">
        <div><span className="eyebrow">Hiring calibration</span><h2 id="hiring-criteria-heading">Hiring Criteria</h2></div>
        {ready && <div className="criteria-actions"><button type="button" className="criteria-reset" onClick={() => runAction('reset')} disabled={!changedFromDefault || action !== null || savingId !== null}>Reset to Default</button><button type="button" className="criteria-apply" onClick={() => runAction('apply')} disabled={total !== 100 || action !== null || savingId !== null}>{action === 'apply' ? 'Applying…' : 'Apply Model'}</button></div>}
      </div>

      {!ready ? (
        <div className="criteria-unavailable"><strong>Hiring Criteria unavailable</strong><span>JD-specific criteria extraction is required before this requisition can be calibrated.</span></div>
      ) : (
        <>
          <div className={`criteria-meter ${meterState}`} role="status" aria-live="polite"><span>Total Weight</span><strong>{total}%</strong><span>{meterCopy}</span></div>
          <div className="criteria-categories">
            {categories.map((category) => {
              const children = criteria.filter((criterion) => criterion.category === category.id);
              const categoryTotal = children.reduce((sum, criterion) => sum + (weights[criterion.id] ?? criterion.draftWeight), 0);
              return (
                <details key={category.id}>
                  <summary><span>{category.label}</span><strong>{categoryTotal}%</strong></summary>
                  <div className="criteria-items">
                    {children.length ? children.map((criterion) => {
                      const weight = weights[criterion.id] ?? criterion.draftWeight;
                      return (
                        <div className="criterion-item" key={criterion.id}>
                          <div><strong>{criterion.label}</strong>{criterion.rationale && <span>{criterion.rationale}</span>}{criterion.jdEvidence && <small>JD evidence: {criterion.jdEvidence}</small>}</div>
                          <div className="criterion-weight" aria-label={`${criterion.label} draft weight ${weight} percent`}>
                            <button type="button" onClick={() => adjustWeight(criterion.id, -1)} disabled={weight === 0 || savingId === criterion.id} aria-label={`Decrease ${criterion.label} by 1 percentage point`}>−</button>
                            <output>{weight}</output>
                            <button type="button" onClick={() => adjustWeight(criterion.id, 1)} disabled={weight === 100 || savingId === criterion.id} aria-label={`Increase ${criterion.label} by 1 percentage point`}>+</button>
                          </div>
                        </div>
                      );
                    }) : <p className="muted">No criteria in this category.</p>}
                  </div>
                </details>
              );
            })}
          </div>
          <p className="criteria-active-note">Draft changes do not affect Candidate Match. Applied versions are preserved for future evaluator integration.</p>
        </>
      )}
    </section>
  );
}
