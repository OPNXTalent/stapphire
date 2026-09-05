import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isActiveOperation,
  isHiringCriteriaOperationMessage,
  isProspectSearchOperationMessage,
  isResumeEvaluationOperationMessage,
  isRetryableHiringCriteriaError,
  isTerminalOperation
} from './operationTypes.ts';

test('Hiring Criteria operation messages require a non-empty operation ID', () => {
  assert.equal(isHiringCriteriaOperationMessage({ operationId: 'operation-1' }), true);
  assert.equal(isHiringCriteriaOperationMessage({ operationId: '' }), false);
  assert.equal(isHiringCriteriaOperationMessage({}), false);
  assert.equal(isHiringCriteriaOperationMessage(null), false);
});

test('prospect search messages require one persisted search ID', () => {
  assert.equal(isProspectSearchOperationMessage({ searchId: 'search-1' }), true);
  assert.equal(isProspectSearchOperationMessage({ searchId: '' }), false);
  assert.equal(isProspectSearchOperationMessage({ operationId: 'operation-1' }), false);
});

test('resume evaluation messages require one durable operation item ID', () => {
  assert.equal(isResumeEvaluationOperationMessage({ operationItemId: 'item-1' }), true);
  assert.equal(isResumeEvaluationOperationMessage({ operationItemId: '' }), false);
  assert.equal(isResumeEvaluationOperationMessage({ operationId: 'operation-1' }), false);
  assert.equal(isResumeEvaluationOperationMessage(null), false);
});

test('retry classification is bounded to transient transport and API failures', () => {
  assert.equal(isRetryableHiringCriteriaError({ status: 429 }), true);
  assert.equal(isRetryableHiringCriteriaError({ status: 503 }), true);
  assert.equal(isRetryableHiringCriteriaError({ code: 'ETIMEDOUT' }), true);
  assert.equal(isRetryableHiringCriteriaError({ status: 400 }), false);
  assert.equal(isRetryableHiringCriteriaError(new Error('invalid structured output')), false);
});

test('operation status classification distinguishes active and terminal states', () => {
  assert.equal(isActiveOperation('queued'), true);
  assert.equal(isActiveOperation('processing'), true);
  for (const status of ['completed', 'partially_completed', 'failed', 'cancelled'] as const) {
    assert.equal(isTerminalOperation(status), true);
  }
});

test('ResumeOperationItemSummary exposes durable per-item uploaded state', () => {
  const source = readFileSync(new URL('./operationTypes.ts', import.meta.url), 'utf8');
  const typeMatch = source.match(/export type ResumeOperationItemSummary = \{([\s\S]*?)\n\};/);
  assert.ok(typeMatch, 'expected to find ResumeOperationItemSummary');
  assert.match(typeMatch[1], /uploaded: boolean;/, 'expected the durable uploaded field to be part of the type sent to the client - required so the UI can supersede local browser upload state with server-confirmed truth');
});

test('getResumeOperations actually populates the uploaded field from persisted input_ref state, not just the type declaring it', () => {
  const source = readFileSync(new URL('./operations.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /uploaded: item\.input_ref\?\.uploaded === true/,
    'expected the serialized item to expose uploaded straight from the persisted input_ref.uploaded flag - the same field already used internally for retryable, now also exposed directly'
  );
});
