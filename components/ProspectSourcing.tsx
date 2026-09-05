'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  PROSPECT_SEARCH_FOCUS_EVENT,
  PROSPECT_SEARCHES_CHANGED_EVENT,
  type ProspectSearchFocusDetail
} from '@/lib/prospectSearchEvents';
import { observedScarcityLevel, provisionalUnicornSummary, type ProspectScarcityLevel } from '@/lib/prospectMarketRead';
import styles from './ProspectSourcing.module.css';

type Criterion = { id: string; label: string; weight: number; isKnockout: boolean };
type Source = { title: string; url: string };
type Finding = { criterionId: string; alignmentScore: number; satisfactionStatus: string; evidence: string; assessment: string };
type Location = { label: string; confidence: string; evidence: string };
type Gate = { id: string; label: string };
type Evaluation = { summary: string; location: Location; compensation: { estimatedMarketRange: string; targetAlignment: string; confidence: string; rationale: string }; receptivity: { level: string; confidence: string; signals: string[]; rationale: string }; strongestEvidence: string[]; gaps: string[]; unknowns: string[]; criterionFindings: Finding[]; sources: Source[] };
type Prospect = {
  id: string;
  full_name: string;
  preliminary_score: number;
  sourcing_fit: string;
  screening_status: 'CLEARED' | 'NOT_CLEARED';
  screening_disposition: string | null;
  location: Location;
  evaluation_score: number | null;
  evaluation: Evaluation | null;
  sources: Source[];
  evaluated_at: string | null;
};
type Search = {
  id: string;
  evaluation_basis_id: string;
  boolean_query: string;
  search_strategy: { rationale?: string; config?: { targetLocation?: string; targetCompensation?: string; searchScope?: string; gates?: Gate[]; screeningVersion?: string }; marketAnalysis?: { scarcityLevel: string; confidence: string; summary: string; constraintDrivers: Array<{ constraint: string; explanation: string }>; relaxationLevers: Array<{ change: string; likelyEffect: string }> } };
  created_at: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  stage: string;
  progress: { totalTracks?: number; completedTracks?: number; discovered?: number; reviewed?: number; qualified?: number; rejected?: number; target?: number; coverageConfidence?: string };
  error_summary: string | null;
  prospects: Prospect[];
};
type Payload = { criteriaApplied: boolean; criteriaReadyToApply: boolean; currentEvaluationBasisId: string | null; criteria: Criterion[]; defaults: { targetLocation: string; targetCompensation: string; searchScope: string; gates: Gate[] }; search: Search | null; stale: boolean };

function List({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className={styles.muted}>{empty}</p>;
}

function primaryPublicProfile(sources: Source[]) {
  return sources.find((source) => /linkedin\.com\/in\//i.test(source.url))
    || sources.find((source) => /linkedin\.com|github\.com/i.test(source.url))
    || sources[0]
    || null;
}

function displayedEvidenceScore(prospect: Prospect) {
  return prospect.evaluation_score ?? prospect.preliminary_score;
}

function displayedEvidenceFit(prospect: Prospect) {
  const score = displayedEvidenceScore(prospect);
  if (prospect.evaluation_score !== null) return score >= 80 ? 'STRONG' : score >= 70 ? 'POTENTIAL' : 'WEAK';
  return prospect.sourcing_fit === 'QUALIFIED' ? 'STRONG' : 'POTENTIAL';
}

function screeningLabel(prospect: Prospect) {
  if (prospect.screening_status !== 'NOT_CLEARED') return 'CLEARED';
  const reason = prospect.screening_disposition || '';
  if (/below the 70%/i.test(reason)) return 'BELOW THRESHOLD';
  if (/independent public sources|depended on inference/i.test(reason)) return 'EVIDENCE LIMITED';
  if (/location/i.test(reason)) return 'LOCATION';
  if (/non-negotiable/i.test(reason)) return 'REQUIREMENT GAP';
  if (/incomplete|no resolved identity/i.test(reason)) return 'INCOMPLETE';
  return 'NOT CLEARED';
}

export function ProspectSourcing({ requisitionId }: { requisitionId: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [evaluatingIds, setEvaluatingIds] = useState<Set<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [targetLocation, setTargetLocation] = useState('');
  const [targetCompensation, setTargetCompensation] = useState('');
  const [searchScope, setSearchScope] = useState('50_MILES');
  const [nonNegotiables, setNonNegotiables] = useState<string[]>([]);
  const [nonNegotiableDraft, setNonNegotiableDraft] = useState('');
  const [nonNegotiableIntakeOpen, setNonNegotiableIntakeOpen] = useState(false);

  const applyLoadedPayload = useCallback((body: Payload) => {
    setPayload(body);
    const config = body.search?.search_strategy?.config || body.defaults;
    setTargetLocation(config?.targetLocation || '');
    setTargetCompensation(config?.targetCompensation || '');
    setSearchScope(config?.searchScope || '50_MILES');
    setNonNegotiables((config?.gates || []).filter((gate: Gate) => gate.id !== 'occupational-domain').map((gate: Gate) => gate.label));
    setNonNegotiableDraft('');
    setNonNegotiableIntakeOpen(false);
  }, []);

  function addNonNegotiable() {
    const label = nonNegotiableDraft.trim();
    if (!label) return;
    setNonNegotiables((current) => current.some((item) => item.toLowerCase() === label.toLowerCase()) ? current : [...current, label]);
    setNonNegotiableDraft('');
  }

  const loadSavedSearch = useCallback(async (searchId?: string) => {
    const suffix = searchId ? `?searchId=${encodeURIComponent(searchId)}` : '';
    const response = await fetch(`/api/requisitions/${requisitionId}/prospects${suffix}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Unable to load sourced prospects.');
    applyLoadedPayload(body);
  }, [applyLoadedPayload, requisitionId]);

  useEffect(() => {
    let active = true;
    loadSavedSearch()
      .catch((caught: Error) => { if (active) setError(caught.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadSavedSearch]);

  useEffect(() => {
    function focusSavedSearch(event: Event) {
      const detail = (event as CustomEvent<ProspectSearchFocusDetail>).detail;
      if (detail?.requisitionId !== requisitionId || !detail.searchId) return;
      setLoading(true);
      setError('');
      setOpenId(null);
      loadSavedSearch(detail.searchId)
        .catch((caught: Error) => setError(caught.message))
        .finally(() => setLoading(false));
    }
    window.addEventListener(PROSPECT_SEARCH_FOCUS_EVENT, focusSavedSearch);
    return () => window.removeEventListener(PROSPECT_SEARCH_FOCUS_EVENT, focusSavedSearch);
  }, [loadSavedSearch, requisitionId]);

  useEffect(() => {
    const search = payload?.search;
    if (!search || !['queued', 'processing'].includes(search.status)) return;
    let active = true;
    setSearching(true);
    const poll = async () => {
      try {
        const response = await fetch(`/api/requisitions/${requisitionId}/prospects?searchId=${encodeURIComponent(search.id)}`, { cache: 'no-store' });
        const body = await response.json() as Payload & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Unable to refresh the sourcing run.');
        if (!active) return;
        setPayload(body);
        if (body.search && !['queued', 'processing'].includes(body.search.status)) {
          setSearching(false);
          if (body.search.status === 'failed') setError(body.search.error_summary || 'The sourcing run could not be completed.');
          window.dispatchEvent(new CustomEvent(PROSPECT_SEARCHES_CHANGED_EVENT, { detail: { requisitionId, searchId: body.search.id } }));
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Unable to refresh the sourcing run.');
      }
    };
    const timer = window.setInterval(() => void poll(), 2500);
    void poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [payload?.search?.id, payload?.search?.status, requisitionId]);

  async function runSearch() {
    setSearching(true);
    setError('');
    setOpenId(null);
    let accepted = false;
    try {
      const gates = nonNegotiables.map((label, index) => ({ id: `gate-${index + 1}`, label }));
      const response = await fetch(`/api/requisitions/${requisitionId}/prospects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetLocation, targetCompensation, searchScope, gates }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to source prospects.');
      applyLoadedPayload(body);
      accepted = Boolean(body.search?.id && ['queued', 'processing'].includes(body.search.status));
      if (body.search?.id) window.dispatchEvent(new CustomEvent(PROSPECT_SEARCHES_CHANGED_EVENT, { detail: { requisitionId, searchId: body.search.id } }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to source prospects.');
    } finally {
      if (!accepted) setSearching(false);
    }
  }

  async function unlockEvaluation(prospect: Prospect) {
    if (prospect.evaluation) { setOpenId(openId === prospect.id ? null : prospect.id); return; }
    if (evaluatingIds.has(prospect.id)) return;
    setEvaluatingIds((current) => new Set(current).add(prospect.id));
    setError('');
    try {
      const response = await fetch(`/api/requisitions/${requisitionId}/prospects/${prospect.id}/evaluation`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to evaluate prospect.');
      setPayload((current) => current?.search ? {
        ...current,
        search: {
          ...current.search,
          prospects: current.search.prospects.map((item) => item.id === prospect.id ? {
            ...item,
            evaluation_score: body.evaluationScore,
            evaluation: body.evaluation,
            sources: body.sources,
            evaluated_at: body.evaluatedAt
          } : item)
        }
      } : current);
      setOpenId(prospect.id);
      window.dispatchEvent(new CustomEvent('stapphire:credits-changed', { detail: { creditsRemaining: body.creditsRemaining } }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to evaluate prospect.');
    } finally {
      setEvaluatingIds((current) => {
        const next = new Set(current);
        next.delete(prospect.id);
        return next;
      });
    }
  }

  if (loading) return <section className={styles.shell}><p className={styles.muted}>Loading sourcing workspace…</p></section>;
  const criteriaById = new Map((payload?.criteria || []).map((criterion) => [criterion.id, criterion]));
  const prospects = payload?.search?.prospects || [];
  const clearedProspects = prospects.filter((prospect) => prospect.screening_status !== 'NOT_CLEARED');
  const reviewedOutProspects = prospects.filter((prospect) => prospect.screening_status === 'NOT_CLEARED');
  const prospectGroups = [
    { label: 'Cleared prospects', prospects: clearedProspects },
    { label: 'Reviewed — not cleared', prospects: reviewedOutProspects }
  ].filter((group) => group.prospects.length > 0);
  const screeningDiagnostics = prospects
    .filter((prospect) => prospect.screening_status === 'NOT_CLEARED')
    .reduce((counts, prospect) => {
      const label = screeningLabel(prospect);
      counts.set(label, (counts.get(label) || 0) + 1);
      return counts;
    }, new Map<string, number>());
  const canSource = Boolean(payload?.criteriaApplied || payload?.criteriaReadyToApply);
  const legacyScreening = Boolean(payload?.search && payload.search.search_strategy?.config?.screeningVersion !== 'evidence_v2');
  const storedMarket = payload?.search?.search_strategy?.marketAnalysis;
  const displayedScarcity = payload?.search && storedMarket
    ? observedScarcityLevel(payload.search.progress, storedMarket.scarcityLevel as ProspectScarcityLevel, payload.search.status === 'completed')
    : null;
  const liveUnicorn = Boolean(payload?.search && storedMarket && payload.search.status !== 'completed' && displayedScarcity === 'UNICORN' && storedMarket.scarcityLevel !== 'UNICORN');
  const marketSummary = liveUnicorn && payload?.search
    ? provisionalUnicornSummary(payload.search.progress.reviewed || 0, Math.max(0, (payload.search.progress.discovered || 0) - (payload.search.progress.reviewed || 0)))
    : storedMarket?.summary;

  return (
    <section className={styles.shell} aria-labelledby="prospect-sourcing-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Public-web sourcing</p>
          <h2 id="prospect-sourcing-title">Find the evidence before the contact data</h2>
          <p className={styles.intro}>Stapphire turns the weighted criteria into a search strategy, resolves likely people, and withholds the complete evaluation until you choose to spend 2 QC.</p>
        </div>
        <button type="button" onClick={runSearch} disabled={searching || !canSource}>
          {searching ? 'Searching the public web…' : prospects.length ? 'Run a new search' : 'Find prospects'}
        </button>
      </header>

      {canSource && <div className={styles.controls}>
        <label>Target work location<input value={targetLocation} onChange={(event) => setTargetLocation(event.target.value)} placeholder="City, state, or country" /></label>
        <label>Search radius<select value={searchScope} onChange={(event) => setSearchScope(event.target.value)}><option value="25_MILES">25 miles</option><option value="50_MILES">50 miles</option><option value="100_MILES">100 miles</option><option value="500_MILES">500 miles</option><option value="NATIONAL">National</option><option value="GLOBAL">Global</option></select></label>
        <label>Target compensation <span>(optional)</span><input value={targetCompensation} onChange={(event) => setTargetCompensation(event.target.value)} placeholder="$140,000–$175,000" /></label>
        <section className={styles.gates} aria-labelledby="non-negotiables-label">
          <div className={styles.gateHeading}>
            <strong id="non-negotiables-label">Non-negotiables</strong>
            <button type="button" onClick={() => setNonNegotiableIntakeOpen((open) => !open)} aria-expanded={nonNegotiableIntakeOpen}>
              {nonNegotiableIntakeOpen ? 'Close' : 'Add non-negotiable'}
            </button>
          </div>
          {nonNegotiableIntakeOpen && <div className={styles.gateIntake}>
            <input
              value={nonNegotiableDraft}
              onChange={(event) => setNonNegotiableDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                event.preventDefault();
                addNonNegotiable();
              }}
              placeholder="Enter a must-have requirement"
              autoFocus
            />
            <button type="button" onClick={addNonNegotiable} disabled={!nonNegotiableDraft.trim()}>Add</button>
          </div>}
          {nonNegotiables.length > 0 && <ul className={styles.gateList}>{nonNegotiables.map((label, index) => <li key={`${label}-${index}`}><span>{label}</span><button type="button" onClick={() => setNonNegotiables((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${label}`}>×</button></li>)}</ul>}
        </section>
      </div>}

      {!canSource && <div className={styles.notice}>Complete Hiring Criteria with a total weight of 100% before sourcing.</div>}
      {payload?.stale && <div className={styles.notice}>The Hiring Criteria changed after this search. Run a new search before unlocking evaluations.</div>}
      {legacyScreening && <div className={styles.notice}>This shortlist predates the stricter evidence screen. Run a new search before relying on it.</div>}
      {error && <div className={styles.error} role="alert">{error}</div>}

      {payload?.search && payload.search.search_strategy?.config?.screeningVersion === 'evidence_v2' && <section className={styles.pipeline} aria-live="polite">
        <div><strong>{payload.search.status === 'completed' ? 'Search coverage' : payload.search.status === 'failed' ? 'Search interrupted' : payload.search.stage === 'queued' || payload.search.stage === 'planning' ? 'Building search paths' : payload.search.stage === 'discovering' ? 'Finding relevant professionals' : 'Reviewing public evidence'}</strong><span>{payload.search.status === 'completed' ? `${payload.search.progress?.coverageConfidence || 'LOW'} confidence based on the completed evidence funnel.` : payload.search.status === 'failed' ? 'The completed work remains available below.' : 'Reviewed prospects will appear below as each evidence decision completes.'}</span></div>
        <dl>
          <div><dt>Search paths</dt><dd>{payload.search.progress?.completedTracks || 0}/{payload.search.progress?.totalTracks || '—'}</dd></div>
          <div><dt>Found</dt><dd>{payload.search.progress?.discovered || 0}</dd></div>
          <div><dt>Reviewed</dt><dd>{payload.search.progress?.reviewed || 0}</dd></div>
          <div><dt>Cleared</dt><dd>{payload.search.progress?.qualified || 0}</dd></div>
        </dl>
      </section>}

      {payload?.search && (
        <details className={styles.strategy}>
          <summary>Search logic used</summary>
          <code>{payload.search.boolean_query}</code>
          {payload.search.search_strategy?.rationale && <p>{payload.search.search_strategy.rationale}</p>}
        </details>
      )}

      {storedMarket && displayedScarcity && <section className={styles.market}>
        <div><span>Talent Market Read</span><strong>{displayedScarcity}</strong><small>{liveUnicorn ? `PROVISIONAL · ${payload?.search?.progress.coverageConfidence || 'MODERATE'} confidence` : `${storedMarket.confidence} confidence`}</small></div>
        <p>{marketSummary}</p>
        <details><summary>Why—and what could widen the pool</summary><div className={styles.marketGrid}><section><h4>Constraint drivers</h4><ul>{storedMarket.constraintDrivers.map((item: { constraint: string; explanation: string }) => <li key={item.constraint}><strong>{item.constraint}</strong> — {item.explanation}</li>)}</ul></section><section><h4>Relaxation levers</h4><ul>{storedMarket.relaxationLevers.map((item: { change: string; likelyEffect: string }) => <li key={item.change}><strong>{item.change}</strong> — {item.likelyEffect}</li>)}</ul></section></div></details>
      </section>}

      {screeningDiagnostics.size > 0 && <details className={styles.diagnostics}>
        <summary>Screening diagnostics <span>{reviewedOutProspects.length} not cleared</span></summary>
        <div>{[...screeningDiagnostics.entries()].map(([label, count]) => <span key={label}><strong>{count}</strong>{label}</span>)}</div>
        <p>These prospects remain available below so the recruiter can inspect the strongest near matches and challenge the screen.</p>
      </details>}

      {prospects.length > 0 ? (
        <div className={styles.results}>
          <div className={styles.resultsHeader}><span>Prospect</span><span>Location</span><span>Screening</span><span>Fit</span><span aria-hidden="true" /></div>
          {prospectGroups.map((group) => <details className={styles.resultGroup} key={group.label} open>
            <summary>{group.label}<span>{group.prospects.length}</span></summary>
            {group.prospects.map((prospect) => {
              const open = openId === prospect.id && Boolean(prospect.evaluation);
              const publicProfile = primaryPublicProfile(prospect.sources);
              const purchased = Boolean(prospect.evaluation);
              return (
                <article className={styles.prospect} key={prospect.id}>
                  <div className={`${styles.prospectRow} ${purchased ? styles.purchased : styles.unviewed}`}>
                    <strong>{prospect.full_name}</strong><span className={styles.location}>{prospect.location?.label || 'Location unknown'}</span><span className={styles.fit} title={prospect.screening_disposition || undefined}>{screeningLabel(prospect)}</span>
                    <span className={styles.score}>{displayedEvidenceScore(prospect)}</span>
                    <button type="button" className={styles.unlock} disabled={evaluatingIds.has(prospect.id) || Boolean(payload?.stale && !prospect.evaluation)} onClick={() => unlockEvaluation(prospect)} aria-expanded={open}>
                      {evaluatingIds.has(prospect.id) ? 'Evaluating…' : prospect.evaluation ? (open ? 'Hide evaluation' : 'View evaluation') : 'View Evaluation - 2 QC'}
                    </button>
                  </div>
                {open && prospect.evaluation && (
                  <div className={styles.evaluation}>
                    <div className={styles.evaluationHero}>
                      <div>
                        <span>Public-evidence evaluation</span>
                        <h3>{prospect.full_name}</h3>
                        <div className={styles.candidateContact}>
                          <span>{prospect.evaluation.location?.label || prospect.location?.label || 'Location unknown'}</span>
                          {publicProfile && <a href={publicProfile.url} target="_blank" rel="noreferrer">Open public profile ↗</a>}
                        </div>
                      </div>
                      <strong>{prospect.evaluation_score}% <small>Evaluated fit</small></strong>
                    </div>
                    <p className={styles.summary}>{prospect.evaluation.summary}</p>
                    <div className={styles.intelligence}><section><h4>Estimated market compensation</h4><strong>{prospect.evaluation.compensation.estimatedMarketRange}</strong><p>{prospect.evaluation.compensation.targetAlignment} target alignment · {prospect.evaluation.compensation.confidence} confidence</p><small>{prospect.evaluation.compensation.rationale}</small></section><section><h4>Opportunity receptivity</h4><strong>{prospect.evaluation.receptivity.level}</strong><p>{prospect.evaluation.receptivity.confidence} confidence</p><small>{prospect.evaluation.receptivity.rationale}</small></section></div>
                    <div className={styles.threeColumns}>
                      <section><h4>Strongest evidence</h4><List items={prospect.evaluation.strongestEvidence} empty="No strong evidence identified." /></section>
                      <section><h4>Gaps</h4><List items={prospect.evaluation.gaps} empty="No explicit gaps identified." /></section>
                      <section><h4>Verify</h4><List items={prospect.evaluation.unknowns} empty="No material unknowns identified." /></section>
                    </div>
                    <h4>Weighted criteria</h4>
                    <div className={styles.findings}>
                      {prospect.evaluation.criterionFindings.map((finding) => {
                        const criterion = criteriaById.get(finding.criterionId);
                        return <section key={finding.criterionId}>
                          <div><strong>{criterion?.label || 'Applied criterion'}</strong><span>{criterion?.isKnockout ? finding.satisfactionStatus.replaceAll('_', ' ') : `${criterion?.weight ?? 0}% weight · ${finding.alignmentScore}% evidence alignment`}</span></div>
                          <p>{finding.evidence}</p><small>{finding.assessment}</small>
                        </section>;
                      })}
                    </div>
                    <h4>Public sources</h4>
                    <ul className={styles.sources}>{prospect.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>
                    <p className={styles.disclaimer}>Public-source evidence may be incomplete or outdated. Use this evaluation to decide whether further research or outreach is worth the effort—not as an employment decision.</p>
                  </div>
                )}
                </article>
              );
            })}
          </details>)}
        </div>
      ) : canSource && !searching ? <div className={styles.empty}><strong>{payload?.search ? 'No prospects cleared the evidence threshold.' : 'No prospect search yet.'}</strong><span>{payload?.search ? 'That is a valid result. The Talent Market Read above explains the constraint.' : 'Set the search scope, add any true non-negotiables, and find prospects.'}</span></div> : null}
    </section>
  );
}
