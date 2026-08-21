import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTrackedOperationAuthority } from './resumeUploadAuthority.ts';

// Direct behavioral coverage of the exact PM-specified regression
// scenario, using the real function the component actually calls -
// not a source-text regex check, and not a re-implementation that
// could drift from the real logic.
//
// old terminal operation A present -> start new batch B -> B visibly
// shows creating/uploading -> B receives operationId -> B's own
// durable uploaded state supersedes local transfer -> B reaches
// terminal -> all active animation disappears.

test('scenario: an old terminal operation A does not authorize a new local batch B before B has an operationId', () => {
  const operationA = { id: 'operation-A' }; // terminal, retained in trackedOperation state
  const batchB = { operationId: null }; // B just started, no operationId assigned yet

  const result = resolveTrackedOperationAuthority(batchB, operationA);

  assert.equal(result.matchesCurrentBatch, false, 'A must not be considered a match for B - B has no operationId at all yet');
  assert.equal(result.authoritative, false, 'A must not be authoritative for B - this is exactly what would let B\'s local creating/uploading state be incorrectly suppressed by A\'s stale terminal status');
});

test('scenario: still not authoritative once B has an operationId but the fetch has not yet confirmed a matching operation', () => {
  const operationA = { id: 'operation-A' }; // still retained, not yet replaced
  const batchB = { operationId: 'operation-B' }; // B now has its own operationId

  const result = resolveTrackedOperationAuthority(batchB, operationA);

  assert.equal(result.matchesCurrentBatch, false, 'A is not B - ids differ');
  assert.equal(result.authoritative, false, 'A must remain non-authoritative for B even after B has an operationId, until the tracked operation is confirmed to actually be B\'s');
});

test('scenario: authoritative once trackedOperation is confirmed to be B\'s own operation', () => {
  const batchB = { operationId: 'operation-B' };
  const trackedOperationB = { id: 'operation-B' }; // the poll has now found and confirmed B's own operation

  const result = resolveTrackedOperationAuthority(batchB, trackedOperationB);

  assert.equal(result.matchesCurrentBatch, true);
  assert.equal(result.authoritative, true, 'once trackedOperation is proven to be B\'s own operation, it must supersede local transfer state - this is the same B instance throughout, only its identity relative to trackedOperation changes across the scenario');
});

test('scenario: remains authoritative once B (now confirmed) reaches terminal - authority is about identity, not liveness', () => {
  const batchB = { operationId: 'operation-B' };
  const trackedOperationBTerminal = { id: 'operation-B' }; // same id, now terminal - identity resolution doesn't care about status

  const result = resolveTrackedOperationAuthority(batchB, trackedOperationBTerminal);

  assert.equal(result.matchesCurrentBatch, true);
  assert.equal(result.authoritative, true, 'authority is purely an identity/scoping question - whether the operation is active or terminal is a separate concern (isActiveOperation), layered on top of this once authority is established');
});

test('reconstruction after navigation (no local batch at all) remains valid and unaffected by the scoping fix', () => {
  const reconstructedOperation = { id: 'operation-reconstructed' };

  const result = resolveTrackedOperationAuthority(null, reconstructedOperation);

  assert.equal(result.matchesCurrentBatch, false, 'there is no local batch to match against');
  assert.equal(result.authoritative, true, 'with no local batch to conflict with, the reconstructed operation must remain authoritative - this case must work exactly as before the scoping fix');
});

test('no local batch and nothing reconstructed yet: authoritative is true (nothing to conflict with), but callers must still separately check trackedOperation itself before using its data', () => {
  const result = resolveTrackedOperationAuthority(null, null);
  assert.equal(result.authoritative, true, 'with no local batch, there is nothing for a null trackedOperation to conflict with - "authoritative" answers whether it is SAFE to use trackedOperation if it exists, not whether it exists');
  assert.equal(result.matchesCurrentBatch, false);
});
