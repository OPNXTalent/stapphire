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
// component's source for the specific patterns this fix and its PM
// correction depend on. It does not exercise the component's runtime
// behavior.

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'CreateRequisitionForm.tsx'),
  'utf8'
);

function submitBody(): string {
  const submitMatch = source.match(/async function submit[\s\S]*?\n  \}\n/);
  assert.ok(submitMatch, 'expected to find the submit() function');
  return submitMatch[0];
}

test('successful submit navigates without a racing router.refresh() call', () => {
  const body = submitBody();
  assert.match(body, /router\.push\(destination\)/, 'expected a push to the known destination on success');
  const pushIndex = body.indexOf('router.push(');
  const afterPush = body.slice(pushIndex);
  assert.doesNotMatch(
    afterPush,
    /router\.refresh\(\)/,
    'router.refresh() must not be called immediately after router.push() on success - this raced the pending navigation and caused the reported stuck processing screen'
  );
});

test('the navigation safeguard is established only after the POST succeeds, never before or during the request', () => {
  const body = submitBody();
  const fetchIndex = body.indexOf('await fetch(');
  const responseOkIndex = body.indexOf('if (!response.ok)');
  const pushIndex = body.indexOf('router.push(');
  const safeguardAssignIndex = body.indexOf('navigationSafeguard.current = setTimeout');
  assert.ok(fetchIndex >= 0 && responseOkIndex >= 0 && pushIndex >= 0 && safeguardAssignIndex >= 0, 'expected all four markers to be present');
  // The safeguard must be assigned strictly after the request is
  // known to have succeeded and after navigation was initiated - not
  // before the fetch, and not between fetch and the response.ok
  // check, where a slow API response would otherwise let the timer
  // fire while the create request is still in flight, re-enabling the
  // form and risking a duplicate requisition being created.
  assert.ok(safeguardAssignIndex > fetchIndex, 'safeguard must not be set up before the fetch call');
  assert.ok(safeguardAssignIndex > responseOkIndex, 'safeguard must not be set up before the response is confirmed ok');
  assert.ok(safeguardAssignIndex > pushIndex, 'safeguard must be set up after router.push(), once the destination is known and navigation has been initiated');
});

test("the safeguard's fallback hard-navigates instead of resetting the form, so it cannot enable a duplicate submission", () => {
  const body = submitBody();
  const timeoutMatch = body.match(/navigationSafeguard\.current = setTimeout\(\(\) => \{([\s\S]*?)\}, 15000\);/);
  assert.ok(timeoutMatch, 'expected the safeguard setTimeout callback');
  const callbackBody = timeoutMatch[1];
  assert.match(callbackBody, /window\.location\.href = destination/, 'fallback should hard-navigate to the known, already-created requisition URL');
  assert.doesNotMatch(callbackBody, /setBusy\(false\)/, 'fallback must not re-enable the form - that would permit a duplicate requisition create for what the user experiences as one submission');
  assert.doesNotMatch(callbackBody, /submitting\.current = false/, 'fallback must not reset the submission guard - same duplicate-submission reasoning');
});

test('processing copy describes saving the requisition, not waiting on Hiring Criteria', () => {
  assert.doesNotMatch(
    source,
    /Generating Hiring Criteria/,
    'processing copy should not imply the page must wait for Hiring Criteria generation, which is now dispatched asynchronously and does not block navigation'
  );
});
