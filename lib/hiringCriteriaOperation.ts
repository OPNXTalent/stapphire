import 'server-only';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from './supabaseAdmin';
import { extractPreparedHiringCriteria, HIRING_CRITERIA_EXTRACTOR_VERSION } from './hiringCriteriaExtractor';
import { normalizeHiringCriteriaError } from './hiringCriteriaError';
import { isRetryableHiringCriteriaError } from './operationTypes';

const MAX_ATTEMPTS = 3;
const LEASE_SECONDS = 360;

type ClaimedOperation = {
  id: string;
  requisitionId: string;
  attemptCount: number;
  inputSnapshot: {
    evaluationBasisId?: unknown;
    jobDescriptionHash?: unknown;
    extractorVersion?: unknown;
  };
};

export class RetryableOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableOperationError';
  }
}

async function claimOperation(operationId: string, leaseToken: string): Promise<ClaimedOperation | null> {
  const { data, error } = await supabaseAdmin.rpc('claim_phase1_operation', {
    p_operation_id: operationId,
    p_lease_token: leaseToken,
    p_lease_seconds: LEASE_SECONDS
  });
  if (error) throw error;
  if (!data) return null;
  if (typeof data !== 'object' || typeof data.id !== 'string' || typeof data.requisitionId !== 'string' || typeof data.attemptCount !== 'number') {
    throw new Error('Claimed operation payload is invalid.');
  }
  return data as ClaimedOperation;
}

async function loadImmutableJobDescription(operation: ClaimedOperation): Promise<string> {
  const basisId = operation.inputSnapshot?.evaluationBasisId;
  const expectedHash = operation.inputSnapshot?.jobDescriptionHash;
  const extractorVersion = operation.inputSnapshot?.extractorVersion;
  if (typeof basisId !== 'string' || typeof expectedHash !== 'string' || extractorVersion !== HIRING_CRITERIA_EXTRACTOR_VERSION) {
    throw new Error('Hiring Criteria operation input is invalid.');
  }
  const { data, error } = await supabaseAdmin
    .from('phase1_evaluation_bases')
    .select('id,requisition_id,basis_type,job_description_snapshot,job_description_hash')
    .eq('id', basisId)
    .eq('requisition_id', operation.requisitionId)
    .eq('basis_type', 'job_description')
    .maybeSingle();
  if (error) throw error;
  if (!data || data.job_description_hash !== expectedHash) throw new Error('Captured Job Description Evaluation Basis is unavailable or changed.');
  return data.job_description_snapshot;
}

export async function processHiringCriteriaOperation(operationId: string): Promise<void> {
  const leaseToken = randomUUID();
  const operation = await claimOperation(operationId, leaseToken);
  if (!operation) return;

  try {
    const jobDescription = await loadImmutableJobDescription(operation);
    const prepared = await extractPreparedHiringCriteria(jobDescription);
    const { error } = await supabaseAdmin.rpc('complete_phase1_hiring_criteria_operation', {
      p_operation_id: operation.id,
      p_lease_token: leaseToken,
      p_items: prepared.items,
      p_unmapped_qualifications: prepared.unmappedQualifications
    });
    if (error) throw error;
    console.info('Hiring Criteria operation completed', { operationId: operation.id, requisitionId: operation.requisitionId, itemCount: prepared.items.length });
  } catch (error) {
    const retryable = isRetryableHiringCriteriaError(error);
    const message = normalizeHiringCriteriaError(error);
    const delaySeconds = Math.min(120, 5 * (2 ** Math.max(0, operation.attemptCount - 1)));
    const { data: nextStatus, error: persistenceError } = await supabaseAdmin.rpc('fail_or_retry_phase1_hiring_criteria_operation', {
      p_operation_id: operation.id,
      p_lease_token: leaseToken,
      p_error: message,
      p_retryable: retryable,
      p_retry_delay_seconds: delaySeconds
    });
    if (persistenceError) throw persistenceError;
    console.error('Hiring Criteria operation attempt failed', {
      operationId: operation.id,
      requisitionId: operation.requisitionId,
      attemptCount: operation.attemptCount,
      retryable,
      terminal: nextStatus !== 'queued',
      error: message
    });
    if (nextStatus === 'queued' && operation.attemptCount < MAX_ATTEMPTS) throw new RetryableOperationError(message);
  }
}
