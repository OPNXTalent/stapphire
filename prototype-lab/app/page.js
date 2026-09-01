'use client';

import { useState } from 'react';

const DEFAULT_CRITERIA = `Capital-program delivery leadership | 30
Transportation construction experience | 25
Planning, design, and construction coordination | 20
Public-sector stakeholder management | 15
Budget, schedule, risk, and consultant control | 10`;

const DEFAULT_GATES = `Transportation or public-infrastructure construction
Capital program or capital project delivery
Senior project, program, or construction leadership
Planning, design, and construction coordination`;

function parseCriteria(text) {
  return text.split('\n').map((line, index) => { const [label, weight] = line.split('|'); return { id: `criterion-${index + 1}`, label: label?.trim(), weight: Number(weight?.trim()) }; }).filter((item) => item.label && Number.isFinite(item.weight));
}

function parseGates(text) {
  return text.split('\n').map((label, index) => ({ id: `gate-${index + 1}`, label: label.trim() })).filter((item) => item.label);
}

function label(value) {
  return String(value || '').replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

export default function Page() {
  const [title, setTitle] = useState('Senior Capital Improvement Manager');
  const [targetLocation, setTargetLocation] = useState('Richmond, VA');
  const [searchScope, setSearchScope] = useState('50_MILES');
  const [targetCompensation, setTargetCompensation] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [gatesText, setGatesText] = useState(DEFAULT_GATES);
  const [criteriaText, setCriteriaText] = useState(DEFAULT_CRITERIA);
  const [result, setResult] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [evaluations, setEvaluations] = useState({});
  const [qc, setQc] = useState(5);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const criteria = parseCriteria(criteriaText);
  const gates = parseGates(gatesText);
  const total = criteria.reduce((sum, item) => sum + item.weight, 0);

  async function search() {
    setBusy('search'); setError(''); setOpenId(null); setEvaluations({});
    try { const response = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, targetLocation, searchScope, jobDescription, gates, criteria }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setResult(body); }
    catch (caught) { setError(caught.message || 'Search failed.'); }
    finally { setBusy(''); }
  }

  async function evaluate(prospect, index) {
    const id = `${prospect.fullName}-${index}`;
    if (evaluations[id]) { setOpenId(openId === id ? null : id); return; }
    if (qc < 1) { setError('No test QC remains. Refresh the page to reset the lab.'); return; }
    setBusy(id); setError('');
    try { const response = await fetch('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, targetLocation, searchScope, targetCompensation, jobDescription, gates, criteria, prospect }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setEvaluations((current) => ({ ...current, [id]: body })); setQc((current) => current - 1); setOpenId(id); }
    catch (caught) { setError(caught.message || 'Evaluation failed.'); }
    finally { setBusy(''); }
  }

  return <main>
    <header className="brand"><div className="gem">S</div><div><strong>STAPPHIRE</strong><span>Prospect Lab · isolated preview</span></div><aside><small>TEST QC</small>{qc}</aside></header>
    <section className="intro"><p>PUBLIC-WEB SOURCING PROTOTYPE</p><h1>Find the evidence before chasing contact data.</h1><span>Paste a real requisition, confirm the weighted criteria, and judge the shortlist. Nothing entered here touches Stapphire production.</span></section>
    <section className="inputs">
      <label>Position title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <div className="locationControls"><label>Target work location <small>Used for geographic feasibility—not qualification scoring</small><input value={targetLocation} onChange={(event) => setTargetLocation(event.target.value)} placeholder="City, state, region, remote, or hybrid expectation" /></label><label>Search radius or reach <small>Defines which prospect locations are in scope</small><select value={searchScope} onChange={(event) => setSearchScope(event.target.value)}><option value="25_MILES">Within 25 miles</option><option value="50_MILES">Within 50 miles</option><option value="100_MILES">Within 100 miles</option><option value="500_MILES">Within 500 miles</option><option value="NATIONAL">National</option><option value="GLOBAL">Global</option></select></label></div>
      <label>Target compensation range <small>Optional. Used only for compensation alignment—not qualification scoring.</small><input value={targetCompensation} onChange={(event) => setTargetCompensation(event.target.value)} placeholder="Example: $120,000–$145,000 base" /></label>
      <label>Job description<textarea value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} placeholder="Paste the complete difficult-to-fill requisition here…" /></label>
      <label>Non-negotiable sourcing gates <small>One per line. A contradiction excludes the prospect; missing evidence marks the prospect Possible.</small><textarea className="criteria" value={gatesText} onChange={(event) => setGatesText(event.target.value)} /></label>
      <label>Weighted criteria <small>One per line: criterion | weight</small><textarea className="criteria" value={criteriaText} onChange={(event) => setCriteriaText(event.target.value)} /></label>
      <div className={`total ${total === 100 ? 'good' : ''}`}>Total weight <strong>{total}%</strong></div>
      <button onClick={search} disabled={busy || total !== 100 || !jobDescription.trim() || !gates.length}>{busy === 'search' ? 'Searching the public web…' : 'Find prospects'}</button>
    </section>
    {error && <div className="error">{error}</div>}
    {result && <section className="output">
      <details><summary>Search logic used</summary><code>{result.booleanQuery}</code><p>{result.strategyRationale}</p></details>
      <div className="tableHead"><span>Prospect</span><span>Location</span><span>Sourcing fit</span><span>Evidence score</span><span /></div>
      {result.prospects.map((prospect, index) => { const id = `${prospect.fullName}-${index}`; const unlocked = evaluations[id]; const open = openId === id && unlocked; return <article className="prospect" key={id}>
        <div className="row"><div className="identity"><strong>{prospect.fullName}</strong><small>{prospect.headline}</small></div><div className="location"><strong>{prospect.location.label}</strong><small>{label(prospect.location.confidence)}</small></div><span className={`fit ${prospect.sourcingFit.toLowerCase()}`}>{label(prospect.sourcingFit)}</span><b>{prospect.preliminaryScore}%</b><button onClick={() => evaluate(prospect, index)} disabled={Boolean(busy)}>{busy === id ? 'Evaluating…' : unlocked ? (open ? 'Hide evaluation' : 'View evaluation') : 'View evaluation · 1 test QC'}</button></div>
        {open && <div className="evaluation"><div className="evalHero"><div><small>PUBLIC-EVIDENCE EVALUATION</small><h2>{prospect.fullName}</h2><p>{unlocked.evaluation.location.label} · {label(unlocked.evaluation.location.confidence)} location</p><span className={`fit ${unlocked.sourcingFit.toLowerCase()}`}>{label(unlocked.sourcingFit)}</span></div><b>{unlocked.score}%<small>QUALIFICATION SCORE</small></b></div><p className="summary">{unlocked.evaluation.summary}</p><div className="intel"><div><small>LOCATION</small><strong>{unlocked.evaluation.location.label}</strong><span>{unlocked.evaluation.location.evidence}</span></div><div><small>COMPENSATION ALIGNMENT</small><strong>{label(unlocked.evaluation.compensation.targetAlignment)}</strong><b>{unlocked.evaluation.compensation.estimatedMarketRange}</b><span>{unlocked.evaluation.compensation.rationale} · {label(unlocked.evaluation.compensation.confidence)} confidence</span></div><div><small>OPPORTUNITY RECEPTIVITY</small><strong>{label(unlocked.evaluation.receptivity.level)}</strong><span>{unlocked.evaluation.receptivity.rationale} · {label(unlocked.evaluation.receptivity.confidence)} confidence</span></div></div><h3>Non-negotiable sourcing gates</h3><div className="findings gates">{unlocked.evaluation.gateFindings.map((finding) => { const gate = gates.find((item) => item.id === finding.gateId); return <div key={finding.gateId}><header><strong>{gate?.label}</strong><span className={`status ${finding.status.toLowerCase()}`}>{label(finding.status)}</span></header><p>{finding.evidence}</p><small>{finding.assessment}</small></div>; })}</div><div className="tri"><div><h3>Strongest evidence</h3><ul>{unlocked.evaluation.strongestEvidence.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>Gaps</h3><ul>{unlocked.evaluation.gaps.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>Verify</h3><ul>{unlocked.evaluation.unknowns.map((item) => <li key={item}>{item}</li>)}</ul></div></div><h3>Weighted qualification criteria</h3><div className="findings">{unlocked.evaluation.findings.map((finding) => { const criterion = criteria.find((item) => item.id === finding.criterionId); return <div key={finding.criterionId}><header><strong>{criterion?.label}</strong><span>{criterion?.weight}% weight · {finding.score}% alignment</span></header><p>{finding.evidence}</p><small>{finding.assessment}</small></div>; })}</div>{unlocked.evaluation.receptivity.signals.length > 0 && <><h3>Receptivity signals</h3><ul>{unlocked.evaluation.receptivity.signals.map((signal) => <li key={signal}>{signal}</li>)}</ul></>}<h3>Public sources</h3><ul className="sources">{unlocked.evaluation.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul><footer>Public evidence may be incomplete or stale. Compensation is a market estimate, and receptivity is an outreach hypothesis. Neither affects the qualification score.</footer></div>}
      </article>; })}
    </section>}
  </main>;
}
