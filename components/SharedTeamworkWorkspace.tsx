'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CandidateReport } from '@/components/CandidateReport';
import styles from './SharedTeamworkWorkspace.module.css';

type Note = { id: string; author_name: string; body: string; created_at: string; context_role?: string | null };
type Candidate = { id: string; name: string; createdAt: string; evaluation: null | { overall_match: number; job_responsibilities_score: number | null; hard_skills_score: number | null; soft_skills_score: number | null; keyword_terminology_score: number | null; assessment: unknown; created_at: string }; teamworkNotes: Note[] };
type Workspace = {
  requisition: { id: string; title: string; job_description: string; created_at: string };
  hiringCriteria: null | { extractionStatus: string; generatedAt: string | null; criteria: Array<{ id: string; category: string; label: string; rationale: string | null; jdEvidence: string | null; draftWeight: number; isKnockout: boolean }> };
  sourcing: null | { id: string; boolean_query: string; search_strategy: unknown; created_at: string; prospects: Array<Record<string, unknown>> };
  interviewPlan: null | { updatedAt: string; rounds: Array<{ id: string; title: string; questions: Array<{ id: string; text: string; areas: string[]; commentBox: boolean; yesNo: boolean }> }> };
  candidates: Candidate[];
  requisitionNotes: Note[];
};
type Payload = { joined: boolean; invitation: { title: string; invitedByName: string; accessLevel: 'viewer' | 'contributor'; createdAt: string }; participant?: { display_name: string; context_role: string }; workspace?: Workspace };
type Tab = 'description' | 'criteria' | 'sourcing' | 'interviews' | 'candidates';

const contextOptions = [
  ['hiring_manager', 'Hiring Manager'], ['interviewer', 'Interviewer / Panelist'], ['department_leader', 'Department Leader'],
  ['hr_ta', 'HR / Talent Acquisition'], ['executive_sponsor', 'Executive Sponsor'], ['other', 'Other']
] as const;
const contextLabel = (value?: string | null) => contextOptions.find(([key]) => key === value)?.[1] || '';
const formatDate = (value: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const textValue = (value: unknown) => typeof value === 'string' ? value : '';
const locationValue = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const source = value as Record<string, unknown>;
  return textValue(source.display) || textValue(source.label) || [textValue(source.city), textValue(source.region) || textValue(source.state), textValue(source.country)].filter(Boolean).join(', ');
};

function Notes({ notes, canPost, onPost, scopeLabel }: { notes: Note[]; canPost: boolean; onPost: (body: string) => Promise<void>; scopeLabel: string }) {
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setPosting(true);
    try { await onPost(body.trim()); setBody(''); } finally { setPosting(false); }
  }
  return <>
    <div className={styles.noteFeed}>
      {!notes.length && <p className={styles.empty}>No Teamwork notes yet.</p>}
      {notes.map((note) => <article key={note.id} className={styles.note}>
        <div><strong>{note.author_name}</strong>{note.context_role && <span>{contextLabel(note.context_role)}</span>}</div>
        <time>{formatDate(note.created_at)}</time><p>{note.body}</p>
      </article>)}
    </div>
    {canPost ? <form className={styles.noteForm} onSubmit={submit}>
      <label htmlFor={`teamwork-note-${scopeLabel}`}>Add to {scopeLabel}</label>
      <textarea id={`teamwork-note-${scopeLabel}`} value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} rows={3} placeholder="Share context with the hiring team…" />
      <button disabled={posting || !body.trim()}>{posting ? 'Posting…' : 'Post note'}</button>
    </form> : <p className={styles.viewerNotice}>This invitation is view only.</p>}
  </>;
}

export function SharedTeamworkWorkspace({ token }: { token: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [contextRole, setContextRole] = useState('hiring_manager');
  const [tab, setTab] = useState<Tab>('description');
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/teamwork/${token}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load this Teamwork workspace.');
    setPayload(data);
  }, [token]);
  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load this Teamwork workspace.')); }, [load]);

  async function join(event: FormEvent) {
    event.preventDefault(); setJoining(true); setError('');
    try {
      const response = await fetch(`/api/teamwork/${token}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName, contextRole }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to enter this Teamwork workspace.');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to enter this Teamwork workspace.'); }
    finally { setJoining(false); }
  }

  async function postNote(body: string, candidateId?: string) {
    setError('');
    const response = await fetch(`/api/teamwork/${token}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(candidateId ? { scope: 'candidate', candidateId, body } : { scope: 'requisition', body }) });
    const data = await response.json();
    if (!response.ok) { const message = data.error || 'Unable to post note.'; setError(message); throw new Error(message); }
    await load();
  }

  const workspace = payload?.workspace;
  const selectedCandidate = useMemo(() => workspace?.candidates.find((candidate) => candidate.id === selectedCandidateId) || null, [workspace, selectedCandidateId]);
  if (error && !payload) return <main className={styles.center}><section className={styles.gate}><p className={styles.kicker}>Stapphire Teamwork</p><h1>Unable to open this invitation</h1><p className={styles.error}>{error}</p></section></main>;
  if (!payload) return <main className={styles.center}><p>Loading Teamwork…</p></main>;
  if (!payload.joined) return <main className={styles.center}><section className={styles.gate}>
    <p className={styles.kicker}>Stapphire Teamwork</p><h1>Who’s joining?</h1><p className={styles.roleTitle}>{payload.invitation.title}</p>
    <p className={styles.inviteMeta}>Invited by {payload.invitation.invitedByName} · {formatDate(payload.invitation.createdAt)}</p>
    <form onSubmit={join} className={styles.joinForm}>
      <label>Your name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} autoFocus required /></label>
      <label>Your context<select value={contextRole} onChange={(event) => setContextRole(event.target.value)}>{contextOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      {error && <p className={styles.error}>{error}</p>}<button disabled={joining}>{joining ? 'Joining…' : 'View requisition'}</button>
    </form>
    <p className={styles.disclosure}>Your name identifies your contributions in this workspace. This lightweight link does not verify identity.</p>
  </section></main>;
  if (!workspace) return null;

  const canPost = payload.invitation.accessLevel === 'contributor';
  return <main className={styles.shell}>
    <header className={styles.header}><div><p className={styles.kicker}>Stapphire · Shared Teamwork</p><h1>{workspace.requisition.title}</h1><p>Invited by {payload.invitation.invitedByName} · {payload.participant?.display_name} ({contextLabel(payload.participant?.context_role)})</p></div><span className={styles.access}>{canPost ? 'Contributor' : 'View only'}</span></header>
    <nav className={styles.tabs} aria-label="Shared requisition sections">{([['description','Job Description'],['criteria','Hiring Criteria'],['sourcing','Sourcing'],['interviews','Interviews'],['candidates','Candidates']] as const).map(([id,label]) => <button key={id} className={tab === id ? styles.activeTab : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {error && <p className={styles.errorBanner}>{error}</p>}
    <div className={styles.layout}><section className={styles.content}>
      {tab === 'description' && <article><h2>Job Description</h2><div className={styles.prose}>{workspace.requisition.job_description}</div></article>}
      {tab === 'criteria' && <article><h2>Hiring Criteria</h2>{!workspace.hiringCriteria?.criteria.length ? <p className={styles.empty}>No hiring criteria are available.</p> : <div className={styles.cards}>{workspace.hiringCriteria.criteria.map((criterion) => <section className={styles.card} key={criterion.id}><div><strong>{criterion.label}</strong><span>{criterion.isKnockout ? 'Required' : `${criterion.draftWeight}%`}</span></div>{criterion.rationale && <p>{criterion.rationale}</p>}{criterion.jdEvidence && <small>Job evidence: {criterion.jdEvidence}</small>}</section>)}</div>}</article>}
      {tab === 'sourcing' && <article><h2>Sourcing</h2>{!workspace.sourcing ? <p className={styles.empty}>No prospect search has been saved.</p> : <><p className={styles.meta}>Latest search · {formatDate(workspace.sourcing.created_at)}</p><details><summary>Search strategy and market analysis</summary><pre className={styles.query}>{workspace.sourcing.boolean_query}{'\n\n'}{JSON.stringify(workspace.sourcing.search_strategy, null, 2)}</pre></details><div className={styles.prospectGrid}>{workspace.sourcing.prospects.map((prospect) => <section className={styles.prospect} key={String(prospect.id)}><div><h3>{textValue(prospect.full_name)}</h3><strong>{String(prospect.preliminary_score ?? '—')}% · {textValue(prospect.sourcing_fit).replaceAll('_',' ').toLowerCase()}</strong></div><p>{textValue(prospect.headline)}</p><p className={styles.meta}>{locationValue(prospect.location) || 'Location not established'}</p>{Array.isArray(prospect.sources) && <div>{prospect.sources.slice(0,3).map((source, index) => { const item = source && typeof source === 'object' ? source as Record<string,unknown> : {}; const url=textValue(item.url); return url ? <a key={index} href={url} target="_blank" rel="noreferrer">Public source {index+1}</a> : null; })}</div>}</section>)}</div></>}</article>}
      {tab === 'interviews' && <article><h2>Interview Plan</h2>{!workspace.interviewPlan?.rounds.length ? <p className={styles.empty}>No interview plan is available.</p> : workspace.interviewPlan.rounds.map((round) => <section className={styles.round} key={round.id}><h3>{round.title}</h3><ol>{round.questions.map((question) => <li key={question.id}><p>{question.text || <em>Open question</em>}</p>{question.areas.length > 0 && <small>Evaluates: {question.areas.join(', ')}</small>}</li>)}</ol></section>)}</article>}
      {tab === 'candidates' && <article><h2>Candidate Evaluations</h2>{!workspace.candidates.length ? <p className={styles.empty}>No candidates have been evaluated.</p> : <div className={styles.candidates}>{workspace.candidates.map((candidate) => <section className={styles.candidate} key={candidate.id}><button onClick={() => setSelectedCandidateId(selectedCandidateId === candidate.id ? null : candidate.id)}><span>{candidate.name}</span><strong>{candidate.evaluation ? `${candidate.evaluation.overall_match}% match` : 'Not evaluated'}</strong></button>{selectedCandidateId === candidate.id && candidate.evaluation && <div className={styles.report}><CandidateReport candidateName={candidate.name} positionTitle={workspace.requisition.title} overallMatch={candidate.evaluation.overall_match} responsibilities={candidate.evaluation.job_responsibilities_score} hardSkills={candidate.evaluation.hard_skills_score} softSkills={candidate.evaluation.soft_skills_score} keywords={candidate.evaluation.keyword_terminology_score} assessment={candidate.evaluation.assessment} evaluationDate={candidate.evaluation.created_at} /></div>}</section>)}</div>}</article>}
    </section>
    <aside className={styles.teamwork}><div className={styles.teamworkHead}><p className={styles.kicker}>Teamwork</p><h2>{selectedCandidate ? selectedCandidate.name : 'Requisition'}</h2>{selectedCandidate && <button onClick={() => setSelectedCandidateId(null)}>Requisition thread</button>}</div><Notes notes={selectedCandidate?.teamworkNotes || workspace.requisitionNotes} canPost={canPost} onPost={(body) => postNote(body, selectedCandidate?.id)} scopeLabel={selectedCandidate ? selectedCandidate.name : 'requisition'} /></aside>
    </div>
  </main>;
}
