'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export function CreateRequisitionForm() {
  const router = useRouter(); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form=new FormData(event.currentTarget);
    const response=await fetch('/api/requisitions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:form.get('title'),job_description:form.get('job_description')})});
    const data=await response.json();
    if(!response.ok){setError(data.error || 'Unable to save requisition.');setBusy(false);return}
    router.push(`/requisitions/${data.id}`); router.refresh();
  }
  return <form className="card stack" onSubmit={submit}><div className="field"><label htmlFor="title">Position title</label><input id="title" name="title" required /></div><div className="field"><label htmlFor="job_description">Job Description</label><textarea id="job_description" name="job_description" required /></div>{error&&<p className="error">{error}</p>}<div><button disabled={busy}>{busy?'Saving…':'Create requisition'}</button></div></form>;
}

