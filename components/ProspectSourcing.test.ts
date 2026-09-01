import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const component = readFileSync(join(directory, 'ProspectSourcing.tsx'), 'utf8');
const searchRoute = readFileSync(join(directory, '..', 'app', 'api', 'requisitions', '[id]', 'prospects', 'route.ts'), 'utf8');
const evaluationRoute = readFileSync(join(directory, '..', 'app', 'api', 'requisitions', '[id]', 'prospects', '[prospectId]', 'evaluation', 'route.ts'), 'utf8');

test('locked shortlist exposes only the prospect name, preliminary score, and explicit QC action', () => {
  assert.match(component, /<strong>\{prospect\.full_name\}<\/strong>/);
  assert.match(component, /\{prospect\.preliminary_score\}/);
  assert.match(component, /View evaluation · 1 QC/);
  assert.doesNotMatch(component, /prospect\.headline/);
  assert.doesNotMatch(component, /prospect\.location/);
  assert.match(searchRoute, /prospect\.evaluation \? prospect/);
  assert.match(searchRoute, /sources: \[\]/);
});

test('search requires an applied Hiring Criteria basis and does not perform QC billing', () => {
  assert.match(searchRoute, /basis\.basisType !== 'hiring_criteria'/);
  assert.doesNotMatch(searchRoute, /credits_remaining|consume_qc/);
});

test('evaluation charges only through the atomic persistence RPC after generation', () => {
  const generation = evaluationRoute.indexOf('await evaluateProspect');
  const billing = evaluationRoute.indexOf("rpc('consume_qc_and_unlock_prospect_evaluation_v1'");
  assert.ok(generation >= 0 && billing > generation);
  assert.match(evaluationRoute, /No QC was used/);
});
