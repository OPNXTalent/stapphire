import assert from 'node:assert/strict';
import test from 'node:test';
import { observedScarcityLevel, provisionalUnicornSummary } from './prospectMarketRead.ts';

test('all search paths plus a meaningful zero-clearance sample elevates a live run to UNICORN', () => {
  assert.equal(observedScarcityLevel({ totalTracks: 5, completedTracks: 5, reviewed: 29, qualified: 0 }, 'COMPETITIVE', false), 'UNICORN');
});

test('a partial live search keeps its preliminary market read', () => {
  assert.equal(observedScarcityLevel({ totalTracks: 5, completedTracks: 3, reviewed: 18, qualified: 0 }, 'COMPETITIVE', false), 'COMPETITIVE');
});

test('a tiny live sample does not earn unicorn status merely because discovery paths finished', () => {
  assert.equal(observedScarcityLevel({ totalTracks: 5, completedTracks: 5, reviewed: 6, qualified: 0 }, 'SCARCE', false), 'SCARCE');
});

test('a completed zero-clearance run is classified as UNICORN', () => {
  assert.equal(observedScarcityLevel({ totalTracks: 5, completedTracks: 5, reviewed: 10, qualified: 0 }, 'COMPETITIVE', true), 'UNICORN');
});

test('terminal low clearance remains SCARCE rather than UNICORN when someone clears', () => {
  assert.equal(observedScarcityLevel({ totalTracks: 5, completedTracks: 5, reviewed: 30, qualified: 2 }, 'COMPETITIVE', true), 'SCARCE');
});

test('provisional copy is explicit that unicorn means difficult to find, not nonexistent', () => {
  const summary = provisionalUnicornSummary(29, 5);
  assert.match(summary, /0 of 29/);
  assert.match(summary, /5 still under review/);
  assert.match(summary, /does not mean no qualified person exists/i);
  assert.match(summary, /exceptionally difficult to identify/i);
});
