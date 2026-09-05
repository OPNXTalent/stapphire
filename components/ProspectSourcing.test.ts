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
const sourcingStyles = readFileSync(join(directory, 'ProspectSourcing.module.css'), 'utf8');
const teamworkWorkspace = readFileSync(join(directory, '..', 'lib', 'teamworkWorkspace.ts'), 'utf8');
const sharedTeamwork = readFileSync(join(directory, 'SharedTeamworkWorkspace.tsx'), 'utf8');

test('locked shortlist exposes name, location, sourcing fit, score, and explicit QC action', () => {
  assert.match(component, /<strong>\{prospect\.full_name\}<\/strong>/);
  assert.match(component, /displayedEvidenceScore\(prospect\)/);
  assert.match(component, /View evaluation · 1 QC/);
  assert.doesNotMatch(component, /prospect\.headline/);
  assert.match(component, /prospect\.location/);
  assert.match(component, /displayedEvidenceFit\(prospect\)/);
  assert.match(searchRoute, /prospect\.evaluation \? prospect/);
  assert.match(searchRoute, /sources: \[\]/);
});

test('search automatically snapshots ready Hiring Criteria and does not perform QC billing', () => {
  assert.match(searchRoute, /resolveOrApplySourcingBasis/);
  assert.match(searchRoute, /rpc\('apply_phase1_hiring_criteria'/);
  assert.match(searchRoute, /resolveEvaluationBasisById/);
  assert.doesNotMatch(searchRoute, /credits_remaining|consume_qc/);
});

test('a complete criteria draft enables sourcing without a manual apply step', () => {
  assert.match(component, /const canSource = Boolean\(payload\?\.criteriaApplied \|\| payload\?\.criteriaReadyToApply\)/);
  assert.doesNotMatch(component, /Apply Criteria & Enable Sourcing/);
  assert.doesNotMatch(component, /action: 'apply'/);
  assert.match(searchRoute, /criteriaReadyToApply/);
  assert.match(searchRoute, /loadReadyCriteriaDraft/);
});

test('free sourcing performs an evidence audit while the QC evaluation owns the full narrative', () => {
  const searchSchema = sourcingEngine.slice(sourcingEngine.indexOf('function searchSchema'), sourcingEngine.indexOf('function evaluationSchema'));
  assert.match(searchSchema, /criterionSignals/);
  assert.doesNotMatch(searchSchema, /criterionScores/);
  assert.match(searchSchema, /evidenceStrength/);
  assert.match(sourcingEngine, /MIN_SHORTLIST_SCORE = 70/);
  assert.match(sourcingEngine, /MIN_DIRECT_EVIDENCE_WEIGHT = 40/);
  assert.match(sourcingEngine, /sources\.length < 2/);
  assert.match(sourcingEngine, /prospect\.geographicFit !== 'WITHIN_SCOPE'/);
  assert.match(sourcingEngine, /gateFindings\.some\(\(item\) => item\.status !== 'MET'\)/);
  assert.match(sourcingEngine, /SOURCING_FIT_UPLIFT = 4/);
  assert.match(sourcingEngine, /Materially overlapping criteria must receive consistent scores/);
  assert.match(component, />Evidence<\/span><span>Fit<\/span>/);
  assert.match(component, /Evaluated fit/);
});

test('non-negotiables are optional and only explicit Knockout criteria prepopulate', () => {
  assert.doesNotMatch(searchRoute, /occupational-domain/);
  assert.match(searchRoute, /gates: sourcingCriteria\.filter\(\(criterion\) => criterion\.isKnockout\)/);
  assert.doesNotMatch(searchRoute, /if \(!gates\.length\)/);
  assert.match(evaluationRoute, /!Array\.isArray\(config\.gates\)/);
  assert.doesNotMatch(evaluationRoute, /!config\?\.gates\?\.length/);
  assert.match(component, /filter\(\(gate: Gate\) => gate\.id !== 'occupational-domain'\)/);
});

test('older loose searches are identified and low unevaluated leads are removed from the working shortlist', () => {
  assert.match(searchRoute, /screeningVersion: PROSPECT_SCREENING_VERSION/);
  assert.match(component, /screeningVersion !== 'evidence_v2'/);
  assert.match(component, /Boolean\(prospect\.evaluation\) \|\| prospect\.preliminary_score >= 70/);
  assert.match(component, /predates the stricter evidence screen/);
});

test('Teamwork shares only evidence-cleared prospects and never leaks locked sourcing detail', () => {
  assert.match(teamworkWorkspace, /evaluation_score \?\? prospect\.preliminary_score\) >= 70/);
  assert.match(teamworkWorkspace, /sources: \[\]/);
  assert.match(sharedTeamwork, /prospect\.evaluation_score \?\? prospect\.preliminary_score/);
  assert.doesNotMatch(sharedTeamwork, /textValue\(prospect\.headline\)/);
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

test('Non-negotiables use a compact progressive intake instead of a free-text box', () => {
  assert.match(component, /Add non-negotiable/);
  assert.doesNotMatch(component, /Non-negotiable sourcing gates/);
  assert.doesNotMatch(component, /one per line|className=\{styles\.gates\}[\s\S]*<textarea/);
  assert.match(component, /nonNegotiableIntakeOpen/);
  assert.match(component, /event\.key !== 'Enter'/);
  assert.match(component, /Remove \$\{label\}/);
  assert.match(sourcingStyles, /\.gateIntake \{ display:grid; grid-template-columns:minmax\(0,1fr\) auto/);
});

test('prior searches allow already-purchased evaluations to reopen but block new evaluation spend against stale criteria', () => {
  assert.match(component, /payload\?\.stale && !prospect\.evaluation/);
});

test('the unlocked evaluation banner puts candidate location and the best public profile within immediate reach', () => {
  assert.match(component, /function primaryPublicProfile/);
  assert.match(component, /linkedin\\\.com\\\/in/);
  assert.match(component, /prospect\.evaluation\.location\?\.label/);
  assert.match(component, /Open public profile/);
  assert.match(component, /className=\{styles\.candidateContact\}/);
});
