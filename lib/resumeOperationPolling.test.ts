import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advancePollTarget, resolveTargetOperation, type PollTargetState } from './resumeOperationPolling.ts';

type Op = { id: string; status: 'queued' | 'processing' | 'completed' | 'partially_completed' | 'failed' | 'cancelled' };

const notDismissed = () => false;

// --- resolveTargetOperation: the core ambiguity-resolution decision ---

test('target exists and remains present -> found, regardless of prior confirmation state', () => {
  const op: Op = { id: 'op-1', status: 'processing' };
  const result = resolveTargetOperation({
    targetId: 'op-1',
    operations: [op],
    previouslyConfirmedPresent: false,
    localBatchFullySettled: false
  });
  assert.deepEqual(result, { kind: 'found', operation: op });
});

test('target has not appeared yet during legitimate creation lag -> awaiting-creation, never declared gone on a first sighting alone', () => {
  const result = resolveTargetOperation({
    targetId: 'op-1',
    operations: [{ id: 'op-unrelated', status: 'queued' }],
    previouslyConfirmedPresent: false,
    localBatchFullySettled: false
  });
  assert.deepEqual(result, { kind: 'awaiting-creation' });
});

test('target confirmed present in an earlier poll and later missing -> confirmed-deleted, not lag', () => {
  const result = resolveTargetOperation({
    targetId: 'op-1',
    operations: [],
    previouslyConfirmedPresent: true,
    localBatchFullySettled: false
  });
  assert.deepEqual(result, { kind: 'confirmed-deleted' });
});

test('target disappears before its very first poll because the duplicate path deletes it first - proven via local batch settlement, not a prior poll sighting', () => {
  // This is the exact PM-identified race: create operation -> upload
  // duplicate -> duplicate RPC deletes the item/operation -> first
  // operation poll. previouslyConfirmedPresent is false (no poll has
  // EVER seen it), but the local batch already knows every one of its
  // items finished its own upload attempt - which cannot be true unless
  // the server has already durably applied the deletion.
  const result = resolveTargetOperation({
    targetId: 'op-1',
    operations: [],
    previouslyConfirmedPresent: false,
    localBatchFullySettled: true
  });
  assert.deepEqual(result, { kind: 'confirmed-deleted' }, 'a settled local batch is independent proof of deletion, even with zero prior confirmed sightings');
});

test('being found always wins over settlement-based deletion evidence - the mixed-batch case, where the operation survives because a sibling item was not a duplicate', () => {
  // In a mixed batch, only the duplicate ITEM is deleted; the operation
  // itself survives (and stays active) because the other item is real.
  // The batch still reaches phase 'accepted' (both items finished their
  // own upload attempt) - localBatchFullySettled is true - but the
  // operation must still resolve as found, not deleted.
  const op: Op = { id: 'op-1', status: 'processing' };
  const result = resolveTargetOperation({
    targetId: 'op-1',
    operations: [op],
    previouslyConfirmedPresent: false,
    localBatchFullySettled: true
  });
  assert.deepEqual(result, { kind: 'found', operation: op });
});

// --- advancePollTarget: the full state machine, including reconstruction ---

function initialState(targetId: string | null = null): PollTargetState {
  return { targetId, confirmedTargetId: null, attemptedReconstruction: false };
}

test('a present target is tracked and confirmed, target id preserved for the next tick', () => {
  const op: Op = { id: 'op-1', status: 'queued' };
  const result = advancePollTarget(initialState('op-1'), [op], { localBatchFullySettledId: null, isDismissed: notDismissed });
  assert.equal(result.found, op);
  assert.deepEqual(result.state, { targetId: 'op-1', confirmedTargetId: 'op-1', attemptedReconstruction: false });
});

test('a target absent during legitimate creation lag keeps polling unchanged - no attempt to reconstruct or give up', () => {
  const result = advancePollTarget(initialState('op-1'), [], { localBatchFullySettledId: null, isDismissed: notDismissed });
  assert.equal(result.found, null);
  assert.deepEqual(result.state, initialState('op-1'));
});

test('duplicate-only batch: never found even once, resolves to deleted on the very first poll, and the following tick does not reconstruct into an unrelated operation', () => {
  // tick 1: the operation was deleted before this, the very first, poll
  // ever ran. previouslyConfirmedPresent could not possibly be true yet -
  // only localBatchFullySettledId proves deletion here.
  let state = initialState('op-1');
  const unrelatedNewest: Op = { id: 'op-unrelated-newest', status: 'completed' };
  let result = advancePollTarget(state, [unrelatedNewest], {
    localBatchFullySettledId: 'op-1',
    isDismissed: notDismissed
  });
  assert.equal(result.found, null, 'nothing to report - it was never a real terminal operation, just gone');
  assert.equal(result.state.targetId, null, 'must stop targeting the deleted operation immediately, no arbitrary delay');
  assert.equal(result.state.attemptedReconstruction, true, 'reconstruction must be considered already spent so it cannot fire on the next tick');
  state = result.state;

  // tick 2: targetId is now null. Without the fix, this would fall into
  // the "no known target" reconstruction branch and attach to whatever
  // the newest operation for the requisition happens to be - here, a
  // completely unrelated, unrelated-to-this-upload operation.
  result = advancePollTarget(state, [unrelatedNewest], { localBatchFullySettledId: null, isDismissed: notDismissed });
  assert.equal(result.found, null, 'must not attach to the unrelated newest operation');
  assert.equal(result.state.targetId, null, 'must remain untargeted rather than silently tracking someone else\'s operation');
});

test('a target confirmed present and then missing also blocks reconstruction on the following tick', () => {
  let state: PollTargetState = { targetId: 'op-1', confirmedTargetId: 'op-1', attemptedReconstruction: false };
  const unrelatedNewest: Op = { id: 'op-unrelated-newest', status: 'processing' };
  let result = advancePollTarget(state, [unrelatedNewest], { localBatchFullySettledId: null, isDismissed: notDismissed });
  assert.equal(result.state.targetId, null);
  assert.equal(result.state.attemptedReconstruction, true);
  state = result.state;

  result = advancePollTarget(state, [unrelatedNewest], { localBatchFullySettledId: null, isDismissed: notDismissed });
  assert.equal(result.found, null);
  assert.equal(result.state.targetId, null);
});

test('mixed batch: the surviving item keeps its operation tracked as found and active while the duplicate sibling is simply absent from it, independent of the duplicate\'s own resolution', () => {
  // The operation item list itself is not modeled here (that lives in
  // ResumeOperationSummary.items, unrelated to target resolution) - what
  // matters at this layer is that the operation the surviving item
  // belongs to is found and stays active regardless of localBatchFullySettledId
  // being set (the batch already finished attempting every item,
  // including the duplicate that never made it into this operation's
  // item list at all).
  const survivingOperation: Op = { id: 'op-1', status: 'processing' };
  const result = advancePollTarget(initialState('op-1'), [survivingOperation], {
    localBatchFullySettledId: 'op-1',
    isDismissed: notDismissed
  });
  assert.equal(result.found, survivingOperation, 'the surviving item\'s operation must continue processing independently of its deleted duplicate sibling');
  assert.equal(result.state.targetId, 'op-1', 'must keep tracking it, not treat it as gone');
});

test('no known target and reconstruction not yet attempted recovers the newest operation, unaffected by the deletion-handling change', () => {
  const newest: Op = { id: 'op-newest', status: 'processing' };
  const result = advancePollTarget(initialState(null), [newest], { localBatchFullySettledId: null, isDismissed: notDismissed });
  assert.equal(result.found, newest);
  assert.equal(result.state.targetId, 'op-newest');
  assert.equal(result.state.attemptedReconstruction, true);
});

test('no known target, reconstruction already attempted, and nothing new to track - never reconstructs a second time', () => {
  const state: PollTargetState = { targetId: null, confirmedTargetId: null, attemptedReconstruction: true };
  const newest: Op = { id: 'op-newest', status: 'processing' };
  const result = advancePollTarget(state, [newest], { localBatchFullySettledId: null, isDismissed: notDismissed });
  assert.equal(result.found, null);
  assert.equal(result.state.targetId, null);
});

test('a dismissed newest operation is not reconstructed', () => {
  const newest: Op = { id: 'op-dismissed', status: 'completed' };
  const result = advancePollTarget(initialState(null), [newest], {
    localBatchFullySettledId: null,
    isDismissed: (id) => id === 'op-dismissed'
  });
  assert.equal(result.found, null);
  assert.equal(result.state.targetId, null);
  assert.equal(result.state.attemptedReconstruction, true);
});
