'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StapphireProcessing } from '@/components/StapphireProcessing';
import { useResumeUploadManager } from '@/components/ResumeUploadManager';
import type { ResumeOperationSummary } from '@/lib/operationTypes';
import { isActiveOperation } from '@/lib/operationTypes';
import { getResumeSourceType, MAX_RESUME_BATCH_SIZE, MAX_RESUME_SIZE } from '@/lib/resumeFiles';

type ControllerPhase = 'idle' | 'checking' | 'active' | 'terminal';

// Single-flight polling controller for durable résumé-operation status.
// There is exactly one authority for fetching this requisition's
// current résumé operation state - no separate immediate-poll effect,
// no overlapping requests, no generation counter (that guarded against
// overlapping requests; this design structurally prevents them from
// ever existing in the first place).
//
// State machine: idle -> checking -> active -> terminal -> idle
//   idle: no unresolved current résumé operation. No polling.
//   checking: a target operation is known but not yet confirmed found
//     in the last fetch (either just discovered, or a fetch is
//     pending/failed and we don't have a definitive read yet).
//   active: last confirmed status is queued/processing. Poll continues
//     at the normal interval.
//   terminal: last confirmed status is completed/partially_completed/
//     failed/cancelled. Polling stops.
//
// Single-flight guarantee: inFlightRef is true for the entire duration
// of a request. Any trigger to check again (a new operation becoming
// known, the interval firing, a manual wake) that arrives while a
// request is in flight only ever sets wakeRequestedRef=true - it never
// starts a second request. When the in-flight request's finally block
// runs, if wakeRequestedRef is set, it immediately runs exactly one
// more request (for whatever is currently the tracked target, which
// may have changed while the prior request was in flight) - "request
// again when finished", never "request A and request B racing".
export function ResumeUpload({ requisitionId }: { requisitionId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastProgress = useRef<string | null>(null);
  const starting = useRef(false);
  const { batches, startUpload, dismissBatch, dismissedOperationIds, dismissOperation } = useResumeUploadManager();
  const [staged, setStaged] = useState<File[]>([]);
  const [retrying, setRetrying] = useState(false);
  const localBatches = batches.filter((batch) => batch.requisitionId === requisitionId);
  const currentLocalBatch = localBatches[localBatches.length - 1] || null;

  const [phase, setPhase] = useState<ControllerPhase>('idle');
  const [trackedOperation, setTrackedOperation] = useState<ResumeOperationSummary | null>(null);
  const [pollUnavailable, setPollUnavailable] = useState(false);

  const phaseRef = useRef<ControllerPhase>('idle');
  const trackedOperationIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const wakeRequestedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const wakeRef = useRef<(operationId: string | null, options?: { reconstruct?: boolean }) => void>(() => {});
  const dismissedOperationIdsRef = useRef(dismissedOperationIds);
  dismissedOperationIdsRef.current = dismissedOperationIds;

  function setPhaseBoth(next: ControllerPhase) {
    phaseRef.current = next;
    setPhase(next);
  }

  useEffect(() => {
    cancelledRef.current = false;

    // options.reconstruct means: we don't have an explicit target yet
    // (no current local batch) - on the first check, discover the
    // newest non-dismissed operation for this requisition, if any, and
    // adopt it as the tracked target. Preserves "navigate away and
    // back reconstructs progress" without polling indefinitely if
    // nothing relevant is ever found - a reconstruction check that
    // finds nothing goes idle and stays idle.
    async function runOnce(reconstruct: boolean) {
      if (cancelledRef.current) return;
      const targetId = trackedOperationIdRef.current;
      if (!targetId && !reconstruct) return;
      if (inFlightRef.current) {
        wakeRequestedRef.current = true;
        return;
      }
      inFlightRef.current = true;
      try {
        const response = await fetch(`/api/requisitions/${requisitionId}/operations`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to read resume operations.');
        const result = await response.json() as { resumeOperations?: ResumeOperationSummary[] };
        if (cancelledRef.current) return;
        const list = Array.isArray(result.resumeOperations) ? result.resumeOperations : [];

        let found: ResumeOperationSummary | null = null;
        if (trackedOperationIdRef.current) {
          found = list.find((operation) => operation.id === trackedOperationIdRef.current) || null;
        } else if (reconstruct) {
          const newest = list[0] || null;
          if (newest && !dismissedOperationIdsRef.current.has(newest.id)) {
            trackedOperationIdRef.current = newest.id;
            found = newest;
          }
        }

        setPollUnavailable(false);
        if (found) {
          setTrackedOperation(found);
          const signature = `${found.id}:${found.progressCurrent}:${found.status}:${found.items.map((item) => `${item.id}:${item.status}:${item.candidateId || ''}:${item.evaluationId || ''}`).join(',')}`;
          // Pure side-effect notification on signature change - never
          // participates in polling ownership or scheduling.
          if (lastProgress.current !== null && signature !== lastProgress.current) router.refresh();
          lastProgress.current = signature;
          setPhaseBoth(isActiveOperation(found.status) ? 'active' : 'terminal');
        } else if (trackedOperationIdRef.current) {
          // Target known but not yet visible in this fetch - stay
          // checking, do not clear previously known state.
          setPhaseBoth('checking');
        } else {
          // Reconstruction found nothing relevant to track.
          setPhaseBoth('idle');
        }
      } catch {
        if (cancelledRef.current) return;
        // Preserve last-known trackedOperation through a transient
        // failure - never clear it here.
        setPollUnavailable(true);
      } finally {
        inFlightRef.current = false;
        if (cancelledRef.current) return;
        if (wakeRequestedRef.current) {
          wakeRequestedRef.current = false;
          void runOnce(!trackedOperationIdRef.current);
          return;
        }
        if (!trackedOperationIdRef.current) {
          setPhaseBoth('idle');
          return;
        }
        // Continue polling while unresolved (checking) or active.
        // Never reschedule once terminal - that's what stops the loop.
        if (phaseRef.current !== 'terminal') {
          timerRef.current = setTimeout(() => void runOnce(false), 2500);
        }
      }
    }

    wakeRef.current = (operationId, options) => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (!operationId) {
        trackedOperationIdRef.current = null;
        setTrackedOperation(null);
        setPhaseBoth('idle');
        if (options?.reconstruct) void runOnce(true);
        return;
      }
      trackedOperationIdRef.current = operationId;
      setPhaseBoth('checking');
      void runOnce(false);
    };

    // Initial mount: no explicit target yet, but attempt one
    // reconstruction check in case there's recent relevant work for
    // this requisition to resume showing.
    void runOnce(true);

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requisitionId]);

  useEffect(() => {
    wakeRef.current(currentLocalBatch?.operationId || null);
  }, [currentLocalBatch?.operationId]);

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
    if (!trackedOperation || retrying) return;
    setRetrying(true);
    try {
      const response = await fetch(`/api/operations/${trackedOperation.id}/retry`, { method: 'POST' });
      if (!response.ok) throw new Error('Unable to retry failed resumes.');
      wakeRef.current(trackedOperation.id);
    } catch {
      alert('Unable to retry failed resume evaluations. Try again.');
    } finally {
      setRetrying(false);
    }
  }

  // Browser-upload phase only (ResumeUploadManager's own ownership -
  // this controller never infers or overrides it). Anything after
  // this is covered by the checking/active/terminal views below.
  const localUploading = Boolean(currentLocalBatch && (currentLocalBatch.phase === 'creating' || currentLocalBatch.phase === 'uploading'));
  const localAccepted = currentLocalBatch?.items.filter((item) => item.status === 'accepted').length || 0;
  const localTotal = currentLocalBatch?.items.length || 0;
  // Comes from confirmed upload persistence only - independent of
  // evaluation polling entirely.
  const showUploadConfirmed = Boolean(currentLocalBatch && localTotal > 0 && localAccepted === localTotal);
  const visibleFailedItems = trackedOperation?.items.filter((item) => item.status === 'failed') || [];
  const completedItems = trackedOperation?.items.filter((item) => item.status === 'completed').length || 0;

  function dismissProgress() {
    if (!trackedOperation) return;
    dismissOperation(trackedOperation.id);
    if (currentLocalBatch?.operationId === trackedOperation.id) dismissBatch(currentLocalBatch.clientBatchKey);
    wakeRef.current(null);
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

      {showUploadConfirmed && phase !== 'active' && phase !== 'terminal' && (
        <p className="upload-confirmed-milestone">✓ {localAccepted} of {localTotal} {localTotal === 1 ? 'résumé' : 'résumés'} successfully uploaded</p>
      )}

      {phase === 'checking' && (
        <div className="upload-durable-boundary" aria-live="polite">
          <StapphireProcessing className="processing-compact" title="Checking résumé processing status…" detail={pollUnavailable ? 'Reconnecting…' : undefined}/>
        </div>
      )}

      {trackedOperation && (phase === 'active' || phase === 'terminal') && <div className="upload-operation-progress" aria-live="polite">
        {showUploadConfirmed && (
          <p className="upload-confirmed-milestone">✓ {localAccepted} of {localTotal} {localTotal === 1 ? 'résumé' : 'résumés'} successfully uploaded</p>
        )}
        {phase === 'active' && (
          <StapphireProcessing
            className="processing-compact"
            title="Evaluating résumés…"
            detail={`${completedItems} of ${trackedOperation.progressTotal || trackedOperation.items.length} complete`}
          />
        )}
        <div className="upload-complete">
          <span className="upload-summary">
            {phase === 'active'
              ? `${completedItems} of ${trackedOperation.progressTotal || trackedOperation.items.length} complete`
              : visibleFailedItems.length > 0
                ? `${completedItems} completed · ${visibleFailedItems.length} need attention`
                : `${completedItems} ${completedItems === 1 ? 'résumé' : 'résumés'} completed`}
          </span>
          {visibleFailedItems.some((item) => item.retryable) && <button type="button" className="upload-go-btn" onClick={retryFailed} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry failed'}</button>}
          {/* Done only appears once terminal - dismissing an actively
              processing operation would hide genuinely ongoing
              background progress. Dismissal belongs to terminal state. */}
          {phase === 'terminal' && <button type="button" className="upload-go-btn" onClick={dismissProgress}>Done</button>}
        </div>
        <ul className="upload-queue">{trackedOperation.items.map((item) => {
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
        <button type="button" className="upload-add-btn" onClick={() => inputRef.current?.click()} disabled={localUploading}>+ Add résumés</button>
        {staged.length > 0 && !localUploading && <button type="button" className="upload-go-btn" onClick={beginUpload}>Upload {staged.length}</button>}
      </div>
    </div>
  );
}
