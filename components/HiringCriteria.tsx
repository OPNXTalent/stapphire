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
  const [knockouts, setKnockouts] = useState<Record<string, boolean>>(() => Object.fromEntries((model?.criteria || []).map((criterion) => [criterion.id, criterion.isKnockout])));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [action, setAction] = useState<'apply' | 'reset' | 'generate' | null>(null);
  const criteria = model?.criteria || [];
  const total = criteria.reduce((sum, criterion) => sum + ((knockouts[criterion.id] ?? criterion.isKnockout) ? 0 : (weights[criterion.id] ?? criterion.draftWeight)), 0);
  const meterState = total < 100 ? 'under' : total > 100 ? 'over' : 'balanced';
  const meterCopy = total < 100 ? `${100 - total} points remain to allocate` : total > 100 ? `${total - 100} points must be removed` : 'Balanced';
  const ready = model?.extractionStatus === 'ready' && criteria.length > 0;
  const changedFromDefault = criteria.some((criterion) => (weights[criterion.id] ?? criterion.draftWeight) !== criterion.defaultWeight || (knockouts[criterion.id] ?? criterion.isKnockout));

  useEffect(() => {
    setWeights(Object.fromEntries((model?.criteria || []).map((criterion) => [criterion.id, criterion.draftWeight])));
    setKnockouts(Object.fromEntries((model?.criteria || []).map((criterion) => [criterion.id, criterion.isKnockout])));
  }, [model]);

  async function adjustWeight(criterionId: string, delta: -1 | 1) {
    const criterion = criteria.find((item) => item.id === criterionId);
    if ((knockouts[criterionId] ?? criterion?.isKnockout ?? false) || savingId === criterionId) return;
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
      const result = await response.json() as { weight?: unknown };
      if (typeof result.weight !== 'number') throw new Error('Invalid saved draft weight');
      setWeights((current) => ({ ...current, [criterionId]: result.weight as number }));
    } catch {
      setWeights((current) => ({ ...current, [criterionId]: previous }));
    } finally {
      setSavingId(null);
    }
  }

  async function setKnockout(criterionId: string, isKnockout: boolean) {
    if (savingId === criterionId) return;
    const previousKnockout = knockouts[criterionId] ?? false;
    const previousWeight = weights[criterionId] ?? 0;
    setKnockouts((current) => ({ ...current, [criterionId]: isKnockout }));
    setWeights((current) => ({ ...current, [criterionId]: 0 }));
    setSavingId(criterionId);
    try {
      const response = await fetch(`/api/requisitions/${requisitionId}/hiring-criteria`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criterionId, isKnockout })
      });
      if (!response.ok) throw new Error('Unable to save knockout state');
      const result = await response.json() as { draftWeight?: unknown; isKnockout?: unknown };
      if (typeof result.draftWeight !== 'number' || typeof result.isKnockout !== 'boolean') throw new Error('Invalid saved knockout state');
      setWeights((current) => ({ ...current, [criterionId]: result.draftWeight as number }));
      setKnockouts((current) => ({ ...current, [criterionId]: result.isKnockout as boolean }));
    } catch {
      setKnockouts((current) => ({ ...current, [criterionId]: previousKnockout }));
      setWeights((current) => ({ ...current, [criterionId]: previousWeight }));
    } finally {
      setSavingId(null);
    }
  }

  async function runAction(nextAction: 'apply' | 'reset' | 'generate') {
    setAction(nextAction);
    try {
      const response = await fetch(`/api/requisitions/${requisitionId}/hiring-criteria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: nextAction })
      });
      if (!response.ok) throw new Error(`Unable to ${nextAction} criteria`);
      if (nextAction === 'reset') {
        setWeights(Object.fromEntries(criteria.map((criterion) => [criterion.id, criterion.defaultWeight])));
        setKnockouts(Object.fromEntries(criteria.map((criterion) => [criterion.id, false])));
      }
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
        <div className="criteria-unavailable">
          <div><strong>{action === 'generate' || model?.extractionStatus === 'pending' ? 'Analyzing requisition…' : model?.extractionStatus === 'failed' ? 'Hiring Criteria analysis could not be completed.' : 'Hiring Criteria not generated'}</strong><span>{action === 'generate' || model?.extractionStatus === 'pending' ? 'Extracting JD-specific hiring measures.' : 'Generate a reviewable starting model from this requisition’s Job Description.'}</span></div>
          {model?.extractionStatus !== 'pending' && action !== 'generate' && <button type="button" className="criteria-generate" onClick={() => runAction('generate')}>{model?.extractionStatus === 'failed' ? 'Retry' : 'Generate Hiring Criteria'}</button>}
        </div>
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
          {criteria.some((criterion) => criterion.category === 'other_requirements') && <div className="criteria-categories criteria-other"><details><summary><span>Other Requirements</span><strong>{criteria.filter((criterion) => criterion.category === 'other_requirements').length}</strong></summary><div className="criteria-items">{criteria.filter((criterion) => criterion.category === 'other_requirements').map((criterion) => {const weight=weights[criterion.id]??criterion.draftWeight;const knockout=knockouts[criterion.id]??criterion.isKnockout;return <div className={`criterion-item other-requirement${knockout?' knockout':''}`} key={criterion.id}><div><strong>{criterion.label}</strong>{criterion.rationale&&<span>{criterion.rationale}</span>}{criterion.jdEvidence&&<small>JD evidence: {criterion.jdEvidence}</small>}</div><div className="other-requirement-controls"><div className="criterion-weight" aria-label={`${criterion.label} draft weight ${weight} percent`}><button type="button" onClick={()=>adjustWeight(criterion.id,-1)} disabled={knockout||weight===0||savingId===criterion.id} aria-label={`Decrease ${criterion.label} by 1 percentage point`}>−</button><output>{weight}%</output><button type="button" onClick={()=>adjustWeight(criterion.id,1)} disabled={knockout||weight===100||savingId===criterion.id} aria-label={`Increase ${criterion.label} by 1 percentage point`}>+</button></div><button type="button" className={`knockout-toggle${knockout?' active':''}`} aria-pressed={knockout} disabled={savingId===criterion.id} onClick={()=>setKnockout(criterion.id,!knockout)}>Knockout</button></div></div>})}</div></details></div>}
          <p className="criteria-active-note">{model.latestAppliedVersionId ? 'Draft changes do not affect the latest applied version or Candidate Match.' : 'No applied version yet. Review or calibrate this draft, then apply it at exactly 100%.'}</p>
        </>
      )}
    </section>
  );
}
