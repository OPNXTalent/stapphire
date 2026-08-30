import 'server-only';
import type { EvaluationBasis } from './evaluationBasis';
import { evaluateCandidate } from './evaluator';
import { calculateMatch, calculateLegacyVerdict } from './evaluation';
import { CRITERIA_EVALUATION_PROMPT_SCHEMA_VERSION, evaluateCandidateAgainstCriteria } from './criteriaEvaluator';
import { projectCriterionFindings } from './criterionProjection';
import { CRITERION_SEMANTIC_FINGERPRINT_VERSION, fingerprintCriterionSemantics } from './criterionSemantics';

export async function evaluateResumeAgainstBasis(evaluationBasis: EvaluationBasis, resumeText: string) {
  const legacyAssessment = evaluationBasis.basisType === 'job_description'
    ? await evaluateCandidate(evaluationBasis.jobDescriptionSnapshot, resumeText)
    : null;
  if (legacyAssessment) {
    const scoreKeys = ['job_responsibilities_score', 'hard_skills_score', 'soft_skills_score', 'keyword_terminology_score'] as const;
    if (scoreKeys.some((key) => !Number.isInteger(legacyAssessment[key]) || legacyAssessment[key] < 0 || legacyAssessment[key] > 100)) {
      throw new Error('OpenAI returned an invalid category score.');
    }
  }

  const criteriaModelResult = evaluationBasis.basisType === 'hiring_criteria'
    ? await evaluateCandidateAgainstCriteria(evaluationBasis.jobDescriptionSnapshot, evaluationBasis.criteria, resumeText, evaluationBasis.id)
    : null;
  const criteriaModelAssessment = criteriaModelResult?.evaluation ?? null;
  const criteriaProjection = criteriaModelAssessment && evaluationBasis.basisType === 'hiring_criteria'
    ? projectCriterionFindings(evaluationBasis.criteria, criteriaModelAssessment.criterionFindings)
    : null;
  const criteriaById = evaluationBasis.basisType === 'hiring_criteria'
    ? new Map(evaluationBasis.criteria.map((criterion) => [criterion.id, criterion]))
    : null;
  if (criteriaProjection && !criteriaProjection.complete) throw new Error('Criteria evaluation output is incomplete.');
  const findingsById = criteriaModelAssessment ? new Map(criteriaModelAssessment.criterionFindings.map((finding) => [finding.criterionId, finding])) : null;
  const persistenceFindings = criteriaModelAssessment && criteriaById ? criteriaModelAssessment.criterionFindings.map((finding) => {
    const criterion = criteriaById.get(finding.criterionId);
    if (!criterion) throw new Error('Criteria evaluation returned an unknown criterion.');
    return {
      ...finding,
      criterionSemanticFingerprint: criterion.semanticFingerprint ?? fingerprintCriterionSemantics(criterion),
      semanticFingerprintVersion: CRITERION_SEMANTIC_FINGERPRINT_VERSION
    };
  }) : null;
  const appliedCriteria = evaluationBasis.basisType === 'hiring_criteria' ? evaluationBasis.criteria : [];
  const assessment = legacyAssessment ?? (criteriaModelAssessment && criteriaProjection && criteriaById && findingsById ? {
    ...criteriaModelAssessment,
    evaluation_format: 'criteria_v1',
    weighted_criteria: appliedCriteria.filter((criterion) => !criterion.isKnockout).map((criterion) => ({
      criterion_id: criterion.id,
      score: findingsById.get(criterion.id)!.alignmentScore!,
      evidence: findingsById.get(criterion.id)!.evidence,
      assessment: findingsById.get(criterion.id)!.assessment,
      label: criterion.label,
      category: criterion.category,
      applied_weight: criterion.appliedWeight
    })),
    knockout_criteria: appliedCriteria.filter((criterion) => criterion.isKnockout).map((criterion) => ({
      criterion_id: criterion.id,
      status: findingsById.get(criterion.id)!.satisfactionStatus!,
      evidence: findingsById.get(criterion.id)!.evidence,
      assessment: findingsById.get(criterion.id)!.assessment,
      label: criterion.label,
      category: criterion.category
    })),
    category_rollups: criteriaProjection.categoryScores,
    category_weights: criteriaProjection.categoryEffectiveWeights
  } : null);
  if (!assessment) throw new Error('Candidate evaluation did not produce an assessment.');

  const overallMatch = legacyAssessment ? calculateMatch(legacyAssessment) : criteriaProjection!.overallMatch!;
  return {
    candidateName: assessment.candidate_name?.trim() ?? '',
    assessment,
    rawModelResponse: criteriaModelAssessment ?? legacyAssessment,
    verdict: calculateLegacyVerdict(overallMatch),
    scores: {
      responsibilities: legacyAssessment?.job_responsibilities_score ?? criteriaProjection!.categoryScores.responsibilities,
      hardSkills: legacyAssessment?.hard_skills_score ?? criteriaProjection!.categoryScores.hard_skills,
      softSkills: legacyAssessment?.soft_skills_score ?? criteriaProjection!.categoryScores.soft_skills,
      keywords: legacyAssessment?.keyword_terminology_score ?? criteriaProjection!.categoryScores.keywords,
      match: overallMatch
    },
    neutralFindingsPersistence: evaluationBasis.basisType === 'hiring_criteria' && criteriaModelResult && persistenceFindings ? {
      hiringCriteriaVersionId: evaluationBasis.hiringCriteriaVersionId,
      modelIdentifier: criteriaModelResult.modelIdentifier,
      promptSchemaVersion: CRITERIA_EVALUATION_PROMPT_SCHEMA_VERSION,
      findings: persistenceFindings
    } : null
  };
}
