import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// resumeEvaluationOperation.ts imports server-only + supabaseAdmin,
// which initializes eagerly and throws without live credentials -
// confirmed unusable for direct import in this test environment (same
// limitation established in earlier tasks this session). These are
// source-level regression tests for the reconciliation mechanism,
// same pattern as resumeLeaseClassification.test.ts's source-level
// checks and CreateRequisitionForm.test.ts.

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'resumeEvaluationOperation.ts'),
  'utf8'
);

test('successful worker completion invokes reconciliation, after the completion RPC succeeds', () => {
  const successPath = source.match(/if \(completionError\) throw completionError;[\s\S]*?\n  \} catch/);
  assert.ok(successPath, 'expected to find the success path following the completion RPC');
  assert.match(successPath[0], /await reconcileQueuedResumeCapacity\(\)/, 'expected reconciliation to be triggered after a successful completion, since that is what frees a concurrency slot');
});

test('reconciliation is bounded - RECONCILIATION_BATCH_SIZE is exactly 1, matching one freed slot per completion', () => {
  assert.match(source, /const RECONCILIATION_BATCH_SIZE = 1;/, 'the bound must be exactly 1: one completion frees exactly one global concurrency slot, so republishing more would not match actually-freed capacity, and republishing fewer would not guarantee the freed slot gets filled');
});

test('reconciliation failure is caught and logged, never re-thrown - it must not undo an already-successful evaluation completion', () => {
  const fnMatch = source.match(/async function reconcileQueuedResumeCapacity\(\): Promise<void> \{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, 'expected to find reconcileQueuedResumeCapacity');
  const fnBody = fnMatch[1];
  assert.match(fnBody, /try \{/, 'expected the whole function body to be wrapped in try/catch');
  const catchMatch = fnBody.match(/\} catch \(error\) \{([\s\S]*?)\n  \}/);
  assert.ok(catchMatch, 'expected a catch block');
  assert.doesNotMatch(catchMatch[1], /throw/, 'the catch block must only log, never re-throw - this function runs strictly after the triggering item\'s own completion was already persisted successfully, and a reconciliation failure must not retroactively turn that into a failure');
});

test('reconciliation scopes to resume_batch_evaluation operations and queued, available items only', () => {
  const fnMatch = source.match(/async function reconcileQueuedResumeCapacity\(\): Promise<void> \{([\s\S]*?)\n\}/);
  assert.ok(fnMatch);
  assert.match(fnMatch[1], /operation_type', 'resume_batch_evaluation'/);
  assert.match(fnMatch[1], /'status', 'queued'/);
  assert.match(fnMatch[1], /lte\('available_at'/);
});

test('reconciliation republishes through the existing enqueueResumeEvaluation call, not a new evaluator path', () => {
  const fnMatch = source.match(/async function reconcileQueuedResumeCapacity\(\): Promise<void> \{([\s\S]*?)\n\}/);
  assert.ok(fnMatch);
  assert.match(fnMatch[1], /operationQueue\.enqueueResumeEvaluation\(/, 'expected reconciliation to reuse the existing queue enqueue function, not introduce a new one');
});

test('the claim RPC remains the sole authority claimed items route through - reconciliation only enqueues, it does not claim or evaluate directly', () => {
  const fnMatch = source.match(/async function reconcileQueuedResumeCapacity\(\): Promise<void> \{([\s\S]*?)\n\}/);
  assert.ok(fnMatch);
  assert.doesNotMatch(fnMatch[1], /claim_phase1_resume_operation_item/, 'reconciliation must not call the claim RPC itself - it only republishes a queue message, which re-enters the existing worker path and existing claim RPC exactly like any other delivery');
});

test('the resume-evaluation queue topic and worker entrypoint are unchanged by this fix', () => {
  const queueRoute = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'api', 'queues', 'resume-evaluation', 'route.ts'),
    'utf8'
  );
  assert.match(queueRoute, /processResumeEvaluationOperationItem/, 'expected the same single worker entrypoint to still be used - no second evaluator path introduced');
});
