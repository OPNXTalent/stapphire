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
// behaviors this simplified, persistence-first architecture depends
// on. They do not exercise runtime behavior.

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ResumeUpload.tsx'),
  'utf8'
);

test('there is exactly one place that fetches durable résumé-operation state - a single synchronization mechanism', () => {
  const matches = source.match(/fetch\(`\/api\/requisitions\/\$\{requisitionId\}\/operations`/g) || [];
  assert.equal(matches.length, 1, 'expected exactly one fetch call site - no competing polling paths');
});

test('no generation counter or wake-coalescing machinery exists - the simplified design accepts brief visual delay instead of that complexity', () => {
  assert.doesNotMatch(source, /wakeRequestedRef|generation counter|myGeneration/i, 'this architecture explicitly trades instantaneous updates for simplicity - no coalescing/staleness-guard machinery should be needed or present');
});

test('an in-flight fetch is never overlapped - a concurrent trigger is skipped and retried on the next interval, not coalesced into an immediate follow-up', () => {
  const tickMatch = source.match(/async function tick\(\) \{([\s\S]*?)\n    \}\n/);
  assert.ok(tickMatch, 'expected to find tick()');
  assert.match(tickMatch[1], /if \(inFlight\) \{/, 'expected an in-flight guard');
});

test('a failed poll preserves last-known operation state rather than clearing it', () => {
  const catchMatch = source.match(/\} catch \{([\s\S]*?)\n      \} finally \{/);
  assert.ok(catchMatch, 'expected to find the catch block');
  assert.doesNotMatch(catchMatch[1], /setTrackedOperation\(null\)/, 'a transient failure must not clear the tracked operation - the persisted server-side work is not endangered by a failed read, so the UI must not act as if it were');
});

test('a failed poll still keeps polling for a known target - the durable work is not endangered by a temporary read failure', () => {
  const catchMatch = source.match(/\} catch \{([\s\S]*?)\n      \} finally \{/);
  assert.ok(catchMatch);
  assert.match(catchMatch[1], /if \(targetOperationIdRef\.current\) timer = setTimeout/, 'expected polling to continue for a known target even after a fetch failure');
});

test('on mount with no known local batch, one reconstruction attempt recovers the latest persisted operation - not indefinite polling for something that may never appear', () => {
  assert.match(source, /attemptedReconstruction/);
  assert.match(source, /if \(!targetId && attemptedReconstruction\) return;/, 'expected polling to stop once reconstruction has been tried and found nothing, rather than continuing to poll indefinitely merely because the page remains open');
});

test('terminal notification is independent of the polling reschedule decision', () => {
  const tickMatch = source.match(/async function tick\(\) \{([\s\S]*?)\n    \}\n/);
  assert.ok(tickMatch);
  const notificationIndex = tickMatch[1].indexOf('dispatchResumeOperationTerminal');
  const scheduleIndex = tickMatch[1].indexOf('stillUnresolved');
  assert.ok(notificationIndex >= 0 && scheduleIndex >= 0);
  assert.ok(notificationIndex < scheduleIndex, 'terminal notification must occur before the independent scheduling decision');
  assert.match(tickMatch[1], /targetOperationIdRef\.current = null/, 'terminal state must clear the polling target before rendering');
});

test('manual retry deliberately reopens tracking for the same formerly-terminal operation', () => {
  const retryMatch = source.match(/async function retryFailed\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(retryMatch);
  assert.match(retryMatch[1], /terminalNotificationOperationIdsRef\.current\.delete\(trackedOperation\.id\)/);
  assert.match(retryMatch[1], /targetOperationIdRef\.current = trackedOperation\.id/);
  assert.match(retryMatch[1], /restartRef\.current\(\)/);
});

test('upload confirmation is superseded by durable per-item uploaded state, not local batch state alone', () => {
  const match = source.match(/const showUploadConfirmed = [\s\S]*?;/);
  assert.ok(match);
  assert.match(match[0], /allItemsDurablyUploaded/, 'upload confirmation must be derivable from durable, server-confirmed per-item uploaded state - not local batch state alone - so it can render even while local upload promises remain unresolved');
});

test('durable upload confirmation is scoped through the extracted authority resolver, not derived from trackedOperation independent of batch identity', () => {
  const match = source.match(/const allItemsDurablyUploaded = [\s\S]*?;/);
  assert.ok(match, 'expected to find allItemsDurablyUploaded');
  assert.match(match[0], /trackedOperationAuthoritative/, 'durable confirmation must be gated on the operation being proven authoritative for the current context (matches the current batch, or there is no local batch to conflict with) - never computed from trackedOperation alone, which could be a retained, unrelated older operation');
});

test('resolveTrackedOperationAuthority is imported from the extracted, independently-tested authority module, not reimplemented inline', () => {
  assert.match(source, /import \{ resolveTrackedOperationAuthority \} from '@\/lib\/resumeUploadAuthority';/, 'expected the identity/scoping logic to be imported from lib/resumeUploadAuthority.ts, which has its own direct behavioral tests, rather than duplicated inline where it could drift');
});

test('the full operation-progress view (with its Done button) is also scoped by authority, not shown for a retained older operation while an unrelated new batch is uploading', () => {
  const match = source.match(/const showTrackedOperationView = Boolean\(([\s\S]*?)\n  \);/);
  assert.ok(match, 'expected to find showTrackedOperationView');
  assert.match(match[1], /trackedOperationAuthoritative/, 'the full progress/Done view must respect the same authority scoping - otherwise a stale, terminal older operation could keep showing its own Done button while a brand new batch is still uploading');
});

test('the local uploading bridge is forcibly suppressed once durable state confirms uploads are done or the operation is terminal - server truth supersedes local phase unconditionally', () => {
  const match = source.match(/const localUploading = Boolean\(([\s\S]*?)\n  \);/);
  assert.ok(match, 'expected to find localUploading');
  assert.match(match[1], /!allItemsDurablyUploaded/, 'expected local uploading state to be suppressed once durable state confirms all items uploaded');
  assert.match(match[1], /!trackedOperationTerminal/, 'expected local uploading state to be suppressed once the durable operation is terminal, regardless of local phase');
});

test('the durable per-item uploaded field is read into the render logic, not just fetched and ignored', () => {
  assert.match(source, /item\.uploaded/, 'expected the durable uploaded field to actually be used in a render-affecting computation');
});

test('the required "safe to leave" messaging is present once upload is confirmed', () => {
  assert.match(source, /Evaluation continues in the background/, 'expected explicit messaging that evaluation continues without the browser, per the required UX contract');
  assert.match(source, /navigate anywhere in Stapphire/i);
});

test('a distinct checking state is shown while a target operation is known but not yet confirmed, never blank', () => {
  assert.match(source, /showCheckingStatus/);
  assert.match(source, /Checking résumé processing status/);
});

test('the Evaluating animation and Done control are both gated on the tracked operation actually being active', () => {
  assert.match(source, /trackedOperationActive/);
  assert.match(source, /\{trackedOperationActive && \(/, 'expected the animation gated on active state');
  assert.match(source, /\{!trackedOperationActive && <button/, 'expected Done gated on NOT active, so it cannot appear while still active');
});

test('the component unmounting does not endanger durable work - the cleanup only clears local timers/flags, never touches server state', () => {
  const cleanupMatch = source.match(/return \(\) => \{\s*cancelled = true;[\s\S]*?\n    \};/);
  assert.ok(cleanupMatch, 'expected to find the effect cleanup');
  assert.doesNotMatch(cleanupMatch[0], /fetch\(|dismiss|cancel.*operation/i, 'unmount cleanup must only stop this component\'s own local polling, never cancel or otherwise affect the persisted durable operation');
});
