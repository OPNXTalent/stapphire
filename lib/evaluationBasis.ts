import 'server-only';
import { createHash } from 'crypto';
import { supabaseAdmin } from './supabaseAdmin';

export type JobDescriptionEvaluationBasis = {
  id: string;
  requisitionId: string;
  jobDescriptionSnapshot: string;
  jobDescriptionHash: string;
  jobDescriptionUpdatedAt: string;
};

export function normalizeJobDescriptionSource(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

export function hashJobDescription(value: string): string {
  return createHash('sha256').update(normalizeJobDescriptionSource(value), 'utf8').digest('hex');
}

export async function resolveCurrentJobDescriptionBasis(requisitionId: string): Promise<JobDescriptionEvaluationBasis | null> {
  const { data: requisition, error: requisitionError } = await supabaseAdmin
    .from('phase1_requisitions')
    .select('id,current_evaluation_basis_id')
    .eq('id', requisitionId)
    .is('archived_at', null)
    .maybeSingle();
  if (requisitionError) throw requisitionError;
  if (!requisition?.current_evaluation_basis_id) return null;

  const { data: basis, error: basisError } = await supabaseAdmin
    .from('phase1_evaluation_bases')
    .select('id,requisition_id,basis_type,job_description_snapshot,job_description_hash,job_description_updated_at')
    .eq('id', requisition.current_evaluation_basis_id)
    .eq('requisition_id', requisition.id)
    .eq('basis_type', 'job_description')
    .maybeSingle();
  if (basisError) throw basisError;
  if (!basis) return null;

  return {
    id: basis.id,
    requisitionId: basis.requisition_id,
    jobDescriptionSnapshot: basis.job_description_snapshot,
    jobDescriptionHash: basis.job_description_hash,
    jobDescriptionUpdatedAt: basis.job_description_updated_at
  };
}
