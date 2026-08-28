import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'WorkspacePanel.tsx'), 'utf8');

test('selected-candidate workspace is isolated from matrix-level resume upload', () => {
  const candidateBranch = source.match(/showCandidateFiles && candidate \? \(([\s\S]*?)\) : showCandidateWorkspace/);
  assert.ok(candidateBranch);
  assert.match(candidateBranch[1], /Candidate Files/);
  assert.match(candidateBranch[1], /CandidateTeamworkPanel/);
  assert.doesNotMatch(candidateBranch[1], /Resume Upload|<ResumeUpload/);
});

test('matrix-level candidate workspace retains resume upload and requisition teamwork', () => {
  const matrixBranch = source.match(/showCandidateWorkspace && requisitionId \? \(([\s\S]*?)\) : showRequisitionNotes/);
  assert.ok(matrixBranch);
  assert.match(matrixBranch[1], /Resume Upload/);
  assert.match(matrixBranch[1], /<ResumeUpload requisitionId=\{requisitionId\}/);
  assert.match(matrixBranch[1], /Teamwork/);
  assert.match(matrixBranch[1], /<RequisitionNotes requisitionId=\{requisitionId\}/);
});

// Workspace-context correction: the internal completed-interview
// assessment view (app/candidates/[id]/interviews/[invitationId]) has
// no /requisitions/[id] segment of its own, so it must not need one to
// open Candidate Files - it reuses the exact same
// CANDIDATE_FILES_FOCUS_EVENT/candidate state this file already
// maintains for the matrix, rather than a separate right-panel
// implementation.

test('the completed-interview route pathname pattern is recognized narrowly - only app/candidates/[id]/interviews/[invitationId], not the public/participant interview routes', () => {
  const routeMatch = source.match(/const isCompletedInterviewRoute = \/(.+)\/\.test\(pathname\) && !isPrintSession;/);
  assert.ok(routeMatch, 'expected to find the isCompletedInterviewRoute pattern, explicitly excluding print sessions');
  const pattern = new RegExp(routeMatch[1]);
  assert.ok(pattern.test('/candidates/cand-1/interviews/inv-1'), 'must match the internal completed-interview assessment route');
  assert.ok(!pattern.test('/interview/invite/some-token'), 'must NOT match the public, gate-exempt participant submission route');
  assert.ok(!pattern.test('/interview/preview/phone-screen'), 'must NOT match the participant preview route (which bypasses AppShell/WorkspacePanel entirely anyway)');
  assert.ok(!pattern.test('/candidates/cand-1'), 'must NOT match the bare candidate route with no interview segment');
  assert.ok(!pattern.test('/requisitions/req-1'), 'must NOT match the ordinary requisition workspace route');
});

// Print-session correction (follow-up): usePathname() never includes
// the query string, so the pathname pattern alone matches
// /candidates/[id]/interviews/[invitationId]?print=1 identically to a
// normal view. The disposable print tab must never hydrate Candidate
// Files/Teamwork, so WorkspacePanel excludes it explicitly rather than
// relying solely on the interview page withholding the focus event.

test('isPrintSession is read directly from the URL search params, not derived from pathname (which cannot see ?print=1)', () => {
  assert.match(source, /import \{ usePathname, useSearchParams \} from 'next\/navigation';/);
  assert.match(source, /const searchParams = useSearchParams\(\);/);
  assert.match(source, /const isPrintSession = searchParams\.get\('print'\) === '1';/);
});

test('isCompletedInterviewRoute is false for the print-session URL even though its pathname is identical to the normal view', () => {
  const routeMatch = source.match(/const isCompletedInterviewRoute = \/(.+)\/\.test\(pathname\) && !isPrintSession;/);
  assert.ok(routeMatch);
  const pathnameOnlyMatches = new RegExp(routeMatch[1]).test('/candidates/cand-1/interviews/inv-1');
  assert.ok(pathnameOnlyMatches, 'sanity check: the pathname of a print-session URL (query strings are stripped from usePathname()) does match the raw pattern');
  assert.match(source, /&& !isPrintSession;/, 'expected the print-session exclusion to be applied on top of the pathname match, since pathname alone cannot distinguish the two');
});

test('the print-session exclusion is derived from this file\'s own URL read, not by importing or depending on the interview page\'s own isPrintSession guard - defense in depth, not the only guard', () => {
  // WorkspacePanel reads searchParams itself (asserted above); it does
  // not import anything from the interview page, so Candidate Files/
  // Teamwork hydration in the print tab does not depend on that other
  // file continuing to withhold CandidateDetailActions correctly.
  assert.match(source, /const isPrintSession = searchParams\.get\('print'\) === '1';/);
  assert.doesNotMatch(source, /from '@\/app\/candidates/, 'must not import anything from the interview page - the exclusion must be self-derived, not borrowed');
});

test('Candidate Files opens on the completed-interview route without requiring a /requisitions/[id] context, but only once a candidate has actually been focused', () => {
  const showCandidateFilesMatch = source.match(/const showCandidateFiles = Boolean\(([\s\S]*?)\);/);
  assert.ok(showCandidateFilesMatch, 'expected to find showCandidateFiles');
  assert.match(showCandidateFilesMatch[1], /candidate && \(isCompletedInterviewRoute \|\| \(requisitionId && state\.view === 'candidates'\)\)/, 'expected isCompletedInterviewRoute to be an alternative trigger alongside the existing requisitionId/state.view gate, both still requiring a focused candidate');
});

test('the completed-interview route does not gain access to the general requisition-workspace panels (Resume Upload, Generated Questions, requisition Teamwork) - those all still require requisitionId, which this route never has', () => {
  assert.match(source, /const showQuestionBank = Boolean\(\s*\n\s*isInterviewBuilder \|\|\s*\n\s*\(requisitionId && state\.view === 'requisition' && state\.requisitionTab === 'interviews'\)\s*\n\s*\);/, 'showQuestionBank must remain requisitionId-gated, unaffected by isCompletedInterviewRoute');
  assert.match(source, /const showCandidateWorkspace = Boolean\(requisitionId && state\.view === 'candidates'\);/, 'showCandidateWorkspace must remain requisitionId-gated, unaffected by isCompletedInterviewRoute');
  assert.match(source, /const showRequisitionNotes = Boolean\(\s*\n\s*requisitionId &&/, 'showRequisitionNotes must remain requisitionId-gated, unaffected by isCompletedInterviewRoute');
});
