'use client';

import { useEffect, useRef, useState } from 'react';
import { StapphireProcessing } from '@/components/StapphireProcessing';
import { useResumeUploadManager } from '@/components/ResumeUploadManager';
import type { ResumeOperationSummary } from '@/lib/operationTypes';
import { isActiveOperation } from '@/lib/operationTypes';
import { getResumeSourceType, MAX_RESUME_BATCH_SIZE, MAX_RESUME_SIZE } from '@/lib/resumeFiles';
import { resolveTrackedOperationAuthority } from '@/lib/resumeUploadAuthority';
import { dispatchResumeOperationTerminal, resolveTerminalObservation } from '@/lib/resumeTerminalSync';

const POLL_INTERVAL_MS = 3000;

// The persisted durable operation is the source of truth, not the
// browser. Once files are confirmed uploaded, evaluation proceeds
// server-side via the existing queue/worker architecture regardless
// of whether this component, its polling loop, the current tab, or
// even the browser itself stays open. This controller exists only to
// mirror that server-side state into the UI while this view happens
// to be mounted - it does not own evaluation progress, and losing it
// (unmount, a failed poll, closing the tab) endangers nothing about
// the actual work.
//
// Deliberately simple: a single self-rescheduling loop, one in-flight
// guard, no immediate-poll trigger competing with it, no coalescing/
// generation machinery. If a new operation becomes known while the
// loop is between ticks, the loop's own next tick picks it up
// naturally - accepting up to one interval of visual delay rather
// than adding state machinery to avoid it. If a fetch is already
// running when the interval would otherwise fire, that tick is simply
// skipped and retried next interval - never a second concurrent
// request.
export function ResumeUpload({ requisitionId }: { requisitionId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const starting = useRef(false);
  const terminalNotificationOperationIdsRef = useRef<Set<string>>(new Set());
  const { batches, startUpload, dismissBatch, dismissedOperationIds, dismissOperation } = useResumeUploadManager();
  const [staged, setStaged] = useState<File[]>([]);
  const [retrying, setRetrying] = useState(false);
  const localBatches = batches.filter((batch) => batch.requisitionId === requisitionId);
  const currentLocalBatch = localBatches[localBatches.length - 1] || null;

  const [trackedOperation, setTrackedOperation] = useState<ResumeOperationSummary | null>(null);
  const [pollUnavailable, setPollUnavailable] = useState(false);

  // Mirrors currentLocalBatch?.operationId on every render - read by
  // the polling loop below without the loop needing to depend on it
  // (and therefore without tearing the loop down and restarting it
  // every time a batch changes phase).
  const targetOperationIdRef = useRef<string | null>(null);
  const localOperationId = currentLocalBatch?.operationId || null;
  const targetContextRef = useRef<{ requisitionId: string; localOperationId: string | null } | null>(null);
  const targetContext = targetContextRef.current;
  if (!targetContext || targetContext.requisitionId !== requisitionId || targetContext.localOperationId !== localOperationId) {
    targetOperationIdRef.current = localOperationId && terminalNotificationOperationIdsRef.current.has(localOperationId)
      ? null
      : localOperationId;
    targetContextRef.current = { requisitionId, localOperationId };
  }
  const dismissedOperationIdsRef = useRef(dismissedOperationIds);
  dismissedOperationIdsRef.current = dismissedOperationIds;
  const restartRef = useRef<() => void>(() => {});
  const pollSequenceRef = useRef(0);
  // Diagnostic mirror only. Polling authority and rendering decisions
  // continue to use their existing state/refs directly; no production
  // decision may depend on this snapshot.
  const diagnosticRenderRef = useRef({
    clientBatchKey: currentLocalBatch?.clientBatchKey || null,
    localOperationId,
    localPhase: currentLocalBatch?.phase || null,
    trackedOperationId: trackedOperation?.id || null
  });
  diagnosticRenderRef.current = {
    clientBatchKey: currentLocalBatch?.clientBatchKey || null,
    localOperationId,
    localPhase: currentLocalBatch?.phase || null,
    trackedOperationId: trackedOperation?.id || null
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let attemptedReconstruction = false;

    async function tick() {
      if (cancelled) return;
      if (timer) { clearTimeout(timer); timer = null; }
      const targetId = targetOperationIdRef.current;
      if (!targetId && attemptedReconstruction) return; // nothing to track, already tried reconstruction once
      if (inFlight) {
        // Already fetching - skip this trigger, the next interval
        // tick will simply try again with whatever is current then.
        timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
        return;
      }
      inFlight = true;
      try {
        const pollSequence = ++pollSequenceRef.current;
        const diagnostic = diagnosticRenderRef.current;
        const response = await fetch(`/api/requisitions/${requisitionId}/operations`, {
          cache: 'no-store',
          headers: {
            'x-stapphire-poll-sequence': String(pollSequence),
            'x-stapphire-client-batch-key': diagnostic.clientBatchKey || '',
            'x-stapphire-local-operation-id': diagnostic.localOperationId || '',
            'x-stapphire-local-phase': diagnostic.localPhase || '',
            'x-stapphire-target-operation-id': targetOperationIdRef.current || '',
            'x-stapphire-target-context-operation-id': targetContextRef.current?.localOperationId || '',
            'x-stapphire-tracked-operation-id': diagnostic.trackedOperationId || '',
            'x-stapphire-attempted-reconstruction': String(attemptedReconstruction)
          }
        });
        if (!response.ok) throw new Error('Unable to read resume operations.');
        const result = await response.json() as { resumeOperations?: ResumeOperationSummary[] };
        if (cancelled) return;
        const list = Array.isArray(result.resumeOperations) ? result.resumeOperations : [];

        let found: ResumeOperationSummary | null = null;
        if (targetId) {
          found = list.find((operation) => operation.id === targetId) || null;
        } else if (!attemptedReconstruction) {
          // No current local batch (e.g. navigated here fresh) -
          // recover the latest durable operation directly from
          // persisted state, once, rather than polling indefinitely
          // for something that may never appear.
          attemptedReconstruction = true;
          const newest = list[0] || null;
          if (newest && !dismissedOperationIdsRef.current.has(newest.id)) {
            targetOperationIdRef.current = newest.id;
            found = newest;
          }
        }

        setPollUnavailable(false);
        if (found) {
          setTrackedOperation(found);
          const observation = resolveTerminalObservation(
            found.status,
            terminalNotificationOperationIdsRef.current.has(found.id)
          );
          if (!observation.active) {
            // Terminal durable state owns the UI immediately. Clear the
            // polling target before React renders the terminal result so
            // no later trigger can restart polling for this operation.
            targetOperationIdRef.current = null;
            if (observation.notifyTerminal) {
              terminalNotificationOperationIdsRef.current.add(found.id);
              dispatchResumeOperationTerminal(window, { requisitionId, operationId: found.id });
            }
          }
        }

        const stillUnresolved = targetOperationIdRef.current && (!found || isActiveOperation(found.status));
        if (!cancelled && stillUnresolved) timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
      } catch {
        if (cancelled) return;
        // Preserve last-known trackedOperation through a transient
        // failure - never clear it. Keep polling for a known target;
        // a temporary read failure must not endanger tracking work
        // that is, itself, in no danger at all.
        setPollUnavailable(true);
        if (targetOperationIdRef.current) timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
      } finally {
        inFlight = false;
      }
    }

    restartRef.current = () => void tick();
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requisitionId]);

  useEffect(() => {
    const operationId = currentLocalBatch?.operationId;
    if (!operationId || terminalNotificationOperationIdsRef.current.has(operationId)) return;
    targetOperationIdRef.current = operationId;
    restartRef.current();
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
      terminalNotificationOperationIdsRef.current.delete(trackedOperation.id);
      targetOperationIdRef.current = trackedOperation.id;
      restartRef.current();
    } catch {
      alert('Unable to retry failed resume evaluations. Try again.');
    } finally {
      setRetrying(false);
    }
  }

  // Durable state may only supersede or confirm the CURRENT local
  // batch's state when it is PROVEN to represent that exact batch -
  // the batch already has an operationId, and trackedOperation is
  // confirmed to be tracking that same operation. Before a batch has
  // an operationId, there is no durable operation that can be proven
  // to represent it yet, so local creating/uploading state remains
  // authoritative regardless of anything trackedOperation currently
  // holds - which could be a retained, unrelated OLDER operation (e.g.
  // a prior batch's now-terminal operation), and must never suppress
  // or provide confirmation counts for a brand new, unrelated batch.
  const trackedOperationAuthority = resolveTrackedOperationAuthority(currentLocalBatch, trackedOperation);
  const trackedOperationMatchesCurrentBatch = trackedOperationAuthority.matchesCurrentBatch;
  const trackedOperationAuthoritative = trackedOperationAuthority.authoritative;

  const durableUploadedCount = trackedOperationAuthoritative && trackedOperation ? trackedOperation.items.filter((item) => item.uploaded).length : 0;
  const durableItemTotal = trackedOperationAuthoritative && trackedOperation ? trackedOperation.items.length : 0;
  const allItemsDurablyUploaded = Boolean(trackedOperationAuthoritative && trackedOperation && durableItemTotal > 0 && durableUploadedCount === durableItemTotal);
  const trackedOperationTerminal = Boolean(trackedOperationAuthoritative && trackedOperation && !isActiveOperation(trackedOperation.status));

  // Browser-upload phase only (ResumeUploadManager's own ownership -
  // this controller never infers that state itself), but forcibly
  // suppressed once durable state PROVEN to belong to this exact batch
  // says uploading is already done or the operation is already
  // terminal - server truth wins, unconditionally, over a possibly-
  // stale local phase, but only once that identity is established.
  const localUploading = Boolean(
    currentLocalBatch &&
    (currentLocalBatch.phase === 'creating' || currentLocalBatch.phase === 'uploading') &&
    !allItemsDurablyUploaded &&
    !trackedOperationTerminal
  );
  const localAccepted = currentLocalBatch?.items.filter((item) => item.status === 'accepted').length || 0;
  const localTotal = currentLocalBatch?.items.length || 0;
  // Prefer durable, server-confirmed counts whenever trackedOperation
  // is authoritative - more authoritative than local, possibly-
  // unresolved browser state. Falls back to local counts whenever a
  // local batch exists but trackedOperation doesn't (yet, or ever)
  // match it.
  const uploadConfirmedCount = trackedOperationAuthoritative && trackedOperation ? durableUploadedCount : localAccepted;
  const uploadConfirmedTotal = trackedOperationAuthoritative && trackedOperation ? durableItemTotal : localTotal;
  // Confirmed either by durable per-item uploaded state for the
  // authoritative operation (supersedes local entirely, regardless of
  // unresolved browser upload promises) or, absent that, by local
  // accepted count for a batch trackedOperation doesn't yet match.
  const showUploadConfirmed = Boolean(
    allItemsDurablyUploaded || (!(trackedOperationAuthoritative && trackedOperation) && currentLocalBatch && localTotal > 0 && localAccepted === localTotal)
  );
  const trackedOperationActive = Boolean(trackedOperation && isActiveOperation(trackedOperation.status));
  // A target is known but we have not yet confirmed its state in any
  // fetch response - show "checking", never blank.
  const showCheckingStatus = Boolean(
    targetOperationIdRef.current &&
    (!trackedOperation || trackedOperation.id !== targetOperationIdRef.current)
  );
  // The full operation-progress view (per-item list, Done, Retry) may
  // only show trackedOperation's data when it's authoritative right
  // now - otherwise a retained, unrelated older operation (e.g. a
  // just-completed prior batch) could keep rendering its own stale
  // progress/Done button while a brand new, non-matching batch is
  // uploading.
  const showTrackedOperationView = Boolean(
    trackedOperation && !showCheckingStatus && trackedOperationAuthoritative
  );
  const visibleFailedItems = trackedOperation?.items.filter((item) => item.status === 'failed') || [];
  const completedItems = trackedOperation?.items.filter((item) => item.status === 'completed').length || 0;

  function dismissProgress() {
    if (!trackedOperation) return;
    dismissOperation(trackedOperation.id);
    if (currentLocalBatch?.operationId === trackedOperation.id) dismissBatch(currentLocalBatch.clientBatchKey);
    targetOperationIdRef.current = null;
    setTrackedOperation(null);
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
          <small>Keep this browser open until upload completes.</small>
        </div>
      ) : null}

      {showUploadConfirmed && !trackedOperation && (
        <div className="upload-confirmed-milestone">
          <p>✓ {uploadConfirmedCount} of {uploadConfirmedTotal} {uploadConfirmedTotal === 1 ? 'résumé' : 'résumés'} successfully uploaded</p>
          <small>Evaluation continues in the background. You can navigate anywhere in Stapphire - come back anytime to see progress.</small>
        </div>
      )}

      {showCheckingStatus && (
        <div className="upload-durable-boundary" aria-live="polite">
          <StapphireProcessing className="processing-compact" title="Checking résumé processing status…" detail={pollUnavailable ? 'Reconnecting…' : undefined}/>
        </div>
      )}

      {showTrackedOperationView && trackedOperation && <div className="upload-operation-progress" aria-live="polite">
        {showUploadConfirmed && (
          <div className="upload-confirmed-milestone">
            <p>✓ {uploadConfirmedCount} of {uploadConfirmedTotal} {uploadConfirmedTotal === 1 ? 'résumé' : 'résumés'} successfully uploaded</p>
            {trackedOperationActive && <small>Evaluation continues in the background.</small>}
          </div>
        )}
        {trackedOperationActive && (
          <StapphireProcessing
            className="processing-compact"
            title="Evaluating résumés…"
            detail={`${completedItems} of ${trackedOperation.progressTotal || trackedOperation.items.length} complete`}
          />
        )}
        <div className="upload-complete">
          <span className="upload-summary">
            {trackedOperationActive
              ? `${completedItems} of ${trackedOperation.progressTotal || trackedOperation.items.length} complete`
              : visibleFailedItems.length > 0
                ? `${completedItems} completed · ${visibleFailedItems.length} need attention`
                : `${completedItems} ${completedItems === 1 ? 'résumé' : 'résumés'} completed`}
          </span>
          {/* Done only appears once terminal - dismissing an actively
              processing operation would hide genuinely ongoing
              background progress. Dismissal belongs to terminal state. */}
          {!trackedOperationActive && <button type="button" className="upload-go-btn" onClick={dismissProgress}>Done</button>}
          {visibleFailedItems.some((item) => item.retryable) && <button type="button" className="upload-retry-action" onClick={retryFailed} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry'}</button>}
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
