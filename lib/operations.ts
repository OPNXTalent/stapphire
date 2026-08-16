import 'server-only';
import { supabaseAdmin } from './supabaseAdmin';
import { normalizeHiringCriteriaError } from './hiringCriteriaError';
import type { OperationStatus, OperationSummary, ResumeOperationSummary } from './operationTypes';

type OperationRow = {
  id: string;
  operation_type: string;
  status: OperationStatus;
  stage: string | null;
  progress_current: number;
  progress_total: number | null;
  result_summary: Record<string, unknown> | null;
  error_summary: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
};

function toSummary(row: OperationRow): OperationSummary {
  return {
    id: row.id,
    operationType: row.operation_type,
    status: row.status,
    stage: row.stage,
    progressCurrent: row.progress_current,
    progressTotal: row.progress_total,
    resultSummary: row.result_summary && typeof row.result_summary === 'object' ? row.result_summary : {},
    errorSummary: row.error_summary,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at
  };
}

export async function getLatestHiringCriteriaOperation(requisitionId: string): Promise<OperationSummary | null> {
  const { data, error } = await supabaseAdmin
    .from('phase1_operations')
    .select('id,operation_type,status,stage,progress_current,progress_total,result_summary,error_summary,created_at,started_at,completed_at,failed_at')
    .eq('requisition_id', requisitionId)
    .eq('operation_type', 'hiring_criteria_generation')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toSummary(data as OperationRow) : null;
}

export async function getResumeOperations(requisitionId: string): Promise<ResumeOperationSummary[]> {
  const { data: operations, error } = await supabaseAdmin
    .from('phase1_operations')
    .select('id,operation_type,status,stage,progress_current,progress_total,result_summary,error_summary,created_at,started_at,completed_at,failed_at')
    .eq('requisition_id', requisitionId)
    .eq('operation_type', 'resume_batch_evaluation')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  if (!operations?.length) return [];
  const operationIds = operations.map((operation) => operation.id);
  const { data: items, error: itemError } = await supabaseAdmin
    .from('phase1_operation_items')
    .select('id,operation_id,status,input_ref,candidate_id,evaluation_id,error_summary,created_at')
    .in('operation_id', operationIds)
    .order('created_at', { ascending: true });
  if (itemError) throw itemError;
  return operations.map((operation) => ({
    ...toSummary(operation as OperationRow),
    items: (items || []).filter((item) => item.operation_id === operation.id).map((item) => ({
      id: item.id,
      status: item.status,
      filename: typeof item.input_ref?.originalFilename === 'string' ? item.input_ref.originalFilename : 'Resume',
      errorSummary: item.error_summary,
      candidateId: item.candidate_id,
      evaluationId: item.evaluation_id,
      retryable: item.input_ref?.uploaded === true && typeof item.input_ref?.contentHash === 'string'
    }))
  })) as ResumeOperationSummary[];
}

export async function markHiringCriteriaDispatchFailed(operationId: string, error: unknown): Promise<void> {
  const { error: persistenceError } = await supabaseAdmin.rpc('fail_phase1_hiring_criteria_operation_dispatch', {
    p_operation_id: operationId,
    p_error: normalizeHiringCriteriaError(error)
  });
  if (persistenceError) {
    console.error('Hiring Criteria dispatch failure could not be persisted', {
      operationId,
      error: normalizeHiringCriteriaError(persistenceError)
    });
  }
}
