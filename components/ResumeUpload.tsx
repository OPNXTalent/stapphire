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
  const { batches, startUpload, dismissBatch, dismissedOperationIds, dismissOperation } = useResumeUploadManager();
  const [staged, setStaged] = useState<File[]>([]);
  const [operations, setOperations] = useState<ResumeOperationSummary[]>([]);
  const [retrying, setRetrying] = useState(false);
  const localBatches = batches.filter((batch) => batch.requisitionId === requisitionId);
  const currentLocalBatch = localBatches[localBatches.length - 1] || null;
  // Bind explicitly to the current batch's own operation when one
  // exists - never pick an arbitrary active operation from the array.
  // Historical operations (from prior sessions, other batches, or
  // stuck/unfinished work) must never be displayed as if they belong
  // to a batch the user just started. Only when there's no local
  // batch to bind to (e.g. after navigation/refresh) do we fall back
  // to the newest operation overall - the list is already sorted
  // created_at desc by the API, so operations[0] is that operation.
  const operationForCurrentBatch = currentLocalBatch?.operationId
    ? operations.find((operation) => operation.id === currentLocalBatch.operationId) || null
    : null;
  const latestOperation = operationForCurrentBatch || (!currentLocalBatch ? operations[0] || null : null);
  const visibleOperation = latestOperation && !dismissedOperationIds.has(latestOperation.id) ? latestOperation : null;

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
        const signature = next.map((operation) => `${operation.id}:${operation.progressCurrent}:${operation.status}:${operation.items.map((item) => `${item.id}:${item.status}:${item.candidateId || ''}:${item.evaluationId || ''}`).join(',')}`).join('|');
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

  const localUploading = currentLocalBatch && (
    currentLocalBatch.phase === 'creating' ||
    currentLocalBatch.phase === 'uploading' ||
    // Browser upload just finished, but the durable operation poll
    // hasn't caught up yet - keep the bridge visible rather than let
    // the progress UI drop to nothing for one poll cycle. This is the
    // exact seam that made a working durable process look broken:
    // local state ended before durable state was ready to take over.
    (currentLocalBatch.phase === 'accepted' && !visibleOperation)
  );
  const localAccepted = currentLocalBatch?.items.filter((item) => item.status === 'accepted').length || 0;
  const localTotal = currentLocalBatch?.items.length || 0;
  const visibleFailedItems = visibleOperation?.items.filter((item) => item.status === 'failed') || [];
  const completedItems = visibleOperation?.items.filter((item) => item.status === 'completed').length || 0;

  function dismissProgress() {
    if (!visibleOperation) return;
    dismissOperation(visibleOperation.id);
    if (currentLocalBatch?.operationId === visibleOperation.id) dismissBatch(currentLocalBatch.clientBatchKey);
  }

  function itemPresentation(status: ResumeOperationSummary['items'][number]['status']) {
    if (status === 'completed') return { className: 'upload-queue-done', icon: '✓', label: 'Completed' };
    if (status === 'failed' || status === 'cancelled') return { className: 'upload-queue-error', icon: '×', label: status === 'failed' ? 'Failed' : 'Cancelled' };
    if (status === 'processing') return { className: 'upload-queue-processing', icon: '·', label: 'Evaluating' };
    if (status === 'queued') return { className: 'upload-queue-processing', icon: '·', label: 'Queued' };
    return { className: 'upload-queue-processing', icon: '·', label: 'Uploading' };
  }

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
      ) : null}

      {visibleOperation && <div className="upload-operation-progress" aria-live="polite">
        {isActiveOperation(visibleOperation.status) && (
          <StapphireProcessing
            className="processing-compact"
            title="Evaluating résumés…"
            detail={`${completedItems} of ${visibleOperation.progressTotal || visibleOperation.items.length} complete`}
          />
        )}
        <div className="upload-complete">
          <span className="upload-summary">
            {isActiveOperation(visibleOperation.status)
              ? `${completedItems} of ${visibleOperation.progressTotal || visibleOperation.items.length} complete`
              : visibleFailedItems.length > 0
                ? `${completedItems} completed · ${visibleFailedItems.length} need attention`
                : `${completedItems} ${completedItems === 1 ? 'résumé' : 'résumés'} completed`}
          </span>
          {visibleFailedItems.some((item) => item.retryable) && <button type="button" className="upload-go-btn" onClick={retryFailed} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry failed'}</button>}
          <button type="button" className="upload-go-btn" onClick={dismissProgress}>Done</button>
        </div>
        <ul className="upload-queue">{visibleOperation.items.map((item) => {
          const presentation = itemPresentation(item.status);
          return <li key={item.id} className={`upload-queue-item ${presentation.className}`}>
            <span className="upload-queue-icon" aria-hidden="true">{presentation.icon}</span>
            <span className="upload-queue-name">{item.filename}</span>
            <span className="upload-queue-status">{presentation.label}</span>
            {item.errorSummary && <span className="upload-queue-msg">{item.errorSummary}</span>}
          </li>;
        })}</ul>
      </div>}

      <div className="upload-bar-row">
        <button type="button" className="upload-add-btn" onClick={() => inputRef.current?.click()} disabled={Boolean(localUploading)}>+ Add résumés</button>
        {staged.length > 0 && !localUploading && <button type="button" className="upload-go-btn" onClick={beginUpload}>Upload {staged.length}</button>}
      </div>
    </div>
  );
}
