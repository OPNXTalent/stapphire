'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type FileStatus = 'staged' | 'processing' | 'done' | 'error';
type QueueItem = { file: File; status: FileStatus; message?: string };

export function ResumeUpload({ requisitionId }: { requisitionId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files).map((file) => ({ file, status: 'staged' as const }));
    // Skip anything already staged/queued with the same name+size - a
    // second pick of the same file shouldn't silently duplicate it.
    setQueue((prev) => [
      ...prev,
      ...incoming.filter((n) => !prev.some((p) => p.file.name === n.file.name && p.file.size === n.file.size))
    ]);
    if (inputRef.current) inputRef.current.value = '';
  }

  function removeStaged(index: number) {
    setQueue((prev) => prev.filter((_, i) => i !== index));
  }

  async function upload() {
    setBusy(true);
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].status !== 'staged') continue;
      setQueue((prev) => prev.map((item, idx) => (idx === i ? { ...item, status: 'processing' } : item)));
      try {
        const form = new FormData();
        form.append('resume', queue[i].file);
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
    router.refresh();
  }

  const stagedCount = queue.filter((q) => q.status === 'staged').length;
  const ICON: Record<FileStatus, string> = { staged: '·', processing: '…', done: '✓', error: '✕' };

  return (
    <div className="upload-bar">
      <input ref={inputRef} type="file" multiple hidden accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(e) => addFiles(e.target.files)} />
      <div className="upload-bar-row">
        <button type="button" className="upload-add-btn" onClick={() => inputRef.current?.click()} disabled={busy}>
          + Add résumés
        </button>
        {stagedCount > 0 && (
          <button type="button" className="upload-go-btn" onClick={upload} disabled={busy}>
            {busy ? 'Uploading…' : `Upload ${stagedCount}`}
          </button>
        )}
      </div>
      {queue.length > 0 && (
        <ul className="upload-queue">
          {queue.map((item, i) => (
            <li key={i} className={`upload-queue-item upload-queue-${item.status}`}>
              <span className="upload-queue-icon">{ICON[item.status]}</span>
              <span className="upload-queue-name">{item.file.name}</span>
              {item.message && <span className="upload-queue-msg">{item.message}</span>}
              {item.status === 'staged' && (
                <button type="button" className="upload-remove-btn" onClick={() => removeStaged(i)} aria-label={`Remove ${item.file.name}`}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
