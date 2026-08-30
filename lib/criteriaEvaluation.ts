export const CRITERIA_CATEGORIES = ['responsibilities', 'hard_skills', 'soft_skills', 'keywords', 'other_requirements'] as const;
export type CriteriaCategory = typeof CRITERIA_CATEGORIES[number];
export const CRITERION_SCORES = [0, 25, 50, 75, 100] as const;
export type CriterionScore = typeof CRITERION_SCORES[number];
export const KNOCKOUT_STATUSES = ['MET', 'NOT_MET', 'UNABLE_TO_DETERMINE'] as const;
export type KnockoutStatus = typeof KNOCKOUT_STATUSES[number];

export type AppliedCriterion = {
  id: string;
  category: CriteriaCategory;
  label: string;
  rationale: string | null;
  jdEvidence: string | null;
  appliedWeight: number;
  isKnockout: boolean;
};

export type WeightedCriterionResult = { criterion_id: string; score: CriterionScore; evidence: string; assessment: string };
export type KnockoutCriterionResult = { criterion_id: string; status: KnockoutStatus; evidence: string; assessment: string };
export type CriteriaScores = {
  match: number;
  categoryRollups: Record<CriteriaCategory, number | null>;
  categoryWeights: Record<CriteriaCategory, number>;
};

export function buildNeutralCriterionFindingArraySchema(criteria: AppliedCriterion[]) {
  const ids = criteria.map((criterion) => criterion.id);
  return {
    type: 'array' as const,
    minItems: ids.length,
    maxItems: ids.length,
    items: {
      type: 'object' as const,
      additionalProperties: false,
      required: ['criterionId', 'alignmentScore', 'satisfactionStatus', 'evidence', 'assessment'],
      properties: {
        criterionId: criterionIdSchema(ids),
        alignmentScore: { type: ['integer', 'null'] as const, enum: [...CRITERION_SCORES, null] },
        satisfactionStatus: { type: ['string', 'null'] as const, enum: [...KNOCKOUT_STATUSES, null] },
        evidence: { type: 'string' as const },
        assessment: { type: 'string' as const }
      }
    }
  };
}

export function validateNeutralCriterionFindings(criteria: AppliedCriterion[], findings: Array<{
  criterionId: string;
  alignmentScore: CriterionScore | null;
  satisfactionStatus: KnockoutStatus | null;
}>): void {
  if (!Array.isArray(findings)) throw new Error('Criteria evaluation output is incomplete.');
  const expected = new Set(criteria.map((criterion) => criterion.id));
  const seen = new Set<string>();
  for (const finding of findings) {
    if (!expected.has(finding.criterionId)) throw new Error('Criteria evaluation returned an unknown criterion.');
    if (seen.has(finding.criterionId)) throw new Error('Criteria evaluation returned a duplicate criterion.');
    if (!CRITERION_SCORES.includes(finding.alignmentScore as CriterionScore)) throw new Error('Criteria evaluation returned an invalid alignment score.');
    if (!KNOCKOUT_STATUSES.includes(finding.satisfactionStatus as KnockoutStatus)) throw new Error('Criteria evaluation returned an invalid satisfaction status.');
    seen.add(finding.criterionId);
  }
  if (seen.size !== criteria.length) throw new Error('Criteria evaluation did not evaluate every applied criterion exactly once.');
}

function criterionIdSchema(ids: string[]) {
  return ids.length > 0 ? { type: 'string' as const, enum: ids } : { type: 'string' as const };
}

export function buildCriterionResultArraySchema(criteria: AppliedCriterion[], knockout: boolean) {
  const ids = criteria.filter((criterion) => criterion.isKnockout === knockout).map((criterion) => criterion.id);
  const resultProperties = knockout
    ? { status: { type: 'string' as const, enum: KNOCKOUT_STATUSES }, evidence: { type: 'string' as const }, assessment: { type: 'string' as const } }
    : { score: { type: 'integer' as const, enum: CRITERION_SCORES }, evidence: { type: 'string' as const }, assessment: { type: 'string' as const } };
  return {
    type: 'array' as const,
    minItems: ids.length,
    maxItems: ids.length,
    items: {
      type: 'object' as const,
      additionalProperties: false,
      required: knockout ? ['criterion_id', 'status', 'evidence', 'assessment'] : ['criterion_id', 'score', 'evidence', 'assessment'],
      properties: { criterion_id: criterionIdSchema(ids), ...resultProperties }
    }
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function validateAppliedCriteriaSnapshot(value: unknown): AppliedCriterion[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Applied Hiring Criteria snapshot is malformed.');
  const seen = new Set<string>();
  const criteria = value.map((raw): AppliedCriterion => {
    const item = object(raw);
    const id = typeof item?.id === 'string' ? item.id : '';
    const category = item?.category;
    const label = typeof item?.label === 'string' ? item.label.trim() : '';
    const appliedWeight = item?.appliedWeight;
    const isKnockout = item?.isKnockout;
    if (!id || seen.has(id) || !CRITERIA_CATEGORIES.includes(category as CriteriaCategory) || !label || !Number.isInteger(appliedWeight) || Number(appliedWeight) < 0 || Number(appliedWeight) > 100 || typeof isKnockout !== 'boolean') {
      throw new Error('Applied Hiring Criteria snapshot is malformed.');
    }
    if (isKnockout && appliedWeight !== 0) throw new Error('A Knockout criterion cannot carry applied weight.');
    seen.add(id);
    return {
      id,
      category: category as CriteriaCategory,
      label,
      rationale: typeof item?.rationale === 'string' ? item.rationale : null,
      jdEvidence: typeof item?.jdEvidence === 'string' ? item.jdEvidence : null,
      appliedWeight: Number(appliedWeight),
      isKnockout
    };
  });
  const weightedTotal = criteria.reduce((sum, criterion) => sum + (criterion.isKnockout ? 0 : criterion.appliedWeight), 0);
  if (weightedTotal !== 100) throw new Error('Applied Hiring Criteria weight must total exactly 100%.');
  return criteria;
}

export function validateCriterionResults(criteria: AppliedCriterion[], weighted: WeightedCriterionResult[], knockouts: KnockoutCriterionResult[]): void {
  if (!Array.isArray(weighted) || !Array.isArray(knockouts)) throw new Error('Criteria evaluation output is incomplete.');
  const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const seen = new Set<string>();
  for (const result of weighted) {
    const criterion = byId.get(result.criterion_id);
    if (!criterion) throw new Error('Criteria evaluation returned an unknown criterion.');
    if (seen.has(result.criterion_id)) throw new Error('Criteria evaluation returned a duplicate criterion.');
    if (criterion.isKnockout) throw new Error('A Knockout criterion was returned as weighted.');
    if (!CRITERION_SCORES.includes(result.score)) throw new Error('Criteria evaluation returned an invalid score.');
    seen.add(result.criterion_id);
  }
  for (const result of knockouts) {
    const criterion = byId.get(result.criterion_id);
    if (!criterion) throw new Error('Criteria evaluation returned an unknown criterion.');
    if (seen.has(result.criterion_id)) throw new Error('Criteria evaluation returned a duplicate criterion.');
    if (!criterion.isKnockout) throw new Error('A weighted criterion was returned as a Knockout.');
    if (!KNOCKOUT_STATUSES.includes(result.status)) throw new Error('Criteria evaluation returned an invalid Knockout status.');
    seen.add(result.criterion_id);
  }
  if (seen.size !== criteria.length) throw new Error('Criteria evaluation did not evaluate every applied criterion exactly once.');
}

export function calculateCriteriaScores(criteria: AppliedCriterion[], weighted: WeightedCriterionResult[]): CriteriaScores {
  const results = new Map(weighted.map((result) => [result.criterion_id, result]));
  const categoryWeights = Object.fromEntries(CRITERIA_CATEGORIES.map((category) => [category, 0])) as Record<CriteriaCategory, number>;
  const categoryWeightedScores = Object.fromEntries(CRITERIA_CATEGORIES.map((category) => [category, 0])) as Record<CriteriaCategory, number>;
  let weightedScore = 0;
  for (const criterion of criteria) {
    if (criterion.isKnockout) continue;
    const result = results.get(criterion.id);
    if (!result) throw new Error('Criteria evaluation is missing a weighted result.');
    const contribution = result.score * criterion.appliedWeight;
    weightedScore += contribution;
    if (criterion.appliedWeight > 0) {
      categoryWeights[criterion.category] += criterion.appliedWeight;
      categoryWeightedScores[criterion.category] += contribution;
    }
  }
  const categoryRollups = Object.fromEntries(CRITERIA_CATEGORIES.map((category) => [
    category,
    categoryWeights[category] > 0 ? Math.round(categoryWeightedScores[category] / categoryWeights[category]) : null
  ])) as Record<CriteriaCategory, number | null>;
  return { match: Math.round(weightedScore / 100), categoryRollups, categoryWeights };
}
