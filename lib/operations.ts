import 'server-only';
import { supabaseAdmin } from './supabaseAdmin';
import { normalizeHiringCriteriaError } from './hiringCriteriaError';
import type { OperationStatus, OperationSummary } from './operationTypes';

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
