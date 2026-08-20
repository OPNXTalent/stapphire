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
// behaviors this repair depends on. They do not exercise runtime
// behavior.

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ResumeUpload.tsx'),
  'utf8'
);

test('the 8-second bridgeExpired concept has been removed entirely - an unresolved handoff must never go silent on a timer', () => {
  assert.doesNotMatch(source, /bridgeExpired/, 'bridgeExpired (or any equivalent timed auto-hide) must not exist - replaced by a persistent "checking status" state instead of a timeout that hides active/unknown work');
});

test('showUploadConfirmed is derived from local batch accepted-upload counts only, not operationForCurrentBatch or poll success', () => {
  const match = source.match(/const showUploadConfirmed = [\s\S]*?;/);
  assert.ok(match, 'expected to find showUploadConfirmed');
  assert.doesNotMatch(match[0], /operationForCurrentBatch/, 'upload confirmation must not depend on the durable operation having been found by a poll yet');
});

test('a checking-status state exists for when a known operation has not yet been observed by a poll', () => {
  assert.match(source, /showCheckingStatus/, 'expected a distinct state for "we know an operation exists but have not confirmed its status yet"');
  assert.match(source, /Checking résumé processing status/, 'expected the specific required copy');
});

test('poll failures are tracked and surfaced, not silent', () => {
  assert.match(source, /pollUnavailable/, 'expected poll failure to be tracked in state so it can be surfaced (e.g. "Reconnecting...") rather than silently doing nothing');
});

test('a failed poll does not clear previously known operations state', () => {
  const catchBlock = source.match(/\} catch \{([\s\S]*?)\} finally \{/);
  assert.ok(catchBlock, 'expected to find the poll function\'s catch block');
  assert.doesNotMatch(catchBlock[1], /setOperations/, 'a poll failure must preserve the last-known durable operation state, not reset it to empty');
});

test('polling reschedules unconditionally in a finally block, not gated on response content', () => {
  const finallyBlock = source.match(/\} finally \{([\s\S]*?)\n {6}\}/);
  assert.ok(finallyBlock, 'expected to find the poll function\'s finally block');
  assert.match(finallyBlock[1], /setTimeout\(poll, 2500\)/, 'expected an unconditional reschedule in finally');
  assert.doesNotMatch(finallyBlock[1], /isActiveOperation/, 'rescheduling must not be conditioned on whether any operation is currently active - that is exactly the self-termination bug this fix removes');
});

test('a monotonic generation counter guards against a stale, late-resolving poll clobbering a newer one', () => {
  assert.match(source, /generation/, 'expected a generation counter or equivalent staleness guard');
  assert.match(source, /myGeneration !== generation/, 'expected stale poll results (an older, later-resolving invocation) to be discarded rather than allowed to overwrite newer state or reschedule');
});

test('the Evaluating animation remains gated on the operation actually being active (stops on terminal)', () => {
  assert.match(source, /visibleOperationActive/, 'expected an explicit active-state flag');
  const animationBlock = source.match(/\{visibleOperationActive && \(([\s\S]*?)\)\}/);
  assert.ok(animationBlock, 'expected the StapphireProcessing evaluating animation to be gated on visibleOperationActive');
  assert.match(animationBlock[1], /Evaluating résumés/);
});

test('the Done control only appears once the operation is confirmed terminal, never while still active', () => {
  const doneBlock = source.match(/\{!visibleOperationActive && <button[\s\S]*?Done<\/button>\}/);
  assert.ok(doneBlock, 'expected Done to be conditionally rendered on !visibleOperationActive - dismissing an actively processing operation would hide its progress UI while work is still genuinely ongoing');
});
