import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This project has no React/DOM testing infrastructure (no
// @testing-library/react, no jsdom) - every other test here covers
// pure, non-React functions directly. Adding that infrastructure to
// behaviorally test CreateRequisitionForm's navigation would be a
// substantial, unrelated addition well beyond this fix's scope. This
// is a narrower, honest regression guard instead: it inspects the
// component's source for the specific pattern that caused the
// reported hang (router.refresh() called immediately after
// router.push() in the same synchronous tick, racing the pending
// navigation), and for the defensive safeguard added alongside the
// actual fix. It does not exercise the component's runtime behavior.

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'CreateRequisitionForm.tsx'),
  'utf8'
);

test('successful submit navigates without a racing router.refresh() call', () => {
  const submitMatch = source.match(/async function submit[\s\S]*?\n  \}/);
  assert.ok(submitMatch, 'expected to find the submit() function');
  const submitBody = submitMatch[0];
  assert.match(submitBody, /router\.push\(`\/requisitions\/\$\{data\.id\}`\)/, 'expected a push to the new requisition on success');
  const pushIndex = submitBody.indexOf('router.push(');
  const afterPush = submitBody.slice(pushIndex);
  assert.doesNotMatch(
    afterPush,
    /router\.refresh\(\)/,
    'router.refresh() must not be called immediately after router.push() on success - this raced the pending navigation and caused the reported stuck processing screen'
  );
});

test('a defensive navigation safeguard exists as a last resort, not the primary mechanism', () => {
  assert.match(source, /navigationSafeguard/, 'expected a named safeguard mechanism');
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?setBusy\(false\)/, 'expected the safeguard to be able to un-stick the busy state');
});

test('processing copy describes saving the requisition, not waiting on Hiring Criteria', () => {
  assert.doesNotMatch(
    source,
    /Generating Hiring Criteria/,
    'processing copy should not imply the page must wait for Hiring Criteria generation, which is now dispatched asynchronously and does not block navigation'
  );
});
