import 'server-only';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from './supabaseAdmin';
import { resolveEvaluationBasisById } from './evaluationBasis';
import { extractTextFromBuffer } from './extractText';
import { evaluateResumeAgainstBasis } from './candidateEvaluation';
import { normalizeHiringCriteriaError } from './hiringCriteriaError';
import { isRetryableHiringCriteriaError } from './operationTypes';
import { classifyNullClaim } from './resumeLeaseClassification';
import { operationQueue } from './operationQueue';
import { CONTACT_EXTRACTION_VERSION, extractCandidateContact } from './candidateContact';

const RESUME_BUCKET = 'candidate-resumes';
const MAX_ATTEMPTS = 3;
const LEASE_SECONDS = 360;
// Bounded-overoffer batch size for capacity reconciliation, matching
// the global concurrency cap of 3 - see the fuller rationale directly
// above reconcileQueuedResumeCapacity below, including why this is 3
// and not 1.
const RECONCILIATION_BATCH_SIZE = 3;

type ClaimedResumeItem = {
  id: string;
  operationId: string;
  requisitionId: string;
  attemptCount: number;
  inputRef: { originalFilename?: unknown; mimeType?: unknown; storagePath?: unknown; contentHash?: unknown; uploaded?: unknown };
  operationInput: { evaluationBasisId?: unknown };
};

export class RetryableResumeOperationError extends Error {}
export class DeferredResumeOperationError extends Error {}

async function claimItem(itemId: string, leaseToken: string): Promise<ClaimedResumeItem | null | 'deferred'> {
  const { data, error } = await supabaseAdmin.rpc('claim_phase1_resume_operation_item', {
    p_item_id: itemId,
    p_lease_token: leaseToken,
    p_lease_seconds: LEASE_SECONDS
  });
  if (error) throw error;
  if (!data) return null;
  if (typeof data === 'object' && data.deferred === true) return 'deferred';
  if (typeof data !== 'object' || typeof data.id !== 'string' || typeof data.operationId !== 'string'
    || typeof data.requisitionId !== 'string' || typeof data.attemptCount !== 'number') {
    throw new Error('Claimed resume operation item is invalid.');
  }
  return data as ClaimedResumeItem;
}

// Vercel's own message redelivery has proven, in production, to be an
// unbounded forward-progress mechanism for filling a freed concurrency
// slot - eligible items sitting idle for minutes after capacity opened
// up, well beyond the visibility timeout + retry delay this app
// configures (see production evidence: items eligible ~03:07:30, not
// claimed until ~03:12:34). This is a second, independent mechanism
// that directly republishes eligible queued work through the SAME
// existing queue topic the instant a slot frees up, rather than
// waiting on redelivery timing. Vercel's own redelivery remains a
// fallback, not the sole mechanism, alongside this.
//
// Bound of RECONCILIATION_BATCH_SIZE=3, matching the global
// concurrency cap - not 1. The original assumption behind a bound of 1
// was incorrect: concurrent completions are not guaranteed to select
// different queued items. Each reconciliation call performs an
// ordinary SELECT (no row lock, no reservation) before publishing, so
// when multiple completions happen at nearly the same moment, they can
// all see and republish the SAME single oldest eligible item, leaving
// other genuinely eligible items - and the capacity that just freed up
// for them - unaddressed.
//
// This deliberately does not try to guarantee one unique enqueue per
// freed slot - that would require a reservation mechanism (a new
// status, a claim-at-select-time lock, a new table), which is more
// machinery than this warrants. Instead: bounded overoffer. Every
// reconciliation call fetches the oldest up to 3 distinct eligible
// items (matching the concurrency cap) and republishes ALL of them,
// regardless of how many completions are happening concurrently.
// Redundant republishes for the same item are harmless -
// claim_phase1_resume_operation_item remains the sole, atomic
// authority over who actually processes it; a duplicate message for an
// item someone else already claimed simply defers or no-ops (see
// classifyNullClaim), exactly like any other duplicate delivery.
//
// Amplification bound: with a concurrency cap of 3, a wave of 3
// concurrent completions can each independently see the same up-to-3
// eligible items and each republish all of them - at most 3 calls x 3
// items = 9 reconciliation publishes total. Those 9 publishes target
// at most 3 distinct item IDs, which is exactly the number of newly
// available slots that wave of completions just freed. The queue does
// not grow unbounded with wave size, because each single call is
// capped at 3 regardless of how many completions are concurrently
// calling it - only the redundancy per item scales with concurrent
// completions, not the number of distinct items offered.
//
// claim_phase1_resume_operation_item remains the sole, atomic
// authority over who actually gets to process an item under its own
// row lock. No second evaluator path: reconciliation only ever
// enqueues onto the existing topic, processed by the existing worker.
//
// Failure here is caught and logged only, never re-thrown - this runs
// strictly after the triggering item's own completion has already been
// persisted successfully via complete_phase1_resume_operation_item,
// and must never retroactively turn that already-successful evaluation
// into a failure. Vercel's own redelivery remains a fallback, not the
// sole mechanism, alongside this.
async function reconcileQueuedResumeCapacity(): Promise<void> {
  try {
    const { data: activeOperations, error: operationsError } = await supabaseAdmin
      .from('phase1_operations')
      .select('id')
      .eq('operation_type', 'resume_batch_evaluation')
      .in('status', ['queued', 'processing']);
    if (operationsError) throw operationsError;
    const operationIds = (activeOperations || []).map((operation) => operation.id as string);
    if (operationIds.length === 0) return;

    const { data: eligibleItems, error: itemsError } = await supabaseAdmin
      .from('phase1_operation_items')
      .select('id')
      .in('operation_id', operationIds)
      .eq('status', 'queued')
      .lte('available_at', new Date().toISOString())
      .order('available_at', { ascending: true })
      .limit(RECONCILIATION_BATCH_SIZE);
    if (itemsError) throw itemsError;

    for (const eligibleItem of eligibleItems || []) {
      await operationQueue.enqueueResumeEvaluation({ operationItemId: eligibleItem.id as string });
      console.info('Resume evaluation capacity reconciliation republished item', { operationItemId: eligibleItem.id });
    }
  } catch (error) {
    console.error('Resume evaluation capacity reconciliation failed', { error: normalizeHiringCriteriaError(error) });
  }
}

export async function processResumeEvaluationOperationItem(itemId: string): Promise<void> {
  const leaseToken = randomUUID();
  const item = await claimItem(itemId, leaseToken);
  if (!item) {
    // claim_phase1_resume_operation_item returns a plain null both for
    // genuinely terminal/missing items (safe no-op) and for items
    // still 'processing' (another worker's DB lease, active or
    // recently expired). Disposition here is status-based ONLY -
    // classifyNullClaim never compares lease_expires_at against "now"
    // itself, since this lookup is a separate round trip after the
    // claim RPC call and the lease could expire in that gap. Any
    // 'processing' item defers unconditionally; the next delivery
    // re-enters the claim RPC, which remains the sole, atomic
    // authority for whether a lease is still active, has expired and
    // can be reclaimed, or the item has since reached a terminal
    // state. lease_expires_at is fetched only for potential
    // diagnostics, never to decide acknowledgement.
    const { data: currentItem, error: lookupError } = await supabaseAdmin
      .from('phase1_operation_items')
      .select('status, lease_expires_at')
      .eq('id', itemId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (classifyNullClaim(currentItem) === 'defer') {
      throw new DeferredResumeOperationError('Resume operation item is still under an active lease.');
    }
    return;
  }
  if (item === 'deferred') throw new DeferredResumeOperationError('Resume evaluation concurrency is currently full.');
  console.info('Resume evaluation item claimed', {
    operationId: item.operationId,
    operationItemId: item.id,
    requisitionId: item.requisitionId,
    attemptCount: item.attemptCount
  });

  try {
    const filename = item.inputRef.originalFilename;
    const mimeType = item.inputRef.mimeType;
    const storagePath = item.inputRef.storagePath;
    const basisId = item.operationInput.evaluationBasisId;
    if (typeof filename !== 'string' || typeof mimeType !== 'string' || typeof storagePath !== 'string'
      || typeof basisId !== 'string' || item.inputRef.uploaded !== true) {
      throw new Error('Resume operation input is invalid.');
    }

    const evaluationBasis = await resolveEvaluationBasisById(item.requisitionId, basisId);
    if (!evaluationBasis) throw new Error('Captured Evaluation Basis is unavailable.');
    const { data: storedFile, error: storageError } = await supabaseAdmin.storage.from(RESUME_BUCKET).download(storagePath);
    if (storageError || !storedFile) {
      const error = new RetryableResumeOperationError('Stored resume could not be read.');
      (error as RetryableResumeOperationError & { code?: string }).code = storageError?.name || 'STORAGE_READ_FAILED';
      throw error;
    }
    const sourceBuffer = Buffer.from(await storedFile.arrayBuffer());
    const resumeText = (await extractTextFromBuffer(sourceBuffer, filename, mimeType)).trim();
    if (resumeText.length < 80) throw new Error('The uploaded file did not contain enough readable resume text.');

    const result = await evaluateResumeAgainstBasis(evaluationBasis, resumeText);
    const candidateName = result.candidateName || filename.replace(/\.[^.]+$/, '');
    const completionRpc = result.neutralFindingsPersistence
      ? 'complete_phase1_hiring_criteria_resume_operation_item_v1'
      : 'complete_phase1_resume_operation_item';
    const completionArguments = {
      p_item_id: item.id,
      p_lease_token: leaseToken,
      p_full_name: candidateName,
      p_resume_text: resumeText,
      p_scores: result.scores,
      p_verdict: result.verdict,
      p_assessment: result.assessment,
      p_raw_model_response: result.rawModelResponse,
      ...(result.neutralFindingsPersistence ? {
        p_findings: result.neutralFindingsPersistence.findings,
        p_model_identifier: result.neutralFindingsPersistence.modelIdentifier,
        p_prompt_schema_version: result.neutralFindingsPersistence.promptSchemaVersion
      } : {})
    };
    const { data: completionData, error: completionError } = await supabaseAdmin.rpc(completionRpc, completionArguments);
    if (completionError) throw completionError;
    const completedCandidateId = completionData && typeof completionData === 'object' && typeof completionData.candidateId === 'string'
      ? completionData.candidateId
      : null;
    if (completedCandidateId) {
      const contact = extractCandidateContact(resumeText);
      const { error: contactError } = await supabaseAdmin
        .from('phase1_candidates')
        .update({
          primary_email: contact.primaryEmail,
          primary_phone_display: contact.primaryPhoneDisplay,
          primary_phone_e164: contact.primaryPhoneE164,
          linkedin_profile_url: contact.linkedinProfileUrl,
          contact_extraction_version: CONTACT_EXTRACTION_VERSION
        })
        .eq('id', completedCandidateId);
      if (contactError) console.error('Candidate contact persistence failed', { candidateId: completedCandidateId, error: contactError.message });
    }
    console.info('Resume evaluation item completed', { operationId: item.operationId, operationItemId: item.id, requisitionId: item.requisitionId });
    await reconcileQueuedResumeCapacity();
  } catch (error) {
    const retryable = error instanceof RetryableResumeOperationError || isRetryableHiringCriteriaError(error);
    const message = normalizeHiringCriteriaError(error);
    const delaySeconds = Math.min(120, 5 * (2 ** Math.max(0, item.attemptCount - 1)));
    const { data: nextStatus, error: persistenceError } = await supabaseAdmin.rpc('fail_or_retry_phase1_resume_operation_item', {
      p_item_id: item.id,
      p_lease_token: leaseToken,
      p_error: message,
      p_retryable: retryable,
      p_retry_delay_seconds: delaySeconds
    });
    if (persistenceError) throw persistenceError;
    console.error('Resume evaluation item failed', {
      operationId: item.operationId,
      operationItemId: item.id,
      attemptCount: item.attemptCount,
      retryable,
      terminal: nextStatus !== 'queued',
      error: message
    });
    if (nextStatus === 'queued') {
      if (item.attemptCount < MAX_ATTEMPTS) throw new RetryableResumeOperationError(message);
      return;
    }
    await reconcileQueuedResumeCapacity();
  }
}
