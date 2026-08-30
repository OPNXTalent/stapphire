import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNeutralCriterionFindingArraySchema, validateNeutralCriterionFindings, type AppliedCriterion } from './criteriaEvaluation.ts';

const criteria: AppliedCriterion[] = [
  { id: 'weighted', category: 'hard_skills', label: 'Weighted', rationale: null, jdEvidence: null, appliedWeight: 100, isKnockout: false },
  { id: 'knockout', category: 'other_requirements', label: 'Knockout', rationale: null, jdEvidence: null, appliedWeight: 0, isKnockout: true }
];

test('model contract requires both neutral dimensions for every criterion regardless of treatment', () => {
  const findings = buildNeutralCriterionFindingArraySchema(criteria);
  assert.equal(findings.minItems, 2);
  assert.deepEqual(findings.items.required, ['criterionId', 'alignmentScore', 'satisfactionStatus', 'evidence', 'assessment']);
  assert.deepEqual(findings.items.properties.criterionId.enum, ['weighted', 'knockout']);
  assert.deepEqual(findings.items.properties.alignmentScore.enum, [0, 25, 50, 75, 100, null]);
  assert.deepEqual(findings.items.properties.satisfactionStatus.enum, ['MET', 'NOT_MET', 'UNABLE_TO_DETERMINE', null]);
});

test('new model findings reject null treatment dimensions and incomplete coverage', () => {
  const valid = [
    { criterionId: 'weighted', alignmentScore: 75 as const, satisfactionStatus: 'MET' as const, evidence: '', assessment: '' },
    { criterionId: 'knockout', alignmentScore: 25 as const, satisfactionStatus: 'UNABLE_TO_DETERMINE' as const, evidence: '', assessment: '' }
  ];
  validateNeutralCriterionFindings(criteria, valid);
  assert.throws(() => validateNeutralCriterionFindings(criteria, [{ ...valid[0], satisfactionStatus: null }, valid[1]]), /invalid satisfaction status/);
  assert.throws(() => validateNeutralCriterionFindings(criteria, valid.slice(1)), /every applied criterion/);
});
