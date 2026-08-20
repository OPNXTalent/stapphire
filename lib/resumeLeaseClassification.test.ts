import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyNullClaim } from './resumeLeaseClassification.ts';

// classifyNullClaim is the pure decision logic behind the crash-recovery
// fix: when claim_phase1_resume_operation_item returns a plain null, it
// could mean either "genuinely terminal/missing, safe no-op" or "still
// processing, must defer" - these are indistinguishable from the RPC's
// return value alone. Disposition is status-based ONLY: lease_expires_at
// is never compared against "now" here, since the follow-up lookup is a
// separate round trip after the claim RPC call, and the lease could
// expire in that exact gap (a TOCTOU race). Any 'processing' item defers
// unconditionally, regardless of its lease_expires_at value; the next
// delivery re-enters the claim RPC, which remains the sole, atomic
// authority for whether a lease is active, expired-and-reclaimable, or
// the item has since reached a terminal state.

test('processing with a future (unexpired) lease defers', () => {
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  assert.equal(classifyNullClaim({ status: 'processing', lease_expires_at: fiveMinutesFromNow }), 'defer');
});

test('processing with an expired lease ALSO defers - the classifier must not reclaim it itself', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  assert.equal(
    classifyNullClaim({ status: 'processing', lease_expires_at: fiveMinutesAgo }),
    'defer',
    'an expired lease must still defer to the next delivery re-entering the claim RPC, not be treated as safe to acknowledge here'
  );
});

test('processing with a null lease_expires_at defers', () => {
  assert.equal(classifyNullClaim({ status: 'processing', lease_expires_at: null }), 'defer');
});

test('processing with lease_expires_at entirely omitted still defers (status alone decides)', () => {
  assert.equal(classifyNullClaim({ status: 'processing' }), 'defer');
});

test('completed items are safe no-ops', () => {
  assert.equal(classifyNullClaim({ status: 'completed', lease_expires_at: null }), 'noop');
});

test('failed items are safe no-ops', () => {
  assert.equal(classifyNullClaim({ status: 'failed', lease_expires_at: null }), 'noop');
});

test('cancelled items are safe no-ops', () => {
  assert.equal(classifyNullClaim({ status: 'cancelled', lease_expires_at: null }), 'noop');
});

test('missing items (lookup returned nothing) are safe no-ops', () => {
  assert.equal(classifyNullClaim(null), 'noop');
});

test('classifyNullClaim never references lease_expires_at in its decision logic (source-level guard against reintroducing the race)', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'resumeLeaseClassification.ts'),
    'utf8'
  );
  const bodyMatch = source.match(/\): NullClaimDisposition \{([\s\S]*?)\n\}/);
  assert.ok(bodyMatch, 'expected to find the body of classifyNullClaim, after its parameter type annotation');
  assert.doesNotMatch(
    bodyMatch[1],
    /lease_expires_at/,
    'the decision logic (function body, not the accepted parameter shape) must not reference lease_expires_at at all - comparing it against "now" client-side reintroduces the TOCTOU race between the claim RPC call and this follow-up lookup'
  );
});

test('processResumeEvaluationOperationItem source wires the disambiguation into the null-claim path', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'resumeEvaluationOperation.ts'),
    'utf8'
  );
  const nullClaimBlock = source.match(/if \(!item\) \{[\s\S]*?\n  \}/);
  assert.ok(nullClaimBlock, 'expected to find the null-claim handling block');
  assert.match(nullClaimBlock[0], /classifyNullClaim/, 'expected the null-claim path to call classifyNullClaim rather than unconditionally returning');
  assert.match(nullClaimBlock[0], /DeferredResumeOperationError/, 'expected the null-claim path to be able to throw DeferredResumeOperationError when deferral is warranted');
});

test('the DB claim RPC remains authoritative for expired-lease reclamation (unchanged by this fix)', () => {
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

test('queue concurrency deferral still uses the intended 10s retry path (unchanged by this fix)', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'api', 'queues', 'resume-evaluation', 'route.ts'),
    'utf8'
  );
  assert.match(
    source,
    /DeferredResumeOperationError\)\s*return\s*\{\s*afterSeconds:\s*10\s*\}/,
    'DeferredResumeOperationError must still map to a 10s retry - both the original concurrency-cap deferral and the lease-safety deferral share this one path, by design (no second evaluator path)'
  );
});
