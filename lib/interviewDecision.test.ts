import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeInterviewDecision, type InterviewRecommendation } from './interviewDecision.ts';

const votes = (...values: InterviewRecommendation[]) => values;

test('clear inclined majority with an acceptable score advances', () => {
  assert.equal(summarizeInterviewDecision(3, votes('Proceed', 'Proceed', 'Proceed', 'Decline')).decision, 'Advance');
});

test('clear not inclined majority with a weak score does not advance', () => {
  assert.equal(summarizeInterviewDecision(2.9, votes('Decline', 'Decline', 'Decline', 'Proceed')).decision, 'Do Not Advance');
});

test('ties and near-ties discuss', () => {
  assert.equal(summarizeInterviewDecision(4, votes('Proceed', 'Decline')).label, 'Split Decision — Discuss');
  assert.equal(summarizeInterviewDecision(4, votes('Proceed', 'Proceed', 'Decline', 'Undecided - Need more information')).decision, 'Discuss');
});

test('score and vote conflicts discuss', () => {
  assert.equal(summarizeInterviewDecision(2.5, votes('Proceed', 'Proceed', 'Proceed', 'Decline')).label, 'Mixed Evidence — Discuss');
  assert.equal(summarizeInterviewDecision(4.5, votes('Decline', 'Decline', 'Decline', 'Proceed')).label, 'Mixed Evidence — Discuss');
});

test('insufficient recommendation data discusses', () => {
  assert.equal(summarizeInterviewDecision(5, votes('Proceed')).label, 'Insufficient Panel Signal — Discuss');
});

test('vote composition is anonymous and uses normalized display labels', () => {
  const summary = summarizeInterviewDecision(4, votes('Proceed', 'Proceed', 'Decline', 'Undecided - Need more information'));
  assert.equal(summary.composition, '2 Inclined · 1 Not Inclined · 1 Not Sure');
  assert.doesNotMatch(summary.composition, /participant|contributor/i);
});
