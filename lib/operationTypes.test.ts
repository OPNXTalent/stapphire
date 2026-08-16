import test from 'node:test';
import assert from 'node:assert/strict';
import { isActiveOperation, isHiringCriteriaOperationMessage, isRetryableHiringCriteriaError, isTerminalOperation } from './operationTypes.ts';

test('Hiring Criteria operation messages require a non-empty operation ID', () => {
  assert.equal(isHiringCriteriaOperationMessage({ operationId: 'operation-1' }), true);
  assert.equal(isHiringCriteriaOperationMessage({ operationId: '' }), false);
  assert.equal(isHiringCriteriaOperationMessage({}), false);
  assert.equal(isHiringCriteriaOperationMessage(null), false);
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
