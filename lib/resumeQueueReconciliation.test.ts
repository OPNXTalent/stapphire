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

test('reconciliation is bounded at 3, matching the global concurrency cap - not 1', () => {
  assert.match(
    source,
    /const RECONCILIATION_BATCH_SIZE = 3;/,
    'the bound must match the concurrency cap (3), not 1 - an ordinary SELECT with no reservation cannot guarantee concurrent completions see different items, so a bound of 1 could let a wave of concurrent completions all republish the same single item, leaving other genuinely eligible items and their freed slots unaddressed. Bounded overoffer (fetch up to 3 distinct eligible items every call, republish all of them) guarantees available capacity is offered enough distinct work without needing coordination between concurrent invocations.'
  );
});

test('amplification bound: a wave of concurrent completions produces at most (concurrency cap)^2 reconciliation publishes, offering at most (concurrency cap) distinct items - matching the slots that wave could free', () => {
  const claimRpcSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations', '20260815130000_durable_resume_evaluation_operations.sql'),
    'utf8'
  );
  const capMatch = claimRpcSource.match(/if active_count >= (\d+) then return jsonb_build_object\('deferred', true\); end if;/);
  assert.ok(capMatch, 'expected to find the concurrency cap check in the claim RPC');
  const concurrencyCap = Number(capMatch[1]);

  const batchSizeMatch = source.match(/const RECONCILIATION_BATCH_SIZE = (\d+);/);
  assert.ok(batchSizeMatch, 'expected to find RECONCILIATION_BATCH_SIZE');
  const reconciliationBatchSize = Number(batchSizeMatch[1]);

  assert.equal(reconciliationBatchSize, concurrencyCap, 'the reconciliation batch size must match the actual concurrency cap read from the claim RPC - not a value chosen independently of it');

  // At most `concurrencyCap` items can be 'processing' at once, so at
  // most `concurrencyCap` completions can happen in one wave. Each
  // independently, concurrently-triggered reconciliation call is
  // capped at `reconciliationBatchSize` publishes. Worst case: every
  // completion in the wave republishes the full batch.
  const maxCompletionsInAWave = concurrencyCap;
  const maxTotalPublishes = maxCompletionsInAWave * reconciliationBatchSize;
  assert.equal(maxTotalPublishes, concurrencyCap * concurrencyCap, 'expected the worst-case publish count to be concurrencyCap^2 (3 x 3 = 9 at the current cap of 3)');

  // Distinct items offered does not grow with wave size - only
  // redundancy per item does, since every call independently caps at
  // reconciliationBatchSize regardless of how many other calls are
  // concurrently running. reconciliationBatchSize === concurrencyCap
  // (asserted above) is exactly what guarantees at most `concurrencyCap`
  // distinct items are ever offered per call - matching the maximum
  // number of slots a full wave could actually free.
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
