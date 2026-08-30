import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptLegacyCriterionResults, projectCriterionFindings, type CriterionFinding } from './criterionProjection.ts';
import type { AppliedCriterion } from './criteriaEvaluation.ts';

const criteria: AppliedCriterion[] = [
  { id: 'a', category: 'responsibilities', label: 'A', rationale: null, jdEvidence: null, appliedWeight: 2, isKnockout: false },
  { id: 'b', category: 'responsibilities', label: 'B', rationale: null, jdEvidence: null, appliedWeight: 1, isKnockout: false },
  { id: 'c', category: 'hard_skills', label: 'C', rationale: null, jdEvidence: null, appliedWeight: 0, isKnockout: false },
  { id: 'k', category: 'other_requirements', label: 'K', rationale: null, jdEvidence: null, appliedWeight: 0, isKnockout: true }
];

function finding(criterionId: string, alignmentScore: CriterionFinding['alignmentScore'], satisfactionStatus: CriterionFinding['satisfactionStatus']): CriterionFinding {
  return { criterionId, alignmentScore, satisfactionStatus, evidence: '', assessment: '' };
}

test('projects neutral findings using normalized weights and rounds only aggregates', () => {
  const result = projectCriterionFindings(criteria, [finding('a', 75, 'MET'), finding('b', 25, 'NOT_MET'), finding('c', 100, 'MET'), finding('k', 0, 'UNABLE_TO_DETERMINE')]);
  assert.equal(result.complete, true);
  assert.equal(result.audit.positiveWeightedWeightTotal, 3);
  assert.ok(Math.abs(result.audit.unroundedOverallMatch! - 175 / 3) < 1e-10);
  assert.equal(result.overallMatch, 58);
  assert.equal(result.categoryScores.responsibilities, 58);
  assert.equal(result.categoryScores.hard_skills, null);
  assert.equal(result.criterionContributions.find((item) => item.criterionId === 'c')?.contribution, 0);
  assert.equal(result.knockoutResults[0].outcome, 'review-required');
});

test('missing treatment-required values makes the projection incomplete', () => {
  const result = projectCriterionFindings(criteria, [finding('a', 75, null), finding('b', null, 'MET'), finding('c', 100, null), finding('k', null, null)]);
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingRequiredCriterionIds, ['b', 'k']);
  assert.equal(result.overallMatch, null);
  assert.equal(result.knockoutResults[0].outcome, 'incomplete');
});

test('coverage reports missing, duplicate, and unknown findings', () => {
  const result = projectCriterionFindings(criteria, [finding('a', 100, 'MET'), finding('a', 75, 'MET'), finding('outside', 0, 'NOT_MET')]);
  assert.deepEqual(result.coverage.missingCriterionIds, ['b', 'c', 'k']);
  assert.deepEqual(result.coverage.duplicateCriterionIds, ['a']);
  assert.deepEqual(result.coverage.unknownCriterionIds, ['outside']);
  assert.equal(result.complete, false);
});

test('legacy adapter preserves only the historical treatment-specific value', () => {
  const findings = adaptLegacyCriterionResults(
    [{ criterion_id: 'a', score: 75, evidence: 'e1', assessment: 'a1' }],
    [{ criterion_id: 'k', status: 'MET', evidence: 'e2', assessment: 'a2' }]
  );
  assert.deepEqual(findings, [
    { criterionId: 'a', alignmentScore: 75, satisfactionStatus: null, evidence: 'e1', assessment: 'a1' },
    { criterionId: 'k', alignmentScore: null, satisfactionStatus: 'MET', evidence: 'e2', assessment: 'a2' }
  ]);
});
