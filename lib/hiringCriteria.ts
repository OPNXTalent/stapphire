import { supabaseAdmin } from './supabaseAdmin';

export const HIRING_CRITERIA_CATEGORIES = ['responsibilities', 'hard_skills', 'soft_skills', 'keywords', 'other_requirements'] as const;
export type HiringCriteriaCategory = typeof HIRING_CRITERIA_CATEGORIES[number];
export type CriteriaExtractionStatus = 'pending' | 'ready' | 'unavailable' | 'failed';
export type UnmappedQualification = { label: string; jdEvidence: string; reason: string };

export type HiringCriterion = {
  id: string;
  category: HiringCriteriaCategory;
  label: string;
  rationale: string | null;
  jdEvidence: string | null;
  defaultWeight: number;
  draftWeight: number;
  isKnockout: boolean;
  knockoutSuggested: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HiringCriteriaModel = {
  id: string;
  requisitionId: string;
  extractionStatus: CriteriaExtractionStatus;
  extractionError: string | null;
  generatedAt: string | null;
  unmappedQualifications: UnmappedQualification[];
  latestAppliedVersionId: string | null;
  criteria: HiringCriterion[];
};

type ModelRow = {
  id: string;
  requisition_id: string;
  extraction_status: CriteriaExtractionStatus;
  extraction_error: string | null;
  generated_at: string | null;
  unmapped_qualifications: UnmappedQualification[] | null;
};

type CriterionRow = {
  id: string;
  category: HiringCriteriaCategory;
  label: string;
  rationale: string | null;
  jd_evidence: string | null;
  default_weight: number;
  draft_weight: number;
  is_knockout: boolean | null;
  knockout_suggested: boolean | null;
  created_at: string;
  updated_at: string;
};

export async function getHiringCriteriaModel(requisitionId: string): Promise<HiringCriteriaModel | null> {
  const { data, error } = await supabaseAdmin
    .from('phase1_hiring_criteria_models')
    .select('*')
    .eq('requisition_id', requisitionId)
    .maybeSingle();
  if (error || !data) return null;
  const model = data as ModelRow;

  const [{ data: criterionData }, { data: versionData }] = await Promise.all([
    supabaseAdmin.from('phase1_hiring_criteria_items').select('*').eq('model_id', model.id).order('created_at'),
    supabaseAdmin.from('phase1_hiring_criteria_versions').select('id').eq('requisition_id', requisitionId).order('version_number', { ascending: false }).limit(1).maybeSingle()
  ]);

  const criteria = ((criterionData || []) as CriterionRow[]).map((criterion) => ({
    id: criterion.id,
    category: criterion.category,
    label: criterion.label,
    rationale: criterion.rationale,
    jdEvidence: criterion.jd_evidence,
    defaultWeight: criterion.default_weight,
    draftWeight: criterion.draft_weight,
    isKnockout: criterion.is_knockout === true,
    knockoutSuggested: criterion.knockout_suggested === true,
    createdAt: criterion.created_at,
    updatedAt: criterion.updated_at
  }));

  return {
    id: model.id,
    requisitionId: model.requisition_id,
    extractionStatus: model.extraction_status,
    extractionError: model.extraction_error,
    generatedAt: model.generated_at,
    unmappedQualifications: Array.isArray(model.unmapped_qualifications) ? model.unmapped_qualifications : [],
    latestAppliedVersionId: versionData?.id || null,
    criteria
  };
}
