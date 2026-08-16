'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { HiringCriteriaCategory, HiringCriteriaModel, HiringCriterion } from '@/lib/hiringCriteria';
import type { OperationSummary } from '@/lib/operationTypes';
import { isActiveOperation, isTerminalOperation } from '@/lib/operationTypes';
import { StapphireProcessing } from '@/components/StapphireProcessing';

const categories: { id: HiringCriteriaCategory; label: string }[] = [
  { id: 'responsibilities', label: 'Job Responsibilities' },
  { id: 'hard_skills', label: 'Hard Skills' },
  { id: 'soft_skills', label: 'Soft Skills' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'other_requirements', label: 'Other Requirements' }
];

export function HiringCriteria({ model, requisitionId, sourceIsStale = false }: { model: HiringCriteriaModel | null; requisitionId: string; sourceIsStale?: boolean }) {
  const router = useRouter();
  const actionInFlight = useRef(false);
  const terminalOperationSeen = useRef<string | null>(null);
  const activeOperationSeen = useRef(false);
  const [weights, setWeights] = useState<Record<string, number>>(() => Object.fromEntries((model?.criteria || []).map((criterion) => [criterion.id, criterion.draftWeight])));
  const [knockouts, setKnockouts] = useState<Record<string, boolean>>(() => Object.fromEntries((model?.criteria || []).map((criterion) => [criterion.id, criterion.isKnockout])));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [action, setAction] = useState<'apply' | 'reset' | 'generate' | null>(null);
  const [activeCategory, setActiveCategory] = useState<HiringCriteriaCategory | null>(null);
  const [operation, setOperation] = useState<OperationSummary | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function loadOperation() {
      try {
        const response = await fetch(`/api/requisitions/${requisitionId}/operations`, { cache: 'no-store' });
        if (!response.ok) return;
        const result = await response.json() as { operation?: OperationSummary | null };
        if (cancelled) return;
        const nextOperation = result.operation || null;
        setOperation(nextOperation);
        if (nextOperation && isActiveOperation(nextOperation.status)) activeOperationSeen.current = true;
        if (nextOperation && activeOperationSeen.current && isTerminalOperation(nextOperation.status) && terminalOperationSeen.current !== nextOperation.id) {
          terminalOperationSeen.current = nextOperation.id;
          router.refresh();
        }
        if (nextOperation && isActiveOperation(nextOperation.status) && !document.hidden) timer = setTimeout(loadOperation, 2500);
      } catch {
        // Persisted Hiring Criteria model state remains the legacy fallback.
        if (!cancelled && !document.hidden) timer = setTimeout(loadOperation, 5000);
      }
    }

    function resumePolling() {
      if (document.hidden) return;
      if (timer) clearTimeout(timer);
      void loadOperation();
    }

    void loadOperation();
    window.addEventListener('focus', resumePolling);
    document.addEventListener('visibilitychange', resumePolling);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', resumePolling);
      document.removeEventListener('visibilitychange', resumePolling);
    };
  }, [requisitionId, router]);

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
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setAction(nextAction);
    try {
      const response = await fetch(`/api/requisitions/${requisitionId}/hiring-criteria`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: nextAction })
      });
      if (!response.ok) throw new Error(`Unable to ${nextAction} criteria`);
      if (nextAction === 'generate') {
        const result = await response.json() as { operation?: { id?: unknown; status?: unknown } };
        if (!result.operation || typeof result.operation.id !== 'string'
          || (result.operation.status !== 'queued' && result.operation.status !== 'processing' && result.operation.status !== 'completed')) {
          throw new Error('Unable to start Hiring Criteria generation');
        }
        const now = new Date().toISOString();
        setOperation({
          id: result.operation.id,
          operationType: 'hiring_criteria_generation',
          status: result.operation.status,
          stage: result.operation.status,
          progressCurrent: result.operation.status === 'completed' ? 1 : 0,
          progressTotal: 1,
          resultSummary: {},
          errorSummary: null,
          createdAt: now,
          startedAt: null,
          completedAt: result.operation.status === 'completed' ? now : null,
          failedAt: null
        });
        if (result.operation.status === 'queued' || result.operation.status === 'processing') activeOperationSeen.current = true;
      }
      if (nextAction === 'reset') {
        setWeights(Object.fromEntries(criteria.map((criterion) => [criterion.id, criterion.defaultWeight])));
        setKnockouts(Object.fromEntries(criteria.map((criterion) => [criterion.id, false])));
      }
      router.refresh();
    } catch {
      alert(`Unable to ${nextAction} Hiring Criteria. Try again.`);
    } finally {
      actionInFlight.current = false;
      setAction(null);
    }
  }

  function renderCriterion(criterion: HiringCriterion) {
    const weight = weights[criterion.id] ?? criterion.draftWeight;
    const knockout = knockouts[criterion.id] ?? criterion.isKnockout;
    const saving = savingId === criterion.id;
    return (
      <div className={`criterion-item${knockout ? ' knockout' : ''}`} key={criterion.id}>
        <div><strong>{criterion.label}</strong>{criterion.rationale && <span>{criterion.rationale}</span>}{criterion.jdEvidence && <small>JD evidence: {criterion.jdEvidence}</small>}</div>
        <div className="criterion-treatment-controls">
          <div className="criterion-treatment" aria-label={`${criterion.label} treatment`}>
            <button type="button" className={!knockout ? 'active' : ''} aria-pressed={!knockout} disabled={saving} onClick={() => knockout && setKnockout(criterion.id, false)}>Weighted</button>
            <button type="button" className={knockout ? 'active' : ''} aria-pressed={knockout} disabled={saving} onClick={() => !knockout && setKnockout(criterion.id, true)}>Knockout</button>
          </div>
          <div className="criterion-weight" aria-label={`${criterion.label} draft weight ${weight} percent`}>
            <button type="button" onClick={() => adjustWeight(criterion.id, -1)} disabled={knockout || weight === 0 || saving} aria-label={`Decrease ${criterion.label} by 1 percentage point`}>−</button>
            <output>{weight}%</output>
            <button type="button" onClick={() => adjustWeight(criterion.id, 1)} disabled={knockout || weight === 100 || saving} aria-label={`Increase ${criterion.label} by 1 percentage point`}>+</button>
          </div>
        </div>
      </div>
    );
  }

  function categoryTotal(category: HiringCriteriaCategory): number {
    return criteria
      .filter((criterion) => criterion.category === category)
      .reduce((sum, criterion) => sum + ((knockouts[criterion.id] ?? criterion.isKnockout) ? 0 : (weights[criterion.id] ?? criterion.draftWeight)), 0);
  }

  function renderCategorySelection(category: { id: HiringCriteriaCategory; label: string }, active: boolean) {
    return (
      <button
        type="button"
        className={`matrix-row-head criteria-category-select${active ? ' pinned' : ''}`}
        key={category.id}
        aria-expanded={active}
        onClick={() => setActiveCategory(active ? null : category.id)}
      >
        <span>{category.label}</span>
        <strong>{categoryTotal(category.id)}%</strong>
      </button>
    );
  }

  const operationActive = operation ? isActiveOperation(operation.status) : false;

  return (
    <section className="hiring-criteria" aria-labelledby="hiring-criteria-heading">
      <div className="hiring-criteria-heading">
        <div><span className="eyebrow">Hiring calibration</span><h2 id="hiring-criteria-heading">Hiring Criteria</h2></div>
        {ready && <div className="criteria-actions"><button type="button" className="criteria-reset" onClick={() => runAction('reset')} disabled={!changedFromDefault || action !== null || savingId !== null}>Reset</button><button type="button" className="criteria-apply" onClick={() => runAction('apply')} disabled={total !== 100 || action !== null || savingId !== null}>{action === 'apply' ? 'Updating…' : 'Update'}</button></div>}
      </div>

      {sourceIsStale&&<div className="source-stale-notice">Job Description has changed since these Hiring Criteria were generated.</div>}

      {action === 'apply' ? (
        <StapphireProcessing title="Updating Hiring Criteria…" detail="Saving the calibrated model"/>
      ) : !ready && (action === 'generate' || operationActive || model?.extractionStatus === 'pending') ? (
        <StapphireProcessing title="Generating Hiring Criteria…"/>
      ) : !ready ? (
        <div className="criteria-unavailable">
          <div><strong>{model?.extractionStatus === 'failed' ? 'Hiring Criteria analysis could not be completed.' : 'Hiring Criteria not generated'}</strong><span>Generate a reviewable starting model from this requisition’s Job Description.</span></div>
          <button type="button" className="criteria-generate" onClick={() => runAction('generate')}>{model?.extractionStatus === 'failed' ? 'Retry' : 'Generate Hiring Criteria'}</button>
        </div>
      ) : (
        <>
          <p className="criteria-treatment-help">Choose whether each criterion contributes to Match or must be satisfied.</p>
          <div className={`criteria-meter ${meterState}`} role="status" aria-live="polite"><span>Total Weight</span><strong>{total}%</strong><span>{meterCopy}</span></div>
          {activeCategory ? (
            <div className="criteria-category-focused">
              {renderCategorySelection(categories.find((category) => category.id === activeCategory)!, true)}
              <div className="criteria-category-detail">
                {criteria.filter((criterion) => criterion.category === activeCategory).length
                  ? criteria.filter((criterion) => criterion.category === activeCategory).map(renderCriterion)
                  : <p className="muted">No criteria in this category.</p>}
              </div>
            </div>
          ) : (
            <div className="criteria-category-list">{categories.map((category) => renderCategorySelection(category, false))}</div>
          )}
          <p className="criteria-active-note">{model.latestAppliedVersionId ? 'Draft changes do not affect the latest applied version or Candidate Match.' : 'No applied version yet. Review or calibrate this draft, then apply it at exactly 100%.'}</p>
        </>
      )}
    </section>
  );
}
