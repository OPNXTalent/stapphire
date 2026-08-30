import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRITERION_SEMANTIC_FINGERPRINT_VERSION,
  canonicalizeCriterionSemantics,
  fingerprintCriterionSemantics
} from './criterionSemantics.ts';
import { validateAppliedCriteriaSnapshot } from './criteriaEvaluation.ts';

const base = {
  id: '00000000-0000-4000-8000-000000000001',
  category: 'hard_skills' as const,
  label: 'Café administration',
  rationale: 'Five years\nrequired',
  jdEvidence: 'ERP ownership',
  appliedWeight: 100,
  isKnockout: false
};

test('criterion semantics use fixed keys and a stable cross-runtime fixture', () => {
  const fixture = {
    category: ' hard_skills ',
    label: 'Cafe\u0301\t administration',
    rationale: '  Five  years\r\nrequired ',
    jdEvidence: null
  };
  assert.equal(
    canonicalizeCriterionSemantics(fixture),
    '{"category":"hard_skills","label":"Café administration","rationale":"Five years\\nrequired","jdEvidence":null}'
  );
  assert.equal(fingerprintCriterionSemantics(fixture), '7a47ef97972a77c7a6c7c7f967f13dd829f3be47683b8055a7b7c4ef63bcb3a4');
});

test('line endings, boundary whitespace, horizontal formatting, and object key order are insignificant', () => {
  const reordered = { jdEvidence: null, rationale: 'Five\tyears\rrequired', label: ' Café administration ', category: 'hard_skills' };
  const normalized = { category: 'hard_skills', label: 'Café administration', rationale: 'Five years\nrequired', jdEvidence: null };
  assert.equal(fingerprintCriterionSemantics(reordered), fingerprintCriterionSemantics(normalized));
});

test('weight, treatment, zero-weight state, IDs, and projection metadata are excluded', () => {
  const baseline = fingerprintCriterionSemantics(base);
  assert.equal(fingerprintCriterionSemantics({ ...base, id: 'different', appliedWeight: 0, isKnockout: true }), baseline);
  assert.equal(fingerprintCriterionSemantics({ ...base, defaultWeight: 5, knockoutSuggested: true, createdAt: 'later' }), baseline);
});

test('each semantic field changes the fingerprint when its meaning changes', () => {
  const baseline = fingerprintCriterionSemantics(base);
  for (const changed of [
    { ...base, label: 'Café platform administration' },
    { ...base, category: 'responsibilities' },
    { ...base, rationale: 'Six years required' },
    { ...base, jdEvidence: 'CRM ownership' }
  ]) assert.notEqual(fingerprintCriterionSemantics(changed), baseline);
});

test('legacy snapshots derive metadata while stored metadata must match canonical semantics', () => {
  const [legacy] = validateAppliedCriteriaSnapshot([base]);
  assert.equal(legacy.semanticFingerprintVersion, CRITERION_SEMANTIC_FINGERPRINT_VERSION);
  assert.equal(legacy.semanticFingerprint, fingerprintCriterionSemantics(base));

  const stored = { ...base, semanticFingerprint: legacy.semanticFingerprint, semanticFingerprintVersion: CRITERION_SEMANTIC_FINGERPRINT_VERSION };
  assert.equal(validateAppliedCriteriaSnapshot([stored])[0].semanticFingerprint, legacy.semanticFingerprint);
  assert.throws(() => validateAppliedCriteriaSnapshot([{ ...stored, semanticFingerprint: '0'.repeat(64) }]), /semantic fingerprint is invalid/);
});
