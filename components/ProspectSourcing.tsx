'use client';

import { useEffect, useState } from 'react';
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
  search_strategy: { rationale?: string; config?: { targetLocation?: string; targetCompensation?: string; searchScope?: string; gates?: Gate[] }; marketAnalysis?: { scarcityLevel: string; confidence: string; summary: string; constraintDrivers: Array<{ constraint: string; explanation: string }>; relaxationLevers: Array<{ change: string; likelyEffect: string }> } };
  created_at: string;
  prospects: Prospect[];
};
type Payload = { criteriaApplied: boolean; currentEvaluationBasisId: string | null; criteria: Criterion[]; defaults: { targetLocation: string; targetCompensation: string; searchScope: string; gates: Gate[] }; search: Search | null; stale: boolean };

function List({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className={styles.muted}>{empty}</p>;
}

export function ProspectSourcing({ requisitionId }: { requisitionId: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [targetLocation, setTargetLocation] = useState('');
  const [targetCompensation, setTargetCompensation] = useState('');
  const [searchScope, setSearchScope] = useState('50_MILES');
  const [gateText, setGateText] = useState('');

  useEffect(() => {
    let active = true;
    fetch(`/api/requisitions/${requisitionId}/prospects`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Unable to load sourced prospects.');
        if (active) {
          setPayload(body);
          const config = body.search?.search_strategy?.config || body.defaults;
          setTargetLocation(config?.targetLocation || '');
          setTargetCompensation(config?.targetCompensation || '');
          setSearchScope(config?.searchScope || '50_MILES');
          setGateText((config?.gates || []).map((gate: Gate) => gate.label).join('\n'));
        }
      })
      .catch((caught: Error) => { if (active) setError(caught.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [requisitionId]);

  async function runSearch() {
    setSearching(true);
    setError('');
    setOpenId(null);
    try {
      const gates = gateText.split('\n').map((label, index) => ({ id: `gate-${index + 1}`, label: label.trim() })).filter((gate) => gate.label);
      const response = await fetch(`/api/requisitions/${requisitionId}/prospects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetLocation, targetCompensation, searchScope, gates }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to source prospects.');
      setPayload(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to source prospects.');
    } finally {
      setSearching(false);
    }
  }

  async function unlockEvaluation(prospect: Prospect) {
    if (prospect.evaluation) { setOpenId(openId === prospect.id ? null : prospect.id); return; }
    setEvaluatingId(prospect.id);
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
      setEvaluatingId(null);
    }
  }

  if (loading) return <section className={styles.shell}><p className={styles.muted}>Loading sourcing workspace…</p></section>;
  const criteriaById = new Map((payload?.criteria || []).map((criterion) => [criterion.id, criterion]));
  const prospects = payload?.search?.prospects || [];

  return (
    <section className={styles.shell} aria-labelledby="prospect-sourcing-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Public-web sourcing prototype</p>
          <h2 id="prospect-sourcing-title">Find the evidence before the contact data</h2>
          <p className={styles.intro}>Stapphire turns the applied weights into a search strategy, resolves likely people, and withholds the complete evaluation until you choose to spend 1 QC.</p>
        </div>
        <button type="button" onClick={runSearch} disabled={searching || !payload?.criteriaApplied}>
          {searching ? 'Searching the public web…' : prospects.length ? 'Run a new search' : 'Find prospects'}
        </button>
      </header>

      {payload?.criteriaApplied && <div className={styles.controls}>
        <label>Target work location<input value={targetLocation} onChange={(event) => setTargetLocation(event.target.value)} placeholder="City, state, or country" /></label>
        <label>Search radius<select value={searchScope} onChange={(event) => setSearchScope(event.target.value)}><option value="25_MILES">25 miles</option><option value="50_MILES">50 miles</option><option value="100_MILES">100 miles</option><option value="500_MILES">500 miles</option><option value="NATIONAL">National</option><option value="GLOBAL">Global</option></select></label>
        <label>Target compensation <span>(optional)</span><input value={targetCompensation} onChange={(event) => setTargetCompensation(event.target.value)} placeholder="$140,000–$175,000" /></label>
        <label className={styles.gates}>Non-negotiable sourcing gates <span>one per line</span><textarea value={gateText} onChange={(event) => setGateText(event.target.value)} rows={3} /></label>
      </div>}

      {!payload?.criteriaApplied && <div className={styles.notice}>Apply Hiring Criteria with a total weight of 100% before sourcing.</div>}
      {payload?.stale && <div className={styles.notice}>The Hiring Criteria changed after this search. Run a new search before unlocking evaluations.</div>}
      {error && <div className={styles.error} role="alert">{error}</div>}

      {payload?.search && (
        <details className={styles.strategy}>
          <summary>Search logic used</summary>
          <code>{payload.search.boolean_query}</code>
          {payload.search.search_strategy?.rationale && <p>{payload.search.search_strategy.rationale}</p>}
        </details>
      )}

      {payload?.search?.search_strategy?.marketAnalysis && <section className={styles.market}>
        <div><span>Talent Market Read</span><strong>{payload.search.search_strategy.marketAnalysis.scarcityLevel}</strong><small>{payload.search.search_strategy.marketAnalysis.confidence} confidence</small></div>
        <p>{payload.search.search_strategy.marketAnalysis.summary}</p>
        <details><summary>Why—and what could widen the pool</summary><div className={styles.marketGrid}><section><h4>Constraint drivers</h4><ul>{payload.search.search_strategy.marketAnalysis.constraintDrivers.map((item: { constraint: string; explanation: string }) => <li key={item.constraint}><strong>{item.constraint}</strong> — {item.explanation}</li>)}</ul></section><section><h4>Relaxation levers</h4><ul>{payload.search.search_strategy.marketAnalysis.relaxationLevers.map((item: { change: string; likelyEffect: string }) => <li key={item.change}><strong>{item.change}</strong> — {item.likelyEffect}</li>)}</ul></section></div></details>
      </section>}

      {prospects.length > 0 ? (
        <div className={styles.results}>
          <div className={styles.resultsHeader}><span>Prospect</span><span>Location</span><span>Sourcing fit</span><span>Score</span><span aria-hidden="true" /></div>
          {prospects.map((prospect) => {
            const open = openId === prospect.id && Boolean(prospect.evaluation);
            return (
              <article className={styles.prospect} key={prospect.id}>
                <div className={styles.prospectRow}>
                  <strong>{prospect.full_name}</strong><span className={styles.location}>{prospect.location?.label || 'Location unknown'}</span><span className={styles.fit}>{prospect.sourcing_fit}</span>
                  <span className={styles.score}>{prospect.preliminary_score}</span>
                  <button type="button" className={styles.unlock} disabled={Boolean(evaluatingId) || payload?.stale} onClick={() => unlockEvaluation(prospect)} aria-expanded={open}>
                    {evaluatingId === prospect.id ? 'Evaluating…' : prospect.evaluation ? (open ? 'Hide evaluation' : 'View evaluation') : 'View evaluation · 1 QC'}
                  </button>
                </div>
                {open && prospect.evaluation && (
                  <div className={styles.evaluation}>
                    <div className={styles.evaluationHero}>
                      <div><span>Public-evidence evaluation</span><h3>{prospect.full_name}</h3></div>
                      <strong>{prospect.evaluation_score}% <small>Sourcing fit</small></strong>
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
        </div>
      ) : payload?.criteriaApplied && !searching ? <div className={styles.empty}><strong>{payload?.search ? 'No prospects cleared the evidence gates.' : 'No prospect search yet.'}</strong><span>{payload?.search ? 'The Talent Market Read above still explains the constraint.' : 'Confirm the sourcing gates and search scope, then find prospects.'}</span></div> : null}
    </section>
  );
}
