import 'server-only';
import type { EvaluationBasis } from './evaluationBasis';
import { evaluateCandidate } from './evaluator';
import { calculateMatch, calculateLegacyVerdict } from './evaluation';
import { evaluateCandidateAgainstCriteria } from './criteriaEvaluator';
import { calculateCriteriaScores } from './criteriaEvaluation';

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

  const criteriaModelAssessment = evaluationBasis.basisType === 'hiring_criteria'
    ? await evaluateCandidateAgainstCriteria(evaluationBasis.jobDescriptionSnapshot, evaluationBasis.criteria, resumeText, evaluationBasis.id)
    : null;
  const criteriaScores = criteriaModelAssessment && evaluationBasis.basisType === 'hiring_criteria'
    ? calculateCriteriaScores(evaluationBasis.criteria, criteriaModelAssessment.weighted_criteria)
    : null;
  const criteriaById = evaluationBasis.basisType === 'hiring_criteria'
    ? new Map(evaluationBasis.criteria.map((criterion) => [criterion.id, criterion]))
    : null;
  const assessment = legacyAssessment ?? (criteriaModelAssessment && criteriaScores && criteriaById ? {
    ...criteriaModelAssessment,
    evaluation_format: 'criteria_v1',
    weighted_criteria: criteriaModelAssessment.weighted_criteria.map((result) => ({
      ...result,
      label: criteriaById.get(result.criterion_id)!.label,
      category: criteriaById.get(result.criterion_id)!.category,
      applied_weight: criteriaById.get(result.criterion_id)!.appliedWeight
    })),
    knockout_criteria: criteriaModelAssessment.knockout_criteria.map((result) => ({
      ...result,
      label: criteriaById.get(result.criterion_id)!.label,
      category: criteriaById.get(result.criterion_id)!.category
    })),
    category_rollups: criteriaScores.categoryRollups,
    category_weights: criteriaScores.categoryWeights
  } : null);
  if (!assessment) throw new Error('Candidate evaluation did not produce an assessment.');

  const overallMatch = legacyAssessment ? calculateMatch(legacyAssessment) : criteriaScores!.match;
  return {
    candidateName: assessment.candidate_name?.trim() ?? '',
    assessment,
    rawModelResponse: criteriaModelAssessment ?? legacyAssessment,
    verdict: calculateLegacyVerdict(overallMatch),
    scores: {
      responsibilities: legacyAssessment?.job_responsibilities_score ?? criteriaScores!.categoryRollups.responsibilities,
      hardSkills: legacyAssessment?.hard_skills_score ?? criteriaScores!.categoryRollups.hard_skills,
      softSkills: legacyAssessment?.soft_skills_score ?? criteriaScores!.categoryRollups.soft_skills,
      keywords: legacyAssessment?.keyword_terminology_score ?? criteriaScores!.categoryRollups.keywords,
      match: overallMatch
    }
  };
}
