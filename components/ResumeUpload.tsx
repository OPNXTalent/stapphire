'use client';
import { FormEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type FileStatus = 'pending' | 'processing' | 'done' | 'error';
type QueueItem = { name: string; status: FileStatus; message?: string };

export function ResumeUpload({ requisitionId }: { requisitionId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const files = inputRef.current?.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    setBusy(true);
    setQueue(fileList.map((f) => ({ name: f.name, status: 'pending' })));

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      setQueue((prev) => prev.map((item, idx) => (idx === i ? { ...item, status: 'processing' } : item)));
      try {
        const form = new FormData();
        form.append('resume', file);
        const response = await fetch(`/api/requisitions/${requisitionId}/candidates`, { method: 'POST', body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Evaluation failed.');
        setQueue((prev) => prev.map((item, idx) => (idx === i ? { ...item, status: 'done' } : item)));
      } catch (err) {
        setQueue((prev) =>
          prev.map((item, idx) => (idx === i ? { ...item, status: 'error', message: err instanceof Error ? err.message : 'Evaluation failed.' } : item))
        );
      }
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
    router.refresh();
  }

  const ICON: Record<FileStatus, string> = { pending: '·', processing: '…', done: '✓', error: '✕' };

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="field">
        <label htmlFor="resume">Resume</label>
        <input
          ref={inputRef}
          id="resume"
          name="resume"
          type="file"
          multiple
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          required
        />
      </div>
      <div>
        <button disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
      </div>
      {queue.length > 0 && (
        <ul className="upload-queue">
          {queue.map((item, i) => (
            <li key={i} className={`upload-queue-item upload-queue-${item.status}`}>
              <span className="upload-queue-icon">{ICON[item.status]}</span>
              <span className="upload-queue-name">{item.name}</span>
              {item.message && <span className="upload-queue-msg">{item.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
