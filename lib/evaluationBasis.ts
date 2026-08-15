import 'server-only';
import { createHash } from 'crypto';
import { supabaseAdmin } from './supabaseAdmin';
import { validateAppliedCriteriaSnapshot, type AppliedCriterion } from './criteriaEvaluation';

export type JobDescriptionEvaluationBasis = {
  id: string;
  requisitionId: string;
  jobDescriptionSnapshot: string;
  jobDescriptionHash: string;
  jobDescriptionUpdatedAt: string;
  basisType: 'job_description';
};

export type HiringCriteriaEvaluationBasis = Omit<JobDescriptionEvaluationBasis, 'basisType'> & {
  basisType: 'hiring_criteria';
  hiringCriteriaVersionId: string;
  criteria: AppliedCriterion[];
};

export type EvaluationBasis = JobDescriptionEvaluationBasis | HiringCriteriaEvaluationBasis;

export function normalizeJobDescriptionSource(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

export function hashJobDescription(value: string): string {
  return createHash('sha256').update(normalizeJobDescriptionSource(value), 'utf8').digest('hex');
}

export async function resolveCurrentEvaluationBasis(requisitionId: string): Promise<EvaluationBasis | null> {
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
    .select('id,requisition_id,basis_type,job_description_snapshot,job_description_hash,job_description_updated_at,hiring_criteria_version_id')
    .eq('id', requisition.current_evaluation_basis_id)
    .eq('requisition_id', requisition.id)
    .maybeSingle();
  if (basisError) throw basisError;
  if (!basis) return null;

  const common = {
    id: basis.id,
    requisitionId: basis.requisition_id,
    jobDescriptionSnapshot: basis.job_description_snapshot,
    jobDescriptionHash: basis.job_description_hash,
    jobDescriptionUpdatedAt: basis.job_description_updated_at
  };
  if (basis.basis_type === 'job_description') return { ...common, basisType: 'job_description' };
  if (basis.basis_type !== 'hiring_criteria' || !basis.hiring_criteria_version_id) throw new Error('Current Evaluation Basis is malformed.');
  const { data: version, error: versionError } = await supabaseAdmin
    .from('phase1_hiring_criteria_versions')
    .select('id,requisition_id,criteria_snapshot,total_weight')
    .eq('id', basis.hiring_criteria_version_id)
    .eq('requisition_id', requisition.id)
    .single();
  if (versionError) throw versionError;
  if (!version || version.total_weight !== 100) throw new Error('Applied Hiring Criteria version is unavailable or invalid.');
  return {
    ...common,
    basisType: 'hiring_criteria',
    hiringCriteriaVersionId: version.id,
    criteria: validateAppliedCriteriaSnapshot(version.criteria_snapshot)
  };
}

export async function resolveCurrentJobDescriptionBasis(requisitionId: string): Promise<JobDescriptionEvaluationBasis | null> {
  const basis = await resolveCurrentEvaluationBasis(requisitionId);
  return basis?.basisType === 'job_description' ? basis : null;
}
