import {
  CRITERIA_CATEGORIES,
  type AppliedCriterion,
  type CriteriaCategory,
  type CriterionScore,
  type KnockoutCriterionResult,
  type KnockoutStatus,
  type WeightedCriterionResult
} from './criteriaEvaluation.ts';

export type CriterionFinding = {
  criterionId: string;
  alignmentScore: CriterionScore | null;
  satisfactionStatus: KnockoutStatus | null;
  evidence: string;
  assessment: string;
};

export type CriterionContribution = {
  criterionId: string;
  category: CriteriaCategory;
  treatment: 'weighted' | 'knockout';
  weight: number;
  effectiveWeight: number;
  alignmentScore: CriterionScore | null;
  contribution: number | null;
};

export type KnockoutProjection = {
  criterionId: string;
  status: KnockoutStatus | null;
  outcome: 'pass' | 'definitive-failure' | 'review-required' | 'incomplete';
};

export type CriterionProjection = {
  coverage: {
    expectedCriterionIds: string[];
    foundCriterionIds: string[];
    missingCriterionIds: string[];
    duplicateCriterionIds: string[];
    unknownCriterionIds: string[];
  };
  missingRequiredCriterionIds: string[];
  criterionContributions: CriterionContribution[];
  categoryScores: Record<CriteriaCategory, number | null>;
  categoryEffectiveWeights: Record<CriteriaCategory, number>;
  overallMatch: number | null;
  knockoutResults: KnockoutProjection[];
  complete: boolean;
  audit: {
    positiveWeightedWeightTotal: number;
    unroundedOverallMatch: number | null;
    unroundedCategoryScores: Record<CriteriaCategory, number | null>;
    unroundedCategoryEffectiveWeights: Record<CriteriaCategory, number>;
  };
};

export function adaptLegacyCriterionResults(
  weighted: WeightedCriterionResult[] = [],
  knockouts: KnockoutCriterionResult[] = []
): CriterionFinding[] {
  return [
    ...weighted.map((result) => ({
      criterionId: result.criterion_id,
      alignmentScore: result.score,
      satisfactionStatus: null,
      evidence: result.evidence,
      assessment: result.assessment
    })),
    ...knockouts.map((result) => ({
      criterionId: result.criterion_id,
      alignmentScore: null,
      satisfactionStatus: result.status,
      evidence: result.evidence,
      assessment: result.assessment
    }))
  ];
}

function emptyCategoryRecord<T>(value: T): Record<CriteriaCategory, T> {
  return Object.fromEntries(CRITERIA_CATEGORIES.map((category) => [category, value])) as Record<CriteriaCategory, T>;
}

export function projectCriterionFindings(criteria: AppliedCriterion[], findings: CriterionFinding[]): CriterionProjection {
  const expectedIds = criteria.map((criterion) => criterion.id);
  const expectedIdSet = new Set(expectedIds);
  const findingsById = new Map<string, CriterionFinding>();
  const duplicateIds = new Set<string>();
  const unknownIds = new Set<string>();
  for (const finding of findings) {
    if (!expectedIdSet.has(finding.criterionId)) unknownIds.add(finding.criterionId);
    if (findingsById.has(finding.criterionId)) duplicateIds.add(finding.criterionId);
    else findingsById.set(finding.criterionId, finding);
  }

  const positiveWeightTotal = criteria.reduce((sum, criterion) => sum + (!criterion.isKnockout && criterion.appliedWeight > 0 ? criterion.appliedWeight : 0), 0);
  const categoryWeightTotals = emptyCategoryRecord(0);
  const categoryWeightedScoreTotals = emptyCategoryRecord(0);
  const missingRequiredCriterionIds: string[] = [];
  const criterionContributions: CriterionContribution[] = [];
  const knockoutResults: KnockoutProjection[] = [];
  let unroundedOverall = 0;

  for (const criterion of criteria) {
    const finding = findingsById.get(criterion.id);
    if (criterion.isKnockout) {
      const status = finding?.satisfactionStatus ?? null;
      if (status === null) missingRequiredCriterionIds.push(criterion.id);
      knockoutResults.push({
        criterionId: criterion.id,
        status,
        outcome: status === 'MET' ? 'pass' : status === 'NOT_MET' ? 'definitive-failure' : status === 'UNABLE_TO_DETERMINE' ? 'review-required' : 'incomplete'
      });
      criterionContributions.push({ criterionId: criterion.id, category: criterion.category, treatment: 'knockout', weight: 0, effectiveWeight: 0, alignmentScore: finding?.alignmentScore ?? null, contribution: null });
      continue;
    }

    const score = finding?.alignmentScore ?? null;
    if (score === null) missingRequiredCriterionIds.push(criterion.id);
    const effectiveWeight = positiveWeightTotal > 0 && criterion.appliedWeight > 0 ? criterion.appliedWeight / positiveWeightTotal : 0;
    const contribution = score === null ? null : score * effectiveWeight;
    if (criterion.appliedWeight > 0) {
      categoryWeightTotals[criterion.category] += criterion.appliedWeight;
      if (score !== null) categoryWeightedScoreTotals[criterion.category] += score * criterion.appliedWeight;
    }
    if (contribution !== null) unroundedOverall += contribution;
    criterionContributions.push({ criterionId: criterion.id, category: criterion.category, treatment: 'weighted', weight: criterion.appliedWeight, effectiveWeight, alignmentScore: score, contribution });
  }

  const missingIds = expectedIds.filter((id) => !findingsById.has(id));
  const complete = missingRequiredCriterionIds.length === 0 && duplicateIds.size === 0 && unknownIds.size === 0 && positiveWeightTotal > 0;
  const unroundedCategoryScores = Object.fromEntries(CRITERIA_CATEGORIES.map((category) => [
    category,
    categoryWeightTotals[category] > 0 ? categoryWeightedScoreTotals[category] / categoryWeightTotals[category] : null
  ])) as Record<CriteriaCategory, number | null>;
  const unroundedCategoryEffectiveWeights = Object.fromEntries(CRITERIA_CATEGORIES.map((category) => [
    category,
    positiveWeightTotal > 0 ? categoryWeightTotals[category] * 100 / positiveWeightTotal : 0
  ])) as Record<CriteriaCategory, number>;
  const categoryScores = Object.fromEntries(CRITERIA_CATEGORIES.map((category) => [
    category,
    complete && unroundedCategoryScores[category] !== null ? Math.round(unroundedCategoryScores[category]!) : null
  ])) as Record<CriteriaCategory, number | null>;
  const categoryEffectiveWeights = Object.fromEntries(CRITERIA_CATEGORIES.map((category) => [category, Math.round(unroundedCategoryEffectiveWeights[category])])) as Record<CriteriaCategory, number>;

  return {
    coverage: {
      expectedCriterionIds: expectedIds,
      foundCriterionIds: expectedIds.filter((id) => findingsById.has(id)),
      missingCriterionIds: missingIds,
      duplicateCriterionIds: [...duplicateIds],
      unknownCriterionIds: [...unknownIds]
    },
    missingRequiredCriterionIds,
    criterionContributions,
    categoryScores,
    categoryEffectiveWeights,
    overallMatch: complete ? Math.round(unroundedOverall) : null,
    knockoutResults,
    complete,
    audit: {
      positiveWeightedWeightTotal: positiveWeightTotal,
      unroundedOverallMatch: complete ? unroundedOverall : null,
      unroundedCategoryScores,
      unroundedCategoryEffectiveWeights
    }
  };
}
