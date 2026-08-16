export const OPERATION_STATUSES = ['queued', 'processing', 'completed', 'partially_completed', 'failed', 'cancelled'] as const;
export type OperationStatus = typeof OPERATION_STATUSES[number];

export type OperationSummary = {
  id: string;
  operationType: string;
  status: OperationStatus;
  stage: string | null;
  progressCurrent: number;
  progressTotal: number | null;
  resultSummary: Record<string, unknown>;
  errorSummary: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
};

export type HiringCriteriaOperationMessage = {
  operationId: string;
};

export type ResumeEvaluationOperationMessage = {
  operationItemId: string;
};

export type ResumeOperationItemSummary = {
  id: string;
  status: 'uploading' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  filename: string;
  errorSummary: string | null;
  candidateId: string | null;
  evaluationId: string | null;
  retryable: boolean;
};

export type ResumeOperationSummary = OperationSummary & {
  items: ResumeOperationItemSummary[];
};

export function isHiringCriteriaOperationMessage(value: unknown): value is HiringCriteriaOperationMessage {
  return typeof value === 'object' && value !== null
    && typeof (value as { operationId?: unknown }).operationId === 'string'
    && (value as { operationId: string }).operationId.length > 0;
}

export function isResumeEvaluationOperationMessage(value: unknown): value is ResumeEvaluationOperationMessage {
  return typeof value === 'object' && value !== null
    && typeof (value as { operationItemId?: unknown }).operationItemId === 'string'
    && (value as { operationItemId: string }).operationItemId.length > 0;
}

export function isActiveOperation(status: OperationStatus): boolean {
  return status === 'queued' || status === 'processing';
}

export function isTerminalOperation(status: OperationStatus): boolean {
  return !isActiveOperation(status);
}

export function isRetryableHiringCriteriaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; code?: unknown; name?: unknown };
  if (typeof candidate.status === 'number') {
    return candidate.status === 408 || candidate.status === 409 || candidate.status === 429 || candidate.status >= 500;
  }
  if (typeof candidate.code === 'string' && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(candidate.code)) return true;
  return candidate.name === 'APIConnectionError' || candidate.name === 'RateLimitError' || candidate.name === 'InternalServerError';
}
