import assert from 'node:assert/strict';
import test from 'node:test';
import { interviewProgress, isQuestionComplete } from './interviewCompletion.ts';

test('completion follows each configured response type', () => {
  const ratings = { 'aoe:Skill': 4, 'mixed:Skill': 5 };
  assert.equal(isQuestionComplete({ id: 'aoe', areas: ['Skill'] }, { ratings }), true);
  assert.equal(isQuestionComplete({ id: 'mixed', areas: ['Skill'], commentBox: true }, { ratings }), true);
  assert.equal(isQuestionComplete({ id: 'comment', commentBox: true }, { questionComments: { comment: '  useful  ' } }), true);
  assert.equal(isQuestionComplete({ id: 'comment', commentBox: true }, { questionComments: { comment: '   ' } }), false);
  assert.equal(isQuestionComplete({ id: 'yn', yesNo: true }, { yesNoResponses: { yn: 'no' } }), true);
  assert.equal(isQuestionComplete({ id: 'ync', yesNo: true, commentBox: true }, { yesNoResponses: { ync: 'yes' } }), true);
  assert.equal(isQuestionComplete({ id: 'none' }, {}), true);
});

test('comment-only questions affect readiness without inflating rating count', () => {
  const questions = [{ id: 'rating', areas: ['Skill'] }, { id: 'comment', commentBox: true }];
  const incomplete = interviewProgress(questions, { ratings: { 'rating:Skill': 3 } });
  assert.equal(incomplete.ratingCount, 1);
  assert.equal(incomplete.completedQuestionCount, 1);
  assert.equal(incomplete.complete, false);
  assert.equal(interviewProgress(questions, { ratings: { 'rating:Skill': 3 }, questionComments: { comment: 'Done' } }).complete, true);
});
