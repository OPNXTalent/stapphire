import { supabaseAdmin } from './supabaseAdmin';

export type WorkArrangement = 'onsite' | 'hybrid' | 'remote' | 'unknown';
export type CompensationUnit = 'hour' | 'day' | 'week' | 'month' | 'year' | 'unknown';
export type AnalysisStatus = 'pending' | 'completed' | 'insufficient_evidence' | 'failed';

export type InternalCompensation = {
  minimum: number | null;
  maximum: number | null;
  unit: CompensationUnit;
  currency: string | null;
};

export type InternalRequisitionEvidence = {
  evidenceClass: 'internal';
  roleTitle: string;
  location: string | null;
  workArrangement: WorkArrangement;
  compensation: InternalCompensation;
  seniorityIndicators: string[];
  requiredExperience: string[];
  preferredExperience: string[];
  educationRequirements: string[];
  certifications: string[];
  specializedTechnicalRequirements: string[];
  leadershipExpectations: string[];
  scheduleConstraints: string[];
  otherHiringConstraints: string[];
};

export type ObservedComparableRole = {
  evidenceClass: 'observed';
  id: string;
  analysisId: string;
  comparableTitle: string;
  employer: string;
  location: string | null;
  workArrangement: WorkArrangement;
  advertisedCompensationMinimum: number | null;
  advertisedCompensationMaximum: number | null;
  compensationUnit: CompensationUnit;
  currency: string | null;
  postingDate: string | null;
  sourceName: string;
  sourceUrl: string;
  retrievedAt: string;
  titleSimilarity: number | null;
  responsibilitySimilarity: number | null;
  comparableQuality: string | null;
  evidenceNotes: string | null;
};

export type ObservedMarketEvidenceSummary = {
  evidenceClass: 'observed';
  usableComparableCount: number;
  evidenceQualityDescriptor: string | null;
  geographicScope: string | null;
  observedCompensationMinimum: number | null;
  observedCompensationMaximum: number | null;
  observedCompensationMidpoint: number | null;
  marketEvidenceRetrievedAt: string | null;
};

export type CompensationAlignmentConclusion = {
  state: 'below_market' | 'competitive' | 'above_market' | 'insufficient_evidence';
  internalCompensationMidpoint: number | null;
  observedCompensationMidpoint: number | null;
  varianceToObservedMidpointPercent: number | null;
  explanation: string;
  supportingComparableIds: string[];
};

export type RequirementPayFitConclusion = {
  state: 'aligned' | 'some_tension' | 'misaligned' | 'insufficient_evidence';
  explanation: string;
  identifiedTensions: string[];
  supportingComparableIds: string[];
};

export type EstimatedTimeToFillConclusion = {
  state: 'estimated' | 'insufficient_evidence';
  minimumDays: number | null;
  maximumDays: number | null;
  rationale: string;
  supportingComparableIds: string[];
};

export type HiringDifficultyConclusion = {
  state: 'low' | 'moderate' | 'high' | 'very_high' | 'insufficient_evidence';
  rationale: string;
  supportingComparableIds: string[];
};

export type EstimatedRequisitionIntelligence = {
  evidenceClass: 'estimated';
  compensationAlignment: CompensationAlignmentConclusion;
  requirementPayFit: RequirementPayFitConclusion;
  estimatedTimeToFill: EstimatedTimeToFillConclusion;
  hiringDifficulty: HiringDifficultyConclusion;
};

export type RequisitionIntelligenceAnalysis = {
  id: string;
  requisitionId: string;
  status: AnalysisStatus;
  internalEvidence: InternalRequisitionEvidence | null;
  observedEvidence: ObservedMarketEvidenceSummary;
  estimatedIntelligence: EstimatedRequisitionIntelligence | null;
  analysisGeneratedAt: string | null;
  createdAt: string;
  failureReason: string | null;
  comparables: ObservedComparableRole[];
};

type AnalysisRow = {
  id: string;
  requisition_id: string;
  status: AnalysisStatus;
  internal_evidence: InternalRequisitionEvidence | null;
  observed_evidence_summary: ObservedMarketEvidenceSummary | null;
  estimated_intelligence: EstimatedRequisitionIntelligence | null;
  usable_comparable_count: number;
  evidence_quality_descriptor: string | null;
  geographic_scope: string | null;
  market_evidence_retrieved_at: string | null;
  analysis_generated_at: string | null;
  created_at: string;
  failure_reason: string | null;
};

type ComparableRow = {
  id: string;
  analysis_id: string;
  comparable_title: string;
  employer: string;
  location: string | null;
  work_arrangement: WorkArrangement;
  compensation_minimum: number | null;
  compensation_maximum: number | null;
  compensation_unit: CompensationUnit;
  currency: string | null;
  posting_date: string | null;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  title_similarity: number | null;
  responsibility_similarity: number | null;
  comparable_quality: string | null;
  evidence_notes: string | null;
};

export async function getLatestRequisitionIntelligence(requisitionId: string): Promise<RequisitionIntelligenceAnalysis | null> {
  const { data, error } = await supabaseAdmin
    .from('phase1_requisition_intelligence_analyses')
    .select('*')
    .eq('requisition_id', requisitionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as AnalysisRow;
  const { data: comparableData } = await supabaseAdmin
    .from('phase1_requisition_market_comparables')
    .select('*')
    .eq('analysis_id', row.id)
    .order('retrieved_at', { ascending: false });

  const comparables = ((comparableData || []) as ComparableRow[]).map((comparable) => ({
    evidenceClass: 'observed' as const,
    id: comparable.id,
    analysisId: comparable.analysis_id,
    comparableTitle: comparable.comparable_title,
    employer: comparable.employer,
    location: comparable.location,
    workArrangement: comparable.work_arrangement,
    advertisedCompensationMinimum: comparable.compensation_minimum,
    advertisedCompensationMaximum: comparable.compensation_maximum,
    compensationUnit: comparable.compensation_unit,
    currency: comparable.currency,
    postingDate: comparable.posting_date,
    sourceName: comparable.source_name,
    sourceUrl: comparable.source_url,
    retrievedAt: comparable.retrieved_at,
    titleSimilarity: comparable.title_similarity,
    responsibilitySimilarity: comparable.responsibility_similarity,
    comparableQuality: comparable.comparable_quality,
    evidenceNotes: comparable.evidence_notes
  }));

  return {
    id: row.id,
    requisitionId: row.requisition_id,
    status: row.status,
    internalEvidence: row.internal_evidence,
    observedEvidence: row.observed_evidence_summary || {
      evidenceClass: 'observed',
      usableComparableCount: row.usable_comparable_count,
      evidenceQualityDescriptor: row.evidence_quality_descriptor,
      geographicScope: row.geographic_scope,
      observedCompensationMinimum: null,
      observedCompensationMaximum: null,
      observedCompensationMidpoint: null,
      marketEvidenceRetrievedAt: row.market_evidence_retrieved_at
    },
    estimatedIntelligence: row.estimated_intelligence,
    analysisGeneratedAt: row.analysis_generated_at,
    createdAt: row.created_at,
    failureReason: row.failure_reason,
    comparables
  };
}
