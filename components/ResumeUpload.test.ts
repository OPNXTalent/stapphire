import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This project has no React/DOM testing infrastructure (no
// @testing-library/react, no jsdom) - every other test here covers
// pure, non-React functions directly, and CreateRequisitionForm.test.ts
// established the same source-level regression pattern used here.
// These tests inspect the component's source for the specific
// behaviors this single-flight controller architecture depends on.
// They do not exercise runtime behavior.

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ResumeUpload.tsx'),
  'utf8'
);

test('there is exactly one place that calls fetch on the operations endpoint - a single polling authority', () => {
  const matches = source.match(/fetch\(`\/api\/requisitions\/\$\{requisitionId\}\/operations`/g) || [];
  assert.equal(matches.length, 1, 'expected exactly one fetch call site for durable résumé-operation state, not multiple competing polling paths');
});

test('single-flight guarantee: a trigger that arrives while a request is in flight only sets a wake flag, it never starts a second request', () => {
  const runOnceMatch = source.match(/async function runOnce\(reconstruct: boolean\) \{([\s\S]*?)\n    \}\n/);
  assert.ok(runOnceMatch, 'expected to find runOnce');
  const body = runOnceMatch[1];
  const guardIndex = body.indexOf('if (inFlightRef.current)');
  assert.ok(guardIndex >= 0, 'expected an in-flight guard at the top of runOnce');
  const fetchIndex = body.indexOf('await fetch(');
  assert.ok(guardIndex < fetchIndex, 'the in-flight guard must be checked before the fetch call, so an overlapping trigger can never reach a second fetch');
  assert.match(body.slice(guardIndex, fetchIndex), /wakeRequestedRef\.current = true/, 'expected the guard to record a pending wake rather than proceed');
});

test('a completed request re-runs immediately if a wake was requested while it was in flight - coalesced, not parallel', () => {
  const finallyMatch = source.match(/\} finally \{([\s\S]*?)\n      \}\n    \}/);
  assert.ok(finallyMatch, 'expected to find the finally block');
  assert.match(finallyMatch[1], /if \(wakeRequestedRef\.current\)/, 'expected the finally block to check for a pending wake');
  assert.match(finallyMatch[1], /void runOnce\(/, 'expected exactly one follow-up runOnce call when a wake was pending - not a competing second request while the first was still active');
});

test('operationId changes route through the single wake mechanism, not a separate polling path', () => {
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*wakeRef\.current\(currentLocalBatch\?\.operationId \|\| null\);\s*\}, \[currentLocalBatch\?\.operationId\]\);/,
    'expected the operationId-watching effect to do nothing but call wakeRef.current() - it must not fetch directly (confirmed separately by the single-fetch-site test above)'
  );
});

test('no generation counter variable exists - the single-flight design structurally prevents overlapping requests instead of coordinating around them', () => {
  assert.doesNotMatch(
    source,
    /let generation = 0|myGeneration/,
    'a generation/staleness counter variable was the previous design\'s defensive mechanism for coordinating overlapping requests; under single-flight, overlapping requests cannot occur, so this coordination mechanism should not be retained as actual code (a comment explaining the removal is fine)'
  );
});

test('the controller implements the required idle/checking/active/terminal state machine', () => {
  assert.match(source, /type ControllerPhase = 'idle' \| 'checking' \| 'active' \| 'terminal';/);
});

test('polling stops once terminal - no reschedule happens when the phase is terminal', () => {
  const finallyMatch = source.match(/\} finally \{([\s\S]*?)\n      \}\n    \}/);
  assert.ok(finallyMatch);
  assert.match(finallyMatch[1], /phaseRef\.current !== 'terminal'/, 'expected the reschedule to be explicitly conditioned on not being terminal');
});

test('a transient fetch failure preserves last-known operation state rather than clearing it', () => {
  const catchMatch = source.match(/\} catch \{([\s\S]*?)\n      \} finally \{/);
  assert.ok(catchMatch, 'expected to find the catch block');
  assert.doesNotMatch(catchMatch[1], /setTrackedOperation\(null\)/, 'a poll failure must not clear the tracked operation - last-known state must survive transient uncertainty');
});

test('upload confirmation is derived from local batch state only, independent of the polling controller entirely', () => {
  const match = source.match(/const showUploadConfirmed = [\s\S]*?;/);
  assert.ok(match);
  assert.doesNotMatch(match[0], /trackedOperation|phase ===/, 'upload confirmation must come from confirmed upload persistence (ResumeUploadManager\'s ownership) only, never from the durable-operation polling controller\'s state');
});

test('a distinct checking state is shown while a target operation is known but not yet confirmed, never blank', () => {
  assert.match(source, /phase === 'checking'/);
  assert.match(source, /Checking résumé processing status/);
});

test('the Evaluating animation and Done control are both gated on the state machine phase, not a separately-derived active flag', () => {
  assert.match(source, /phase === 'active' && \(/, 'expected the animation gated on phase===active');
  assert.match(source, /phase === 'terminal' && <button/, 'expected Done gated on phase===terminal, so it cannot appear while still active');
});

test('router.refresh() does not participate in polling scheduling', () => {
  const refreshLine = source.match(/if \(lastProgress\.current[\s\S]*?router\.refresh\(\);\s*\n\s*lastProgress\.current = signature;/);
  assert.ok(refreshLine, 'expected router.refresh() to be a pure side effect around the signature check');
  // Reschedule logic lives entirely in the finally block, structurally
  // separate from this signature-check/refresh code path.
  const finallyMatch = source.match(/\} finally \{([\s\S]*?)\n      \}\n    \}/);
  assert.ok(finallyMatch);
  assert.doesNotMatch(finallyMatch[1], /router\.refresh/, 'router.refresh() must not appear in the scheduling logic itself');
});
