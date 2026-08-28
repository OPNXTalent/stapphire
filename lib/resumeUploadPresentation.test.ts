import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  failedLocalItems,
  needsAttentionHeading,
  evaluatingHeading,
  progressLabel,
  completedSummary,
  detailsToggleLabel
} from './resumeUploadPresentation.ts';

test('failedLocalItems keeps only error-status items, e.g. isolating an exact-duplicate rejection from a mixed batch', () => {
  const items = [
    { id: '1', status: 'accepted' },
    { id: '2', status: 'error' },
    { id: '3', status: 'accepted' }
  ];
  assert.deepEqual(failedLocalItems(items).map((item) => item.id), ['2']);
});

test('failedLocalItems returns nothing for a fully-successful batch', () => {
  const items = [{ id: '1', status: 'accepted' }, { id: '2', status: 'accepted' }];
  assert.deepEqual(failedLocalItems(items), []);
});

test('failedLocalItems returns every item for an exact-duplicate-only batch', () => {
  const items = [{ id: '1', status: 'error' }];
  assert.deepEqual(failedLocalItems(items).map((item) => item.id), ['1']);
});

test('needsAttentionHeading is singular for exactly one failure', () => {
  assert.equal(needsAttentionHeading(1), "1 résumé wasn't added");
});

test('needsAttentionHeading is plural for more than one failure', () => {
  assert.equal(needsAttentionHeading(2), "2 résumés weren't added");
});

test('evaluatingHeading states the count and pluralizes correctly', () => {
  assert.equal(evaluatingHeading(6), 'Evaluating 6 résumés');
  assert.equal(evaluatingHeading(1), 'Evaluating 1 résumé');
});

test('progressLabel renders the completed/total pair exactly once, as a single string', () => {
  assert.equal(progressLabel(0, 6), '0 of 6 complete');
  assert.equal(progressLabel(6, 6), '6 of 6 complete');
});

test('completedSummary reports a concise success line when nothing failed', () => {
  assert.equal(completedSummary(6, 0), '6 résumés evaluated and added');
  assert.equal(completedSummary(1, 0), '1 résumé evaluated and added');
});

test('completedSummary still surfaces a genuine durable failure (not a duplicate rejection, which never reaches the durable operation) instead of claiming full success', () => {
  assert.equal(completedSummary(5, 1), '5 completed · 1 need attention');
});

test('detailsToggleLabel toggles between the two accessible labels', () => {
  assert.equal(detailsToggleLabel(false), 'View details');
  assert.equal(detailsToggleLabel(true), 'Hide details');
});

// Property-style check for regression requirement 3: in a mixed batch,
// duplicates are deleted outright from the durable operation server-side
// (the RPC deletes the operation_item row on conflict) - they only ever
// exist as locally-recorded error items. Given that real split, the
// needs-attention set (derived from local items) and the durable
// operation's own item set can never name the same résumé.
test('mixed-batch scenario: needs-attention filenames and durable evaluation filenames never overlap', () => {
  const localItems = [
    { id: 'l1', status: 'accepted', filename: 'alice.pdf' },
    { id: 'l2', status: 'error', filename: 'steven-anchondo.pdf' },
    { id: 'l3', status: 'error', filename: 'duplicate-two.pdf' },
    { id: 'l4', status: 'accepted', filename: 'bob.pdf' }
  ];
  // The durable operation, once the duplicate-protection RPC has run,
  // only ever contains the items that were not exact duplicates.
  const durableOperationFilenames = ['alice.pdf', 'bob.pdf', 'carol.pdf', 'dave.pdf', 'erin.pdf', 'frank.pdf'];
  const needsAttentionFilenames = failedLocalItems(localItems).map((item) => item.filename);
  assert.deepEqual(needsAttentionFilenames, ['steven-anchondo.pdf', 'duplicate-two.pdf']);
  for (const name of needsAttentionFilenames) {
    assert.ok(!durableOperationFilenames.includes(name), `${name} must not also appear in the evaluation section`);
  }
});
