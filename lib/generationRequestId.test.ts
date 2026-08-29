import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatedQuestionId } from './generationRequestId.ts';

test('the same requestId and position always derive the exact same id - required for a retry to reuse the same five keys', () => {
  assert.equal(generatedQuestionId('11111111-1111-1111-1111-111111111111', 0), generatedQuestionId('11111111-1111-1111-1111-111111111111', 0));
});

test('every position within one requestId derives a distinct id', () => {
  const requestId = '22222222-2222-2222-2222-222222222222';
  const ids = [0, 1, 2, 3, 4].map((index) => generatedQuestionId(requestId, index));
  assert.equal(new Set(ids).size, 5);
});

test('different requestIds never collide, even at the same position', () => {
  assert.notEqual(
    generatedQuestionId('33333333-3333-3333-3333-333333333333', 0),
    generatedQuestionId('44444444-4444-4444-4444-444444444444', 0)
  );
});

test('the id is prefixed with "ai-" and embeds both the requestId and position verbatim', () => {
  assert.equal(generatedQuestionId('req-abc', 3), 'ai-req-abc-3');
});
