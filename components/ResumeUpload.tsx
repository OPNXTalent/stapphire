'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StapphireProcessing } from '@/components/StapphireProcessing';
import { useResumeUploadManager } from '@/components/ResumeUploadManager';
import type { ResumeOperationSummary } from '@/lib/operationTypes';
import { isActiveOperation } from '@/lib/operationTypes';
import { getResumeSourceType, MAX_RESUME_BATCH_SIZE, MAX_RESUME_SIZE } from '@/lib/resumeFiles';

export function ResumeUpload({ requisitionId }: { requisitionId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastProgress = useRef<string | null>(null);
  const starting = useRef(false);
  const { batches, startUpload, dismissBatch } = useResumeUploadManager();
  const [staged, setStaged] = useState<File[]>([]);
  const [operations, setOperations] = useState<ResumeOperationSummary[]>([]);
  const [retrying, setRetrying] = useState(false);
  const localBatches = batches.filter((batch) => batch.requisitionId === requisitionId);
  const currentLocalBatch = localBatches[localBatches.length - 1] || null;
  const activeOperation = operations.find((operation) => isActiveOperation(operation.status)) || null;
  const latestOperation = activeOperation || operations[0] || null;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function poll() {
      try {
        const response = await fetch(`/api/requisitions/${requisitionId}/operations`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to read resume operations.');
        const result = await response.json() as { resumeOperations?: ResumeOperationSummary[] };
        if (cancelled) return;
        const next = Array.isArray(result.resumeOperations) ? result.resumeOperations : [];
        setOperations(next);
        const signature = next.map((operation) => `${operation.id}:${operation.progressCurrent}:${operation.status}`).join('|');
        if (lastProgress.current !== null && signature !== lastProgress.current) router.refresh();
        lastProgress.current = signature;
        if (next.some((operation) => isActiveOperation(operation.status)) && !document.hidden) timer = setTimeout(poll, 2500);
      } catch {
        if (!cancelled && !document.hidden) timer = setTimeout(poll, 5000);
      }
    }
    function resume() {
      if (document.hidden) return;
      if (timer) clearTimeout(timer);
      void poll();
    }
    void poll();
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [requisitionId, router, currentLocalBatch?.operationId, currentLocalBatch?.phase]);

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const incoming = Array.from(files).filter((file) => getResumeSourceType(file.name, file.type) && file.size > 0 && file.size <= MAX_RESUME_SIZE);
    setStaged((current) => [...current, ...incoming.filter((file) => !current.some((existing) => existing.name === file.name && existing.size === file.size))].slice(0, MAX_RESUME_BATCH_SIZE));
    if (inputRef.current) inputRef.current.value = '';
  }

  function beginUpload() {
    if (starting.current || staged.length === 0) return;
    starting.current = true;
    const files = [...staged];
    setStaged([]);
    void startUpload(requisitionId, files).finally(() => { starting.current = false; });
  }

  async function retryFailed() {
    if (!latestOperation || retrying) return;
    setRetrying(true);
    try {
      const response = await fetch(`/api/operations/${latestOperation.id}/retry`, { method: 'POST' });
      if (!response.ok) throw new Error('Unable to retry failed resumes.');
      const statusResponse = await fetch(`/api/requisitions/${requisitionId}/operations`, { cache: 'no-store' });
      if (statusResponse.ok) {
        const result = await statusResponse.json() as { resumeOperations?: ResumeOperationSummary[] };
        setOperations(Array.isArray(result.resumeOperations) ? result.resumeOperations : []);
      }
    } catch {
      alert('Unable to retry failed resume evaluations. Try again.');
    } finally {
      setRetrying(false);
    }
  }

  const localUploading = currentLocalBatch && (currentLocalBatch.phase === 'creating' || currentLocalBatch.phase === 'uploading');
  const localAccepted = currentLocalBatch?.items.filter((item) => item.status === 'accepted').length || 0;
  const localTotal = currentLocalBatch?.items.length || 0;
  const failedItems = latestOperation?.items.filter((item) => item.status === 'failed') || [];
  const retryableFailures = failedItems.some((item) => item.retryable);

  return (
    <div className="upload-bar">
      <input ref={inputRef} type="file" multiple hidden
        accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        onChange={(event) => addFiles(event.target.files)}/>

      {staged.length > 0 && <ul className="upload-queue">
        {staged.map((file, index) => <li key={`${file.name}:${file.size}`} className="upload-queue-item upload-queue-staged">
          <span className="upload-queue-icon">·</span><span className="upload-queue-name">{file.name}</span>
          <button type="button" className="upload-remove-btn" onClick={() => setStaged((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}>×</button>
        </li>)}
      </ul>}

      {localUploading && currentLocalBatch ? (
        <div className="upload-durable-boundary">
          <StapphireProcessing className="processing-compact" title="Uploading résumés…" detail={`${localAccepted} of ${localTotal} safely uploaded`}/>
          <small>Keep this browser open until upload completes. Evaluation continues independently after each file is safely stored.</small>
        </div>
      ) : activeOperation ? (
        <StapphireProcessing className="processing-compact"
          title={activeOperation.progressTotal === 1 ? 'Evaluating résumé…' : 'Evaluating résumés…'}
          detail={`${activeOperation.progressCurrent} of ${activeOperation.progressTotal || 0} complete`}/>
      ) : currentLocalBatch?.phase === 'accepted' ? (
        <div className="upload-complete">
          <span className="upload-summary">{localAccepted} {localAccepted === 1 ? 'résumé' : 'résumés'} added · Evaluation continues in the background</span>
          <button type="button" className="upload-go-btn" onClick={() => dismissBatch(currentLocalBatch.clientBatchKey)}>Done</button>
        </div>
      ) : null}

      {latestOperation && !activeOperation && failedItems.length > 0 && <div className="upload-complete">
        <span className="upload-summary">{latestOperation.progressCurrent - failedItems.length} completed · {failedItems.length} need attention</span>
        {retryableFailures && <button type="button" className="upload-go-btn" onClick={retryFailed} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry failed'}</button>}
      </div>}
      {failedItems.length > 0 && <ul className="upload-queue">{failedItems.map((item) => <li key={item.id} className="upload-queue-item upload-queue-error">
        <span className="upload-queue-icon">×</span><span className="upload-queue-name">{item.filename}</span>
        {item.errorSummary && <span className="upload-queue-msg">{item.errorSummary}</span>}
      </li>)}</ul>}

      <div className="upload-bar-row">
        <button type="button" className="upload-add-btn" onClick={() => inputRef.current?.click()} disabled={Boolean(localUploading)}>+ Add résumés</button>
        {staged.length > 0 && !localUploading && <button type="button" className="upload-go-btn" onClick={beginUpload}>Upload {staged.length}</button>}
      </div>
    </div>
  );
}
