'use client';

import { ChangeEvent, DragEvent, FormEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { detectPositionTitle } from '@/lib/detectPositionTitle';

export function CreateRequisitionForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function updateJobDescription(value: string, suggestedTitle = detectPositionTitle(value)) {
    setJobDescription(value);
    if (!titleEdited && suggestedTitle) setTitle(suggestedTitle);
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
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/requisitions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, job_description: jobDescription })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save requisition.');
      router.push(`/requisitions/${data.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save requisition.');
      setBusy(false);
    }
  }

  return <form className="card create-requisition-form" onSubmit={submit}>
    <div className="field">
      <label>Upload Job Description</label>
      <input ref={fileInput} className="visually-hidden" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={chooseFile}/>
      <button className="jd-upload-zone" type="button" onClick={()=>fileInput.current?.click()} onDragOver={(event)=>event.preventDefault()} onDrop={dropFile} disabled={uploading}>
        <strong>{uploading ? 'Reading file...' : fileName || 'Choose or drop a JD file'}</strong>
        <span>PDF, DOCX, or TXT</span>
      </button>
    </div>
    <div className="form-separator"><span>OR</span></div>
    <div className="field create-jd-field">
      <label htmlFor="job_description">Paste Job Description</label>
      <textarea className="create-jd-textarea" id="job_description" name="job_description" required value={jobDescription} onChange={(event)=>updateJobDescription(event.target.value)}/>
    </div>
    <div className="field">
      <label htmlFor="title">Position title</label>
      <input id="title" name="title" required value={title} onChange={(event)=>{setTitle(event.target.value);setTitleEdited(true)}}/>
    </div>
    {error&&<p className="error">{error}</p>}
    <div className="create-form-actions"><button disabled={busy||uploading}>{busy?'Saving...':'Create requisition'}</button></div>
  </form>;
}
