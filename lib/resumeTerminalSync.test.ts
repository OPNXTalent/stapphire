import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchResumeOperationTerminal,
  resolveTerminalObservation,
  subscribeToResumeOperationTerminal
} from './resumeTerminalSync.ts';

test('processing response then terminal response stops animation/polling and refreshes the matching requisition once', () => {
  const browser = new EventTarget();
  let refreshes = 0;
  const unsubscribe = subscribeToResumeOperationTerminal(browser, 'req-a', () => { refreshes += 1; });

  const processing = resolveTerminalObservation('processing', false);
  assert.equal(processing.active, true, 'processing animation remains active');
  assert.equal(processing.continuePolling, true, 'processing schedules another poll');
  assert.equal(processing.notifyTerminal, false);

  const terminal = resolveTerminalObservation('completed', false);
  assert.equal(terminal.active, false, 'terminal state suppresses processing animation immediately');
  assert.equal(terminal.continuePolling, false, 'terminal state schedules no further poll');
  assert.equal(terminal.notifyTerminal, true);
  dispatchResumeOperationTerminal(browser, { requisitionId: 'req-a', operationId: 'operation-a' });
  assert.equal(refreshes, 1, 'the page-owned subscriber refreshes candidate server data');

  const duplicateTerminal = resolveTerminalObservation('completed', true);
  assert.equal(duplicateTerminal.notifyTerminal, false, 'the same terminal operation cannot refresh twice');
  unsubscribe();
});

test('navigation reconstruction restores processing, then terminal refresh is scoped to that requisition', () => {
  const browser = new EventTarget();
  let currentRequisitionRefreshes = 0;
  let otherRequisitionRefreshes = 0;
  subscribeToResumeOperationTerminal(browser, 'req-returned', () => { currentRequisitionRefreshes += 1; });
  subscribeToResumeOperationTerminal(browser, 'req-other', () => { otherRequisitionRefreshes += 1; });

  const reconstructed = resolveTerminalObservation('processing', false);
  assert.equal(reconstructed.active, true, 'reconstructed durable progress is active after returning');
  assert.equal(reconstructed.continuePolling, true);

  const terminal = resolveTerminalObservation('completed', false);
  assert.equal(terminal.notifyTerminal, true);
  dispatchResumeOperationTerminal(browser, { requisitionId: 'req-returned', operationId: 'operation-returned' });
  assert.equal(currentRequisitionRefreshes, 1);
  assert.equal(otherRequisitionRefreshes, 0, 'operation A cannot refresh or override another requisition/batch');
});

test('a first observed terminal response still refreshes candidates', () => {
  const terminal = resolveTerminalObservation('completed', false);
  assert.equal(terminal.notifyTerminal, true, 'terminal refresh must not depend on a prior progress signature');
  assert.equal(terminal.continuePolling, false);
});
