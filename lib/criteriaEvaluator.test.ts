import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    { criterionId: 'weighted', alignmentScore: 75 as const, satisfactionStatus: 'MET' as const, evidence: 'Resume evidence', assessment: 'Supported' },
    { criterionId: 'knockout', alignmentScore: 25 as const, satisfactionStatus: 'UNABLE_TO_DETERMINE' as const, evidence: 'Resume is silent', assessment: 'Verify' }
  ];
  validateNeutralCriterionFindings(criteria, valid);
  assert.throws(() => validateNeutralCriterionFindings(criteria, [{ ...valid[0], satisfactionStatus: null }, valid[1]]), /invalid satisfaction status/);
  assert.throws(() => validateNeutralCriterionFindings(criteria, valid.slice(1)), /every applied criterion/);
  assert.throws(() => validateNeutralCriterionFindings(criteria, [{ ...valid[0], evidence: ' ' }, valid[1]]), /blank evidence/);
});

test('worker persistence wiring captures actual provenance without changing JD completion', () => {
  const evaluator = readFileSync(new URL('./criteriaEvaluator.ts', import.meta.url), 'utf8');
  const candidateEvaluation = readFileSync(new URL('./candidateEvaluation.ts', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('./resumeEvaluationOperation.ts', import.meta.url), 'utf8');
  assert.match(evaluator, /modelIdentifier: response\.model/);
  assert.match(evaluator, /CRITERIA_EVALUATION_PROMPT_SCHEMA_VERSION = 'criteria_evaluation_neutral_findings_v1'/);
  assert.match(candidateEvaluation, /neutralFindingsPersistence:/);
  assert.doesNotMatch(candidateEvaluation, /evaluationBasis\.criteria\.find/);
  assert.match(worker, /\? 'complete_phase1_hiring_criteria_resume_operation_item_v1'\s*: 'complete_phase1_resume_operation_item'/);
  assert.equal((worker.match(/evaluateResumeAgainstBasis\(/g) || []).length, 1, 'persistence must not introduce another model evaluation');
});
