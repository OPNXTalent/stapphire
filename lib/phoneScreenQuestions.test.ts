import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHONE_SCREEN_BANK_QUESTIONS, PHONE_SCREEN_DEFAULT_QUESTIONS } from './phoneScreenQuestions.ts';

test('exactly the six specified default questions are present, verbatim, in the specified order', () => {
  assert.deepEqual(PHONE_SCREEN_DEFAULT_QUESTIONS.map((question) => question.text), [
    'Are you within commuting distance of the work location, or prepared to relocate?',
    'Is the stated compensation range acceptable?',
    'How many years of applicable experience do you have?',
    'What is the highest degree you have completed?',
    'Are you currently authorized to work in the United States?',
    'Will you now or in the future require employer sponsorship to work in the United States?'
  ]);
});

test('exactly the fourteen specified bank questions are present, verbatim', () => {
  const texts = PHONE_SCREEN_BANK_QUESTIONS.map((question) => question.text);
  assert.equal(texts.length, 14);
  assert.deepEqual(new Set(texts), new Set([
    'Required schedule availability',
    'Onsite, hybrid, or remote arrangement',
    'Earliest start date',
    'Employment-type acceptance',
    'Travel requirements',
    'Required licenses or certifications',
    'Essential job functions',
    'Highest level of education',
    'Evening, weekend, holiday, overtime, split-shift, or on-call availability',
    'Time-zone or coverage-hour requirements',
    'Security-clearance requirements',
    'Language proficiency',
    'Portfolio or work sample',
    'Required training availability'
  ]));
});

test('the default questions and bank questions never repeat a question - the bank holds only the "remaining" suggestions', () => {
  const defaultTexts = new Set(PHONE_SCREEN_DEFAULT_QUESTIONS.map((question) => question.text));
  for (const question of PHONE_SCREEN_BANK_QUESTIONS) {
    assert.ok(!defaultTexts.has(question.text), `"${question.text}" must not appear in both the default set and the bank`);
  }
});

test('every question id is unique across both lists combined', () => {
  const ids = [...PHONE_SCREEN_DEFAULT_QUESTIONS, ...PHONE_SCREEN_BANK_QUESTIONS].map((question) => question.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every question declares a valid response type - only yes-no or short-answer are supported this pass', () => {
  for (const question of [...PHONE_SCREEN_DEFAULT_QUESTIONS, ...PHONE_SCREEN_BANK_QUESTIONS]) {
    assert.ok(question.responseType === 'yes-no' || question.responseType === 'short-answer', `${question.id} has an invalid responseType`);
  }
});

test('sourcing questions ("How did you hear about this opportunity?" and employee-referral) are excluded from both lists this pass', () => {
  const allText = [...PHONE_SCREEN_DEFAULT_QUESTIONS, ...PHONE_SCREEN_BANK_QUESTIONS].map((question) => question.text.toLowerCase()).join(' | ');
  assert.doesNotMatch(allText, /hear about this opportunity/i);
  assert.doesNotMatch(allText, /referral/i);
});
