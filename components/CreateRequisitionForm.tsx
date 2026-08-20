'use client';

import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { detectPositionTitle } from '@/lib/detectPositionTitle';
import { StapphireProcessing } from '@/components/StapphireProcessing';

export function CreateRequisitionForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const jobDescriptionInput = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const navigationSafeguard = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [title, setTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [jobDescriptionError, setJobDescriptionError] = useState(false);
  const [titleError, setTitleError] = useState(false);

  // Defensive last-resort safeguard only, not the primary fix: it only
  // ever starts AFTER the requisition is confirmed persisted (POST
  // succeeded, id known) and router.push() has been called - never
  // while the create request is still in flight, since resetting the
  // form mid-request would let the user submit a second time while the
  // first is still pending. If client-side navigation still hasn't
  // unmounted this component within the window, it falls back to a
  // hard navigation to the same known URL rather than re-enabling
  // Create. The actual fix for the reported hang was removing a
  // racing router.refresh() call right after router.push() below -
  // this timer exists purely so an unrelated, unforeseen client-side
  // navigation failure can never leave the user stuck on the
  // processing screen with no way to reach the requisition that
  // already exists.
  useEffect(() => {
    return () => {
      if (navigationSafeguard.current) clearTimeout(navigationSafeguard.current);
    };
  }, []);

  function updateJobDescription(value: string, suggestedTitle = detectPositionTitle(value)) {
    setJobDescription(value);
    if (value.trim()) setJobDescriptionError(false);
    if (!titleEdited && suggestedTitle) setTitle(suggestedTitle);
    if (!titleEdited && suggestedTitle) setTitleError(false);
  }

  async function readFile(file: File) {
    setUploading(true);
    setError('');
    const form = new FormData();
    form.set('file', file);
    try {
      const response = await fetch('/api/requisitions/job-description', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to read the Job Description.');
      setFileName(file.name);
      updateJobDescription(data.jobDescription, data.suggestedTitle);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to read the Job Description.');
    } finally {
      setUploading(false);
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void readFile(file);
    event.target.value = '';
  }

  function dropFile(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void readFile(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    if (!jobDescription.trim()) {
      setJobDescriptionError(true);
      setTitleError(false);
      jobDescriptionInput.current?.focus();
      return;
    }
    setJobDescriptionError(false);
    if (!title.trim()) {
      setTitleError(true);
      titleInput.current?.focus();
      return;
    }
    setTitleError(false);
    submitting.current = true;
    setBusy(true);
    try {
      const response = await fetch('/api/requisitions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, job_description: jobDescription })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save requisition.');
      const destination = `/requisitions/${data.id}`;
      router.push(destination);
      // The requisition is now confirmed persisted (response.ok, id
      // known) - a duplicate create is no longer a risk from here on,
      // so the safeguard's only job is making sure the user actually
      // lands on it. If client-side navigation hasn't unmounted this
      // component within the window, fall back to a hard navigation to
      // the same known URL rather than resetting the form, which would
      // re-enable Create and risk a second requisition being created
      // for what the user experiences as one submission.
      navigationSafeguard.current = setTimeout(() => {
        window.location.href = destination;
      }, 15000);
    } catch (caught) {
      if (navigationSafeguard.current) clearTimeout(navigationSafeguard.current);
      setError(caught instanceof Error ? caught.message : 'Unable to save requisition.');
      submitting.current = false;
      setBusy(false);
    }
  }

  if (busy) return <StapphireProcessing className="card create-requisition-form create-processing" title="Saving your requisition…" detail="Taking you to the requisition workspace"/>;

  return <form className="card create-requisition-form" onSubmit={submit} noValidate>
    <div className="field">
      <label htmlFor="title">Position title</label>
      <input ref={titleInput} id="title" name="title" value={title} aria-invalid={titleError} aria-describedby={titleError ? 'title-validation' : undefined} onChange={(event)=>{setTitle(event.target.value);setTitleEdited(true);if(event.target.value.trim())setTitleError(false)}}/>
      {titleError&&<div id="title-validation" className="intake-validation" role="alert"><strong>Position title is required.</strong><span>Enter the position title before creating the requisition.</span></div>}
    </div>
    <div className="field create-jd-field">
      <label htmlFor="job_description">Paste Job Description</label>
      <textarea ref={jobDescriptionInput} className="create-jd-textarea" id="job_description" name="job_description" value={jobDescription} aria-invalid={jobDescriptionError} aria-describedby={jobDescriptionError ? 'job-description-validation' : undefined} onChange={(event)=>updateJobDescription(event.target.value)}/>
      {jobDescriptionError&&<div id="job-description-validation" className="intake-validation" role="alert"><strong>A Job Description is required to create a requisition.</strong><span>Paste a Job Description or upload a PDF, DOCX, or TXT file.</span></div>}
    </div>
    <div className="form-separator"><span>OR</span></div>
    <div className="field">
      <label>Upload Job Description</label>
      <input ref={fileInput} className="visually-hidden" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={chooseFile}/>
      <button className="jd-upload-zone" type="button" onClick={()=>fileInput.current?.click()} onDragOver={(event)=>event.preventDefault()} onDrop={dropFile} disabled={uploading}>
        <strong>{uploading ? 'Reading file...' : fileName || 'Choose or drop a JD file'}</strong>
        <span>PDF, DOCX, or TXT</span>
      </button>
    </div>
    {error&&<p className="error">{error}</p>}
    <div className="create-form-actions"><button disabled={busy||uploading}>{busy?'Saving...':'Create requisition'}</button><button type="button" className="secondary-action" onClick={()=>router.push('/')} disabled={busy}>Cancel</button></div>
  </form>;
}
