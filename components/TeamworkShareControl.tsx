'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import styles from './TeamworkShareControl.module.css';

type Participant = { id: string; display_name: string; context_role: string; joined_at: string; last_seen_at: string };
type Share = { id: string; url: string; invited_by_name: string; access_level: 'viewer' | 'contributor'; created_at: string; revoked_at: string | null; participants: Participant[] };
const contextLabels: Record<string,string> = { hiring_manager:'Hiring Manager',interviewer:'Interviewer / Panelist',department_leader:'Department Leader',hr_ta:'HR / Talent Acquisition',executive_sponsor:'Executive Sponsor',other:'Other' };
const formatDate = (value: string) => new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));

export function TeamworkShareControl({ requisitionId }: { requisitionId: string }) {
  const [open,setOpen]=useState(false); const [shares,setShares]=useState<Share[]>([]); const [inviter,setInviter]=useState(''); const [access,setAccess]=useState<'viewer'|'contributor'>('contributor'); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [copied,setCopied]=useState('');
  const load=useCallback(async()=>{ const response=await fetch(`/api/requisitions/${requisitionId}/teamwork-shares`,{cache:'no-store'}); const data=await response.json(); if(!response.ok) throw new Error(data.error||'Unable to load links.'); setShares(data.shares||[]); },[requisitionId]);
  useEffect(()=>{ try{setInviter(localStorage.getItem('stapphire_inviter_name')||'');}catch{} },[]);
  useEffect(()=>{ if(open) load().catch((reason)=>setError(reason instanceof Error?reason.message:'Unable to load links.')); },[open,load]);
  async function create(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{const name=inviter.trim();const response=await fetch(`/api/requisitions/${requisitionId}/teamwork-shares`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitedByName:name,accessLevel:access})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to create link.');setShares(data.shares||[]);try{localStorage.setItem('stapphire_inviter_name',name);}catch{}}catch(reason){setError(reason instanceof Error?reason.message:'Unable to create link.');}finally{setBusy(false);}}
  async function revoke(shareId:string){if(!confirm('Revoke this Teamwork link? Anyone using it will lose access.'))return;setBusy(true);setError('');try{const response=await fetch(`/api/requisitions/${requisitionId}/teamwork-shares`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({shareId})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to revoke link.');setShares(data.shares||[]);}catch(reason){setError(reason instanceof Error?reason.message:'Unable to revoke link.');}finally{setBusy(false);}}
  async function copy(share:Share){await navigator.clipboard.writeText(share.url);setCopied(share.id);setTimeout(()=>setCopied(''),1800);}
  return <div className={styles.wrap}>
    <button type="button" className={styles.trigger} onClick={()=>setOpen(!open)} aria-expanded={open}>Share access</button>
    {open&&<section className={styles.panel} aria-label="Teamwork share links"><div className={styles.heading}><div><strong>Invite to this requisition</strong><p>Candidate Files and recruiter notes stay private.</p></div><button type="button" onClick={()=>setOpen(false)} aria-label="Close">×</button></div>
      <form onSubmit={create} className={styles.form}><label>Invited by<input value={inviter} onChange={(event)=>setInviter(event.target.value)} maxLength={80} placeholder="Your name" required/></label><label>Access<select value={access} onChange={(event)=>setAccess(event.target.value as 'viewer'|'contributor')}><option value="contributor">Contributor — may comment</option><option value="viewer">Viewer — read only</option></select></label><button disabled={busy}>{busy?'Creating…':'Create link'}</button></form>
      {error&&<p className={styles.error}>{error}</p>}
      <div className={styles.list}>{shares.length===0&&<p className={styles.empty}>No Teamwork links yet.</p>}{shares.map((share)=><article key={share.id} className={share.revoked_at?styles.revoked:''}><div className={styles.shareTop}><div><strong>{share.access_level==='contributor'?'Contributor':'Viewer'} link</strong><p>Invited by {share.invited_by_name} · {formatDate(share.created_at)}</p></div><span>{share.revoked_at?'Revoked':'Active'}</span></div>{!share.revoked_at&&<div className={styles.actions}><button type="button" onClick={()=>copy(share)}>{copied===share.id?'Copied':'Copy link'}</button><button type="button" onClick={()=>revoke(share.id)} disabled={busy}>Revoke</button></div>}<details><summary>Who joined ({share.participants.length})</summary>{share.participants.length===0?<p>No one has joined yet.</p>:share.participants.map((participant)=><div className={styles.person} key={participant.id}><strong>{participant.display_name}</strong><span>{contextLabels[participant.context_role]||participant.context_role}</span><small>Joined {formatDate(participant.joined_at)} · Last seen {formatDate(participant.last_seen_at)}</small></div>)}</details></article>)}</div>
    </section>}
  </div>;
}
