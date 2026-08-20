import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyNullClaim } from './resumeLeaseClassification.ts';

// classifyNullClaim is the pure decision logic behind the crash-recovery
// fix: when claim_phase1_resume_operation_item returns a plain null, it
// could mean either "genuinely terminal/missing, safe no-op" or "still
// processing under another worker's unexpired DB lease, must defer" -
// these are indistinguishable from the RPC's return value alone, which
// is exactly the second-order risk introduced by making queue
// visibilityTimeoutSeconds (60s) shorter than LEASE_SECONDS (360s).

test('early duplicate delivery during a live DB lease is deferred, not acknowledged', () => {
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const result = classifyNullClaim({ status: 'processing', lease_expires_at: fiveMinutesFromNow });
  assert.equal(result, 'defer', 'an item still processing under an unexpired lease must defer, not be treated as a safe no-op');
});

test('completed items remain safe no-ops', () => {
  assert.equal(classifyNullClaim({ status: 'completed', lease_expires_at: null }), 'noop');
});

test('failed items remain safe no-ops', () => {
  assert.equal(classifyNullClaim({ status: 'failed', lease_expires_at: null }), 'noop');
});

test('cancelled items remain safe no-ops', () => {
  assert.equal(classifyNullClaim({ status: 'cancelled', lease_expires_at: null }), 'noop');
});

test('missing items (lookup returned nothing) remain safe no-ops', () => {
  assert.equal(classifyNullClaim(null), 'noop');
});

test('an item processing with an already-expired lease is not deferred by this classification - the claim RPC is authoritative for reclaiming it, not the queue-side disposition', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  assert.equal(classifyNullClaim({ status: 'processing', lease_expires_at: fiveMinutesAgo }), 'noop');
});

test('processResumeEvaluationOperationItem source wires the disambiguation into the null-claim path, not just a bare return', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'resumeEvaluationOperation.ts'),
    'utf8'
  );
  const nullClaimBlock = source.match(/if \(!item\) \{[\s\S]*?\n  \}/);
  assert.ok(nullClaimBlock, 'expected to find the null-claim handling block');
  assert.match(nullClaimBlock[0], /classifyNullClaim/, 'expected the null-claim path to call classifyNullClaim rather than unconditionally returning');
  assert.match(nullClaimBlock[0], /DeferredResumeOperationError/, 'expected the null-claim path to be able to throw DeferredResumeOperationError when deferral is warranted');
});

test('queue concurrency deferral still uses the intended retry path (unchanged by this fix)', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'api', 'queues', 'resume-evaluation', 'route.ts'),
    'utf8'
  );
  assert.match(source, /DeferredResumeOperationError\)\s*return\s*\{\s*afterSeconds:\s*10\s*\}/, 'DeferredResumeOperationError must still map to a 10s retry - both the original concurrency-cap deferral and the new lease-safety deferral share this one path, by design (no second evaluator path)');
});

test('the DB claim RPC can still reclaim an item whose lease has genuinely expired', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations', '20260815130000_durable_resume_evaluation_operations.sql'),
    'utf8'
  );
  assert.match(
    source,
    /selected_item\.status = 'processing' and selected_item\.lease_expires_at < now\(\)/,
    'expected the claim RPC to still contain the expired-lease reclaim condition - this fix does not bypass or alter DB lease authority'
  );
});
