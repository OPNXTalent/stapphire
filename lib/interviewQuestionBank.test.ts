import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTERVIEW_STAGES } from './interviewQuestionBank.ts';

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
