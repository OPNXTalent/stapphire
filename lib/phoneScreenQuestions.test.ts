import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHONE_SCREEN_BANK_QUESTIONS,
  PHONE_SCREEN_DEFAULT_QUESTIONS,
  PHONE_SCREEN_ALL_QUESTIONS,
  PHONE_SCREEN_QUESTION_TYPES,
  findPhoneScreenSeed,
  responseSpecToWireFlags,
  wireFlagsToResponseSpec,
  responseSpecForKind
} from './phoneScreenQuestions.ts';

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

test('sourcing questions ("How did you hear about this opportunity?" and employee-referral) are excluded from both lists this pass', () => {
  const allText = [...PHONE_SCREEN_DEFAULT_QUESTIONS, ...PHONE_SCREEN_BANK_QUESTIONS].map((question) => question.text.toLowerCase()).join(' | ');
  assert.doesNotMatch(allText, /hear about this opportunity/i);
  assert.doesNotMatch(allText, /referral/i);
});

// Correction 1 - each default question must carry the specific semantic
// response kind its content requires, not be flattened to whichever of
// the two persisted booleans is closest.
test('each of the six default questions declares the exact response kind its content semantically requires', () => {
  const byText = new Map(PHONE_SCREEN_DEFAULT_QUESTIONS.map((question) => [question.text, question]));
  assert.equal(byText.get('Are you within commuting distance of the work location, or prepared to relocate?')?.response.kind, 'single-choice');
  assert.equal(byText.get('Is the stated compensation range acceptable?')?.response.kind, 'yes-no-needs-discussion');
  assert.equal(byText.get('How many years of applicable experience do you have?')?.response.kind, 'numeric');
  assert.equal(byText.get('What is the highest degree you have completed?')?.response.kind, 'single-choice');
  assert.equal(byText.get('Are you currently authorized to work in the United States?')?.response.kind, 'yes-no');
  assert.equal(byText.get('Will you now or in the future require employer sponsorship to work in the United States?')?.response.kind, 'yes-no');
});

test('the commute/relocation and education default questions define concrete single-choice options, not an empty list', () => {
  const byText = new Map(PHONE_SCREEN_DEFAULT_QUESTIONS.map((question) => [question.text, question]));
  const commute = byText.get('Are you within commuting distance of the work location, or prepared to relocate?');
  assert.ok(commute && commute.response.kind === 'single-choice');
  if (commute && commute.response.kind === 'single-choice') assert.ok(commute.response.options.length >= 2);

  const education = byText.get('What is the highest degree you have completed?');
  assert.ok(education && education.response.kind === 'single-choice');
  if (education && education.response.kind === 'single-choice') assert.ok(education.response.options.length >= 2);
});

test('every question in both lists declares one of the five supported response kinds', () => {
  const validKinds = new Set(['yes-no', 'yes-no-needs-discussion', 'single-choice', 'numeric', 'short-answer']);
  for (const question of PHONE_SCREEN_ALL_QUESTIONS) {
    assert.ok(validKinds.has(question.response.kind), `${question.id} has an invalid response kind`);
  }
});

test('findPhoneScreenSeed looks up any default or bank question by id, across both lists', () => {
  assert.equal(findPhoneScreenSeed('phone-screen-default-3')?.text, 'How many years of applicable experience do you have?');
  assert.equal(findPhoneScreenSeed('phone-screen-bank-1')?.text, 'Required schedule availability');
  assert.equal(findPhoneScreenSeed('does-not-exist'), undefined);
});

// The honesty contract: only yes-no and short-answer have an exact wire
// mapping onto the two persisted booleans; every other kind must persist
// as neither flag set, never falsely narrowed into the closest flag.
test('responseSpecToWireFlags only sets a flag for the two kinds the persisted shape can faithfully represent', () => {
  assert.deepEqual(responseSpecToWireFlags({ kind: 'yes-no' }), { commentBox: false, yesNo: true });
  assert.deepEqual(responseSpecToWireFlags({ kind: 'short-answer' }), { commentBox: true, yesNo: false });
  assert.deepEqual(responseSpecToWireFlags({ kind: 'yes-no-needs-discussion' }), { commentBox: false, yesNo: false });
  assert.deepEqual(responseSpecToWireFlags({ kind: 'single-choice', options: ['A', 'B'] }), { commentBox: false, yesNo: false });
  assert.deepEqual(responseSpecToWireFlags({ kind: 'numeric', unit: 'years' }), { commentBox: false, yesNo: false });
});

test('wireFlagsToResponseSpec only ever recovers yes-no or short-answer - it is not a general inverse of responseSpecToWireFlags', () => {
  assert.deepEqual(wireFlagsToResponseSpec({ commentBox: false, yesNo: true }), { kind: 'yes-no' });
  assert.deepEqual(wireFlagsToResponseSpec({ commentBox: true, yesNo: false }), { kind: 'short-answer' });
  assert.deepEqual(wireFlagsToResponseSpec({ commentBox: false, yesNo: false }), { kind: 'short-answer' });
});

// Question Type metadata (grouping the Question Bank, and the card
// header) - distinct from response kind and from Areas of Evaluation.
test('PHONE_SCREEN_QUESTION_TYPES is exactly the specified 18 categories, in order, ending with Custom', () => {
  assert.deepEqual(PHONE_SCREEN_QUESTION_TYPES, [
    'Location', 'Compensation', 'Experience', 'Education', 'Work Authorization', 'Sponsorship',
    'Availability', 'Schedule', 'Work Arrangement', 'Employment Type', 'Credentials', 'Travel',
    'Essential Functions', 'Security Clearance', 'Language', 'Work Sample', 'Training', 'Custom'
  ]);
});

test('every canonical question declares a real (non-Custom) questionType from the controlled list', () => {
  const realTypes = new Set(PHONE_SCREEN_QUESTION_TYPES.filter((type) => type !== 'Custom'));
  for (const question of PHONE_SCREEN_ALL_QUESTIONS) {
    assert.ok(realTypes.has(question.questionType), `${question.id} has an invalid or Custom questionType`);
  }
});

test('for built-in questions, cardTitle matches questionType exactly', () => {
  for (const question of PHONE_SCREEN_ALL_QUESTIONS) {
    assert.equal(question.cardTitle, question.questionType, `${question.id}: cardTitle must match questionType for a built-in question`);
  }
});

test('the six default questions are tagged with the specific type their content requires', () => {
  const byText = new Map(PHONE_SCREEN_DEFAULT_QUESTIONS.map((question) => [question.text, question.questionType]));
  assert.equal(byText.get('Are you within commuting distance of the work location, or prepared to relocate?'), 'Location');
  assert.equal(byText.get('Is the stated compensation range acceptable?'), 'Compensation');
  assert.equal(byText.get('How many years of applicable experience do you have?'), 'Experience');
  assert.equal(byText.get('What is the highest degree you have completed?'), 'Education');
  assert.equal(byText.get('Are you currently authorized to work in the United States?'), 'Work Authorization');
  assert.equal(byText.get('Will you now or in the future require employer sponsorship to work in the United States?'), 'Sponsorship');
});

test('every real Question Type in the controlled list is used by at least one canonical question', () => {
  const usedTypes = new Set(PHONE_SCREEN_ALL_QUESTIONS.map((question) => question.questionType));
  for (const type of PHONE_SCREEN_QUESTION_TYPES) {
    if (type === 'Custom') continue;
    assert.ok(usedTypes.has(type), `${type} is never used by a canonical question`);
  }
});

test('responseSpecForKind builds a sensible default for each kind and preserves prior single-choice options / numeric unit when switching kind and back', () => {
  assert.deepEqual(responseSpecForKind('yes-no'), { kind: 'yes-no' });
  assert.deepEqual(responseSpecForKind('yes-no-needs-discussion'), { kind: 'yes-no-needs-discussion' });
  assert.deepEqual(responseSpecForKind('short-answer'), { kind: 'short-answer' });
  assert.deepEqual(responseSpecForKind('single-choice'), { kind: 'single-choice', options: [] });
  assert.deepEqual(responseSpecForKind('numeric'), { kind: 'numeric', unit: undefined });

  const previousChoice = { kind: 'single-choice' as const, options: ['Onsite', 'Remote'] };
  assert.deepEqual(responseSpecForKind('single-choice', previousChoice), previousChoice);
  const previousNumeric = { kind: 'numeric' as const, unit: 'years' };
  assert.deepEqual(responseSpecForKind('numeric', previousNumeric), previousNumeric);
  // Switching away and back to a different kind does not carry over an unrelated previous shape.
  assert.deepEqual(responseSpecForKind('single-choice', previousNumeric), { kind: 'single-choice', options: [] });
});
