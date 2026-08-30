import assert from 'node:assert/strict';
import test from 'node:test';
import { phoneScreenResponseLabel, summarizePhoneScreenRecommendation, summarizePhoneScreenResponses } from './phoneScreenResults.ts';

test('Phone Screen responses aggregate by question without inventing a rating', () => {
  const rows = summarizePhoneScreenResponses([
    { recommendation: 'Proceed', yesNoResponses: [{ question: 'Authorized to work?', response: 'Yes' }], questionComments: [{ question: 'Years of experience?', comment: '5 years' }] },
    { recommendation: 'Proceed', yesNoResponses: [{ question: 'Authorized to work?', response: 'No' }], questionComments: [{ question: 'Years of experience?', comment: '  ' }] }
  ]);
  assert.deepEqual(rows, [
    { question: 'Authorized to work?', yes: 1, no: 1, writtenResponses: [] },
    { question: 'Years of experience?', yes: 0, no: 0, writtenResponses: ['5 years'] }
  ]);
  assert.equal(phoneScreenResponseLabel(rows[0]), '1 Yes · 1 No');
  assert.equal(phoneScreenResponseLabel(rows[1]), '5 years');
});

test('the unified API response preserves the original mixed-control question order', () => {
  const rows = summarizePhoneScreenResponses([{
    recommendation: 'Proceed',
    screenResponses: [
      { question: 'Location?', response: 'Within commuting distance', kind: 'written' },
      { question: 'Compensation acceptable?', response: 'Yes', kind: 'yes-no' },
      { question: 'Years of experience?', response: '5', kind: 'written' }
    ],
    yesNoResponses: [],
    questionComments: []
  }]);
  assert.deepEqual(rows.map((row) => row.question), ['Location?', 'Compensation acceptable?', 'Years of experience?']);
});

test('a single Phone Screen recommendation produces a useful next step', () => {
  assert.deepEqual(summarizePhoneScreenRecommendation(['Proceed']), { composition: '1 Proceed', label: 'Advance to 1st Interview' });
  assert.deepEqual(summarizePhoneScreenRecommendation(['Decline']), { composition: '1 Decline', label: 'Do Not Advance' });
});

test('mixed Phone Screen recommendations require review', () => {
  assert.deepEqual(summarizePhoneScreenRecommendation(['Proceed', 'Decline']), { composition: '1 Proceed · 1 Decline', label: 'Review Required' });
});
