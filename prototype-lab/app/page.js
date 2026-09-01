'use client';

import { useState } from 'react';

const DEFAULT_CRITERIA = `Capital-program delivery leadership | 30
Transportation construction experience | 25
Planning, design, and construction coordination | 20
Public-sector stakeholder management | 15
Budget, schedule, risk, and consultant control | 10`;

function parseCriteria(text) {
  return text.split('\n').map((line, index) => { const [label, weight] = line.split('|'); return { id: `criterion-${index + 1}`, label: label?.trim(), weight: Number(weight?.trim()) }; }).filter((item) => item.label && Number.isFinite(item.weight));
}

export default function Page() {
  const [title, setTitle] = useState('Senior Capital Improvement Manager');
  const [jobDescription, setJobDescription] = useState('');
  const [criteriaText, setCriteriaText] = useState(DEFAULT_CRITERIA);
  const [result, setResult] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [evaluations, setEvaluations] = useState({});
  const [qc, setQc] = useState(5);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const criteria = parseCriteria(criteriaText);
  const total = criteria.reduce((sum, item) => sum + item.weight, 0);

  async function search() {
    setBusy('search'); setError(''); setOpenId(null); setEvaluations({});
    try { const response = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, jobDescription, criteria }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setResult(body); }
    catch (caught) { setError(caught.message || 'Search failed.'); }
    finally { setBusy(''); }
  }

  async function evaluate(prospect, index) {
    const id = `${prospect.fullName}-${index}`;
    if (evaluations[id]) { setOpenId(openId === id ? null : id); return; }
    if (qc < 1) { setError('No test QC remains. Refresh the page to reset the lab.'); return; }
    setBusy(id); setError('');
    try { const response = await fetch('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, jobDescription, criteria, prospect }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setEvaluations((current) => ({ ...current, [id]: body })); setQc((current) => current - 1); setOpenId(id); }
    catch (caught) { setError(caught.message || 'Evaluation failed.'); }
    finally { setBusy(''); }
  }

  return <main>
    <header className="brand"><div className="gem">S</div><div><strong>STAPPHIRE</strong><span>Prospect Lab · isolated preview</span></div><aside><small>TEST QC</small>{qc}</aside></header>
    <section className="intro"><p>PUBLIC-WEB SOURCING PROTOTYPE</p><h1>Find the evidence before chasing contact data.</h1><span>Paste a real requisition, confirm the weighted criteria, and judge the shortlist. Nothing entered here touches Stapphire production.</span></section>
    <section className="inputs">
      <label>Position title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Job description<textarea value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} placeholder="Paste the complete difficult-to-fill requisition here…" /></label>
      <label>Weighted criteria <small>One per line: criterion | weight</small><textarea className="criteria" value={criteriaText} onChange={(event) => setCriteriaText(event.target.value)} /></label>
      <div className={`total ${total === 100 ? 'good' : ''}`}>Total weight <strong>{total}%</strong></div>
      <button onClick={search} disabled={busy || total !== 100 || !jobDescription.trim()}>{busy === 'search' ? 'Searching the public web…' : 'Find prospects'}</button>
    </section>
    {error && <div className="error">{error}</div>}
    {result && <section className="output">
      <details><summary>Search logic used</summary><code>{result.booleanQuery}</code><p>{result.strategyRationale}</p></details>
      <div className="tableHead"><span>Prospect</span><span>Preliminary score</span><span /></div>
      {result.prospects.map((prospect, index) => { const id = `${prospect.fullName}-${index}`; const unlocked = evaluations[id]; const open = openId === id && unlocked; return <article className="prospect" key={id}>
        <div className="row"><strong>{prospect.fullName}</strong><b>{prospect.preliminaryScore}</b><button onClick={() => evaluate(prospect, index)} disabled={Boolean(busy)}>{busy === id ? 'Evaluating…' : unlocked ? (open ? 'Hide evaluation' : 'View evaluation') : 'View evaluation · 1 test QC'}</button></div>
        {open && <div className="evaluation"><div className="evalHero"><div><small>PUBLIC-EVIDENCE EVALUATION</small><h2>{prospect.fullName}</h2></div><b>{unlocked.score}%<small>SOURCING FIT</small></b></div><p className="summary">{unlocked.evaluation.summary}</p><div className="tri"><div><h3>Strongest evidence</h3><ul>{unlocked.evaluation.strongestEvidence.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>Gaps</h3><ul>{unlocked.evaluation.gaps.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>Verify</h3><ul>{unlocked.evaluation.unknowns.map((item) => <li key={item}>{item}</li>)}</ul></div></div><h3>Weighted criteria</h3><div className="findings">{unlocked.evaluation.findings.map((finding) => { const criterion = criteria.find((item) => item.id === finding.criterionId); return <div key={finding.criterionId}><header><strong>{criterion?.label}</strong><span>{criterion?.weight}% weight · {finding.score}% alignment</span></header><p>{finding.evidence}</p><small>{finding.assessment}</small></div>; })}</div><h3>Public sources</h3><ul className="sources">{unlocked.evaluation.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul><footer>Public evidence may be incomplete or stale. This is a sourcing aid—not an employment decision.</footer></div>}
      </article>; })}
    </section>}
  </main>;
}
