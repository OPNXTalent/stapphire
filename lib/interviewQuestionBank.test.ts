import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTERVIEW_STAGES, buildQuestionBank } from './interviewQuestionBank.ts';
import { PHONE_SCREEN_ALL_QUESTIONS } from './phoneScreenQuestions.ts';

test('the four assessment stages are fixed, in order, with the specified names and taglines', () => {
  assert.deepEqual(
    INTERVIEW_STAGES.map((stage) => ({ id: stage.id, label: stage.label, tagline: stage.tagline })),
    [
      { id: 'phone-screen', label: 'Phone Screen', tagline: 'Qualify' },
      { id: 'round-1', label: '1st Interview', tagline: 'Validate' },
      { id: 'round-2', label: '2nd Interview', tagline: 'Demonstrate' },
      { id: 'final', label: '3rd Interview', tagline: 'Differentiate' }
    ]
  );
});

test('every stage has a non-empty description, for callers that still render it (e.g. the pre-production InterviewBuilder prototype)', () => {
  for (const stage of INTERVIEW_STAGES) {
    assert.ok(stage.description.trim().length > 0, `${stage.id} must keep a description`);
  }
});

test('each stage carries its exact canonical one-sentence explainer, shown in the right panel under the stage title', () => {
  assert.deepEqual(
    INTERVIEW_STAGES.map((stage) => stage.description),
    [
      'Confirm minimum requirements, practical alignment, and whether the candidate should advance to an interview.',
      'Establish whether the candidate has the relevant experience and foundational capability to perform the role.',
      'Explore how the candidate applies their skills when handling complexity, competing priorities, and collaboration.',
      'Distinguish qualified finalists through judgment, leadership, strategic thinking, and potential organizational impact.'
    ]
  );
});

// Correction 2 - buildQuestionBank() must not maintain its own,
// independent phone-screen question content. Its phone-screen entries
// are required to be a thin, id-preserving adapter over the one
// canonical source (lib/phoneScreenQuestions.ts), not a second array
// with different text.
test('buildQuestionBank\'s phone-screen entries are adapted 1:1 from the one canonical source, preserving its ids, text, and response metadata exactly', () => {
  const bank = buildQuestionBank('Test Role');
  const phoneScreenEntries = bank.filter((question) => question.stage === 'phone-screen');
  assert.equal(phoneScreenEntries.length, PHONE_SCREEN_ALL_QUESTIONS.length);
  assert.deepEqual(
    phoneScreenEntries.map((question) => ({ id: question.id, text: question.text, response: question.response })),
    PHONE_SCREEN_ALL_QUESTIONS.map((seed) => ({ id: seed.id, text: seed.text, response: seed.response }))
  );
});

test('buildQuestionBank\'s round-1/round-2/final entries are unaffected by the phone-screen consolidation - still 6 each, with stable ids', () => {
  const bank = buildQuestionBank('Test Role');
  for (const stageId of ['round-1', 'round-2', 'final'] as const) {
    const entries = bank.filter((question) => question.stage === stageId);
    assert.equal(entries.length, 6, `${stageId} must still contribute exactly 6 bank questions`);
    assert.deepEqual(entries.map((question) => question.id), [1, 2, 3, 4, 5, 6].map((n) => `${stageId}-${n}`));
  }
});
