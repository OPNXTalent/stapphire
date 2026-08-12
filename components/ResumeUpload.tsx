'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export function ResumeUpload({ requisitionId }: { requisitionId: string }) {
  const router=useRouter(); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);const response=await fetch(`/api/requisitions/${requisitionId}/candidates`,{method:'POST',body:form});const data=await response.json();if(!response.ok){setError(data.error||'Evaluation failed.');setBusy(false);return}router.push(`/candidates/${data.candidate_id}`);router.refresh()}
  return <form className="card stack" onSubmit={submit}><div><h2>Evaluate a candidate</h2><p className="muted">Upload one complete PDF, DOCX, or text resume.</p></div><div className="field"><label htmlFor="resume">Resume</label><input id="resume" name="resume" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" required /></div>{error&&<p className="error">{error}</p>}<div><button disabled={busy}>{busy?'Reading and evaluating…':'Upload and evaluate'}</button></div></form>;
}

