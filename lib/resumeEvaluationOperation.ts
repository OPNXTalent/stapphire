import 'server-only';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from './supabaseAdmin';
import { resolveEvaluationBasisById } from './evaluationBasis';
import { extractTextFromBuffer } from './extractText';
import { evaluateResumeAgainstBasis } from './candidateEvaluation';
import { normalizeHiringCriteriaError } from './hiringCriteriaError';
import { isRetryableHiringCriteriaError } from './operationTypes';

const RESUME_BUCKET = 'candidate-resumes';
const MAX_ATTEMPTS = 3;
const LEASE_SECONDS = 360;

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

export async function processResumeEvaluationOperationItem(itemId: string): Promise<void> {
  const leaseToken = randomUUID();
  const item = await claimItem(itemId, leaseToken);
  if (!item) return;
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
    const { error: completionError } = await supabaseAdmin.rpc('complete_phase1_resume_operation_item', {
      p_item_id: item.id,
      p_lease_token: leaseToken,
      p_full_name: candidateName,
      p_resume_text: resumeText,
      p_scores: result.scores,
      p_verdict: result.verdict,
      p_assessment: result.assessment,
      p_raw_model_response: result.rawModelResponse
    });
    if (completionError) throw completionError;
    console.info('Resume evaluation item completed', { operationId: item.operationId, operationItemId: item.id, requisitionId: item.requisitionId });
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
    if (nextStatus === 'queued' && item.attemptCount < MAX_ATTEMPTS) throw new RetryableResumeOperationError(message);
  }
}
