import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCriteriaScores, validateAppliedCriteriaSnapshot, validateCriterionResults, type AppliedCriterion, type KnockoutCriterionResult, type WeightedCriterionResult } from './criteriaEvaluation.ts';

const criteria: AppliedCriterion[] = [
  { id: 'r1', category: 'responsibilities', label: 'Lead close', rationale: null, jdEvidence: null, appliedWeight: 35, isKnockout: false },
  { id: 'r2', category: 'responsibilities', label: 'Reporting', rationale: null, jdEvidence: null, appliedWeight: 15, isKnockout: false },
  { id: 'h1', category: 'hard_skills', label: 'ERP', rationale: null, jdEvidence: null, appliedWeight: 25, isKnockout: false },
  { id: 's1', category: 'soft_skills', label: 'Leadership', rationale: null, jdEvidence: null, appliedWeight: 15, isKnockout: false },
  { id: 'k1', category: 'keywords', label: 'Terminology', rationale: null, jdEvidence: null, appliedWeight: 10, isKnockout: false },
  { id: 'o1', category: 'other_requirements', label: 'License', rationale: null, jdEvidence: null, appliedWeight: 0, isKnockout: true },
  { id: 'z1', category: 'other_requirements', label: 'Preferred credential', rationale: null, jdEvidence: null, appliedWeight: 0, isKnockout: false }
];
const weighted: WeightedCriterionResult[] = [
  { criterion_id: 'r1', score: 100, evidence: '', assessment: '' },
  { criterion_id: 'r2', score: 75, evidence: '', assessment: '' },
  { criterion_id: 'h1', score: 50, evidence: '', assessment: '' },
  { criterion_id: 's1', score: 25, evidence: '', assessment: '' },
  { criterion_id: 'k1', score: 0, evidence: '', assessment: '' },
  { criterion_id: 'z1', score: 100, evidence: '', assessment: '' }
];

test('deterministic Match uses criterion contributions and rounds only the final sum', () => {
  const scores = calculateCriteriaScores(criteria, weighted);
  assert.equal(scores.match, 63); // (3500 + 1125 + 1250 + 375) / 100 = 62.5
  assert.equal(scores.categoryRollups.responsibilities, 93); // 92.5 rounds independently
  assert.equal(scores.categoryRollups.hard_skills, 50);
  assert.equal(scores.categoryRollups.soft_skills, 25);
  assert.equal(scores.categoryRollups.keywords, 0);
  assert.equal(scores.categoryRollups.other_requirements, null);
});

test('allowed score scale and zero-weight contribution are enforced', () => {
  validateCriterionResults(criteria, weighted, [{ criterion_id: 'o1', status: 'MET', evidence: '', assessment: '' }]);
  const invalid = weighted.map((item) => ({ ...item })) as unknown as WeightedCriterionResult[];
  (invalid[0] as { score: number }).score = 63;
  assert.throws(() => validateCriterionResults(criteria, invalid, [{ criterion_id: 'o1', status: 'MET', evidence: '', assessment: '' }]), /invalid score/);
  assert.equal(calculateCriteriaScores(criteria, weighted).match, calculateCriteriaScores(criteria.filter((item) => item.id !== 'z1'), weighted.filter((item) => item.criterion_id !== 'z1')).match);
});

test('Knockouts accept all statuses and never affect Match', () => {
  const baseline = calculateCriteriaScores(criteria, weighted).match;
  for (const status of ['MET', 'NOT_MET', 'UNABLE_TO_DETERMINE'] as const) {
    const knockout: KnockoutCriterionResult[] = [{ criterion_id: 'o1', status, evidence: '', assessment: '' }];
    validateCriterionResults(criteria, weighted, knockout);
    assert.equal(calculateCriteriaScores(criteria, weighted).match, baseline);
  }
  assert.throws(() => validateCriterionResults(criteria, weighted, [{ criterion_id: 'o1', status: 'UNKNOWN' as 'MET', evidence: '', assessment: '' }]), /invalid Knockout status/);
});

test('coverage rejects missing, duplicate, unknown, and wrong-array criteria', () => {
  const knockout: KnockoutCriterionResult[] = [{ criterion_id: 'o1', status: 'UNABLE_TO_DETERMINE', evidence: '', assessment: '' }];
  assert.throws(() => validateCriterionResults(criteria, weighted.slice(1), knockout), /every applied criterion/);
  assert.throws(() => validateCriterionResults(criteria, [...weighted, weighted[0]], knockout), /duplicate/);
  assert.throws(() => validateCriterionResults(criteria, [...weighted, { criterion_id: 'unknown', score: 0, evidence: '', assessment: '' }], knockout), /unknown/);
  assert.throws(() => validateCriterionResults(criteria, [...weighted, { criterion_id: 'o1', score: 0, evidence: '', assessment: '' }], []), /Knockout criterion was returned as weighted/);
  assert.throws(() => validateCriterionResults(criteria, weighted.filter((item) => item.criterion_id !== 'r1'), [...knockout, { criterion_id: 'r1', status: 'MET', evidence: '', assessment: '' }]), /weighted criterion was returned as a Knockout/);
});

test('applied snapshots require valid exhaustive weighting', () => {
  assert.equal(validateAppliedCriteriaSnapshot(criteria).length, criteria.length);
  assert.throws(() => validateAppliedCriteriaSnapshot(null), /malformed/);
  assert.throws(() => validateAppliedCriteriaSnapshot(criteria.map((item) => item.id === 'r1' ? { ...item, appliedWeight: 34 } : item)), /exactly 100/);
  assert.throws(() => validateAppliedCriteriaSnapshot([...criteria, criteria[0]]), /malformed/);
  assert.throws(() => validateAppliedCriteriaSnapshot(criteria.map((item) => item.id === 'o1' ? { ...item, appliedWeight: 1 } : item)), /cannot carry/);
});
