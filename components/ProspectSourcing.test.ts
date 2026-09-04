import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const component = readFileSync(join(directory, 'ProspectSourcing.tsx'), 'utf8');
const searchRoute = readFileSync(join(directory, '..', 'app', 'api', 'requisitions', '[id]', 'prospects', 'route.ts'), 'utf8');
const evaluationRoute = readFileSync(join(directory, '..', 'app', 'api', 'requisitions', '[id]', 'prospects', '[prospectId]', 'evaluation', 'route.ts'), 'utf8');
const sourcingEngine = readFileSync(join(directory, '..', 'lib', 'prospectSourcing.ts'), 'utf8');
const historyPanel = readFileSync(join(directory, 'ProspectSearchHistory.tsx'), 'utf8');
const workspacePanel = readFileSync(join(directory, 'WorkspacePanel.tsx'), 'utf8');

test('locked shortlist exposes name, location, sourcing fit, score, and explicit QC action', () => {
  assert.match(component, /<strong>\{prospect\.full_name\}<\/strong>/);
  assert.match(component, /\{prospect\.preliminary_score\}/);
  assert.match(component, /View evaluation · 1 QC/);
  assert.doesNotMatch(component, /prospect\.headline/);
  assert.match(component, /prospect\.location/);
  assert.match(component, /prospect\.sourcing_fit/);
  assert.match(searchRoute, /prospect\.evaluation \? prospect/);
  assert.match(searchRoute, /sources: \[\]/);
});

test('search requires an applied Hiring Criteria basis and does not perform QC billing', () => {
  assert.match(searchRoute, /basis\.basisType !== 'hiring_criteria'/);
  assert.doesNotMatch(searchRoute, /credits_remaining|consume_qc/);
});

test('a complete criteria draft can be applied directly from the sourcing workspace', () => {
  assert.match(component, /Apply Criteria & Enable Sourcing/);
  assert.match(component, /action: 'apply'/);
  assert.match(searchRoute, /criteriaReadyToApply/);
});

test('free sourcing stays compact while the QC evaluation owns the full criteria matrix', () => {
  const searchSchema = sourcingEngine.slice(sourcingEngine.indexOf('function searchSchema'), sourcingEngine.indexOf('function evaluationSchema'));
  assert.match(searchSchema, /criterionScores/);
  assert.doesNotMatch(searchSchema, /criterionSignals/);
  assert.match(sourcingEngine, /criterionScores\[index\] \* criterion\.appliedWeight/);
  assert.match(sourcingEngine, /SOURCING_FIT_UPLIFT = 4/);
  assert.match(sourcingEngine, /Materially overlapping criteria must receive consistent scores/);
  assert.match(sourcingEngine, /Do not emit criterion IDs or criterion evidence during sourcing/);
  assert.match(component, /Preliminary fit/);
  assert.match(component, /Qualified fit/);
});

test('evaluation charges only through the atomic persistence RPC after generation', () => {
  const generation = evaluationRoute.indexOf('await evaluateProspect');
  const billing = evaluationRoute.indexOf("rpc('consume_qc_and_unlock_prospect_evaluation_v1'");
  assert.ok(generation >= 0 && billing > generation);
  assert.match(evaluationRoute, /No QC was used/);
});

test('saved sourcing runs can be reopened without creating a new search or consuming QC', () => {
  assert.match(searchRoute, /searchParams\.get\('searchId'\)/);
  assert.match(searchRoute, /async function searchHistory/);
  assert.match(searchRoute, /prospectCount/);
  assert.match(historyPanel, /Reviewing saved results never uses QC/);
  assert.match(historyPanel, /PROSPECT_SEARCH_FOCUS_EVENT/);
  assert.match(component, /loadSavedSearch\(detail\.searchId\)/);
});

test('sourcing uses the right rail for Search history and the existing requisition Teamwork', () => {
  assert.match(workspacePanel, /showSourcingWorkspace/);
  assert.match(workspacePanel, />\s*Searches\s*</);
  assert.match(workspacePanel, /<ProspectSearchHistory requisitionId=\{requisitionId\}/);
  assert.match(workspacePanel, /<RequisitionNotes requisitionId=\{requisitionId\}/);
  assert.match(historyPanel, /Current criteria/);
  assert.match(historyPanel, /Prior criteria/);
});

test('prior searches allow already-purchased evaluations to reopen but block new evaluation spend against stale criteria', () => {
  assert.match(component, /payload\?\.stale && !prospect\.evaluation/);
});
