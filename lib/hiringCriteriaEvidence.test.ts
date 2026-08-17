import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText } from './hiringCriteriaEvidence.ts';

// Regression coverage for the production incident where valid Job
// Descriptions containing typographic punctuation (smart quotes,
// em-dashes - extremely common when JDs are pasted from Word, Outlook,
// or ATS systems) failed Hiring Criteria evidence validation, because
// the model's quoted jdEvidence commonly normalizes such punctuation
// to plain ASCII when quoting text back, while the source JD retained
// the original typographic characters. normalizeText must treat these
// as equivalent, without weakening the check for genuinely fabricated
// evidence.

test('normalizeText treats smart quotes as equivalent to straight quotes', () => {
  assert.equal(normalizeText('“strong analytical skills”'), normalizeText('"strong analytical skills"'));
});

test('normalizeText treats em-dash and en-dash as equivalent to a hyphen', () => {
  assert.equal(normalizeText('5+ years — required'), normalizeText('5+ years - required'));
  assert.equal(normalizeText('5+ years – required'), normalizeText('5+ years - required'));
});

test('normalizeText still distinguishes genuinely different content', () => {
  assert.notEqual(normalizeText('strong analytical skills'), normalizeText('fluent in Mandarin and Cantonese'));
});

test('a realistic JD-vs-model-evidence pair now matches after normalization', () => {
  const jd = 'The candidate must have “strong analytical skills” — 5+ years required.';
  const modelEvidence = 'strong analytical skills" - 5+ years required';
  assert.ok(normalizeText(jd).includes(normalizeText(modelEvidence)));
});
