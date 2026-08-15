import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCriterionResultArraySchema, calculateCriteriaScores, validateAppliedCriteriaSnapshot, validateCriterionResults, type AppliedCriterion, type KnockoutCriterionResult, type WeightedCriterionResult } from './criteriaEvaluation.ts';

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

test('structured output constrains criterion IDs by Knockout treatment', () => {
  const weightedSchema = buildCriterionResultArraySchema(criteria, false);
  const knockoutSchema = buildCriterionResultArraySchema(criteria, true);
  const weightedIds = weightedSchema.items.properties.criterion_id;
  const knockoutIds = knockoutSchema.items.properties.criterion_id;
  assert.deepEqual('enum' in weightedIds ? weightedIds.enum : null, ['r1', 'r2', 'h1', 's1', 'k1', 'z1']);
  assert.deepEqual('enum' in knockoutIds ? knockoutIds.enum : null, ['o1']);
  assert.equal(weightedSchema.minItems, 6);
  assert.equal(weightedSchema.maxItems, 6);
  assert.equal(knockoutSchema.minItems, 1);
  assert.equal(knockoutSchema.maxItems, 1);
});

test('structured output requires an empty Knockout array without an invalid empty enum', () => {
  const withoutKnockouts = criteria.filter((criterion) => !criterion.isKnockout);
  const knockoutSchema = buildCriterionResultArraySchema(withoutKnockouts, true);
  const knockoutIds = knockoutSchema.items.properties.criterion_id;
  assert.equal('enum' in knockoutIds, false);
  assert.equal(knockoutSchema.minItems, 0);
  assert.equal(knockoutSchema.maxItems, 0);
});

test('Marketing Outreach Liaison schema contains exactly its immutable criterion IDs', () => {
  const weightedIds = [
    '051d41b3-be46-4e28-abb7-92c4ea81f07e', '30682928-8303-4f6d-9482-641d49ef1e2c',
    'c1d3956e-abd1-4c3a-ac76-30fcefa955c4', 'e211533c-805e-48ab-b563-4fdbe57994f9',
    '9b309b47-4fc1-4f67-bea7-63b52492e70e', 'fda8cc32-f0ed-447d-8b5a-dcfe87d6a3bb',
    '7ec7b475-c279-4593-9211-a491ae5eb32e', '4ae07a10-ef2f-4a3d-981a-78ba5cb29534',
    '21286af4-0b6e-4972-8f32-383ef91504e6', '6066cf4a-0d78-44cf-ac90-acb1df1e22d0',
    '639d34f3-1570-49bf-a56f-e80a0ae53def', '812ae4b8-ecf6-4b26-87c9-87985d19817f',
    'a62430f0-b301-4f67-8a11-c199a99dad91', '239eb2b0-be5b-4cd5-8399-cca43ffbd1a7',
    '9dba876a-3a03-4967-8e27-38215bc0a3ea', 'a3b7cac9-03a4-4bd7-ac40-f78cdbf59f7b',
    'aabb849e-4d0d-4cf7-bca2-5fd5ac42dedb', '8fb77e40-574d-4756-89ea-00b43a7304f2',
    '6a647049-ab5d-43b3-9249-e00b3660bbe7', '971cb1f8-3de1-40cc-adff-0a71c167faf7',
    '5337d2e0-f554-4f32-a543-27c55ec28f2e', '518c07a7-848a-4120-8b61-0e8bed94d406',
    '7b31398c-330b-4ab0-ba0c-7a5bdf96b634', '72d915eb-b30b-4aab-a6a2-b4aebf61b975'
  ];
  const knockoutIds = ['4f206b64-5ff4-4b42-9efd-791a047c0d79'];
  const fixture = [...weightedIds.map((id) => ({ id, isKnockout: false })), ...knockoutIds.map((id) => ({ id, isKnockout: true }))]
    .map((criterion): AppliedCriterion => ({ ...criterion, category: 'other_requirements', label: criterion.id, rationale: null, jdEvidence: null, appliedWeight: 0 }));
  const weightedEnum = buildCriterionResultArraySchema(fixture, false).items.properties.criterion_id;
  const knockoutEnum = buildCriterionResultArraySchema(fixture, true).items.properties.criterion_id;
  assert.deepEqual('enum' in weightedEnum ? weightedEnum.enum : null, weightedIds);
  assert.deepEqual('enum' in knockoutEnum ? knockoutEnum.enum : null, knockoutIds);
  const allowedWeightedIds = 'enum' in weightedEnum && Array.isArray(weightedEnum.enum) ? weightedEnum.enum : [];
  assert.equal(allowedWeightedIds.includes('invented-id'), false);
});
