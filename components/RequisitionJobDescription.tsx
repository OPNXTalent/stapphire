'use client';

import { FormEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

function normalizeForDisplay(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n(?:[ \t]*\n){2,}/g, '\n\n');
}

export function RequisitionJobDescription({ requisitionId, title, jobDescription }: { requisitionId: string; title: string; jobDescription: string }) {
  const router = useRouter();
  const titleInput = useRef<HTMLInputElement>(null);
  const jobDescriptionInput = useRef<HTMLTextAreaElement>(null);
  const savingRequest = useRef(false);
  const [editing, setEditing] = useState(false);
  const [savedTitle, setSavedTitle] = useState(title);
  const [savedJobDescription, setSavedJobDescription] = useState(jobDescription);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftJobDescription, setDraftJobDescription] = useState(jobDescription);
  const [titleError, setTitleError] = useState(false);
  const [jobDescriptionError, setJobDescriptionError] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function cancel() {
    setDraftTitle(savedTitle);
    setDraftJobDescription(savedJobDescription);
    setTitleError(false);
    setJobDescriptionError(false);
    setError('');
    setEditing(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRequest.current) return;
    setError('');
    if (!draftJobDescription.trim()) {
      setJobDescriptionError(true);
      setTitleError(false);
      jobDescriptionInput.current?.focus();
      return;
    }
    setJobDescriptionError(false);
    if (!draftTitle.trim()) {
      setTitleError(true);
      titleInput.current?.focus();
      return;
    }
    setTitleError(false);
    savingRequest.current = true;
    setSaving(true);
    try {
      const response = await fetch(`/api/requisitions/${requisitionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draftTitle, job_description: draftJobDescription })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to update requisition.');
      setSavedTitle(data.title);
      setSavedJobDescription(data.jobDescription);
      setDraftTitle(data.title);
      setDraftJobDescription(data.jobDescription);
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update requisition.');
    } finally {
      savingRequest.current = false;
      setSaving(false);
    }
  }

  return <section className="requisition-intelligence job-description-workspace" aria-labelledby="job-description-heading">
    <div className="intelligence-heading">
      <div><span className="eyebrow">Requisition source</span><h2 id="job-description-heading">Job Description</h2></div>
      {editing ? <div className="jd-edit-header-actions"><button type="submit" form="requisition-jd-edit-form" disabled={saving}>{saving?'Saving…':'Save changes'}</button><button type="button" className="secondary-action" onClick={cancel} disabled={saving}>Cancel</button></div> : <button type="button" className="jd-edit-action" onClick={()=>setEditing(true)}>Edit</button>}
    </div>
    {editing ? <form id="requisition-jd-edit-form" className="jd-edit-form job-description-scroll" onSubmit={save} noValidate>
      <div className="field">
        <label htmlFor="edit-requisition-title">Position title</label>
        <input ref={titleInput} id="edit-requisition-title" value={draftTitle} aria-invalid={titleError} aria-describedby={titleError?'edit-title-validation':undefined} onChange={(event)=>{setDraftTitle(event.target.value);if(event.target.value.trim())setTitleError(false)}} disabled={saving}/>
        {titleError&&<div id="edit-title-validation" className="intake-validation" role="alert"><strong>Position title is required.</strong><span>Enter the position title before saving the requisition.</span></div>}
      </div>
      <div className="field">
        <label htmlFor="edit-job-description">Job Description</label>
        <textarea ref={jobDescriptionInput} id="edit-job-description" value={draftJobDescription} aria-invalid={jobDescriptionError} aria-describedby={jobDescriptionError?'edit-jd-validation':undefined} onChange={(event)=>{setDraftJobDescription(event.target.value);if(event.target.value.trim())setJobDescriptionError(false)}} disabled={saving}/>
        {jobDescriptionError&&<div id="edit-jd-validation" className="intake-validation" role="alert"><strong>A Job Description is required to save the requisition.</strong><span>Enter the Job Description before saving.</span></div>}
      </div>
      {error&&<p className="error" role="alert">{error}</p>}
    </form> : <div className="jd job-description-scroll">{normalizeForDisplay(savedJobDescription)}</div>}
  </section>;
}
