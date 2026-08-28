import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This project has no React/DOM testing infrastructure - these tests
// inspect source directly for the workspace-context correction: the
// internal completed-interview assessment view should open the same
// Candidate Files / Teamwork right rail CandidateMatrix already uses,
// reusing the existing CANDIDATE_FILES_FOCUS_EVENT mechanism rather than
// a separate right-panel implementation, without exposing it on any
// public/participant route.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const interviewDir = join(repoRoot, 'app', 'candidates', '[id]', 'interviews', '[invitationId]');
const page = readFileSync(join(interviewDir, 'page.tsx'), 'utf8');
const middleware = readFileSync(join(repoRoot, 'middleware.ts'), 'utf8');
const publicInvitePage = readFileSync(join(repoRoot, 'app', 'interview', 'invite', '[token]', 'page.tsx'), 'utf8');
const previewPage = readFileSync(join(repoRoot, 'app', 'interview', 'preview', '[stage]', 'page.tsx'), 'utf8');
const appShell = readFileSync(join(repoRoot, 'components', 'AppShell.tsx'), 'utf8');
const matrixCss = readFileSync(join(repoRoot, 'app', 'matrix.css'), 'utf8');

test('the page fetches the resume fields Candidate Files needs (source_filename/source_storage_path), reusing the same columns the requisition matrix already reads', () => {
  assert.match(page, /select\('full_name, source_filename, source_storage_path'\)/, 'expected the candidate query to also select the resume fields CandidateFilesPanel/CandidateTeamworkPanel need');
});

test('the page dispatches candidate-files focus via the existing CandidateDetailActions bridge, not a new/parallel right-panel mechanism', () => {
  assert.match(page, /import \{ CandidateDetailActions \} from '@\/components\/CandidateDetailActions';/);
  const bridgeMatch = page.match(/<CandidateDetailActions([\s\S]*?)\/>/);
  assert.ok(bridgeMatch, 'expected to find the CandidateDetailActions bridge element');
  assert.match(bridgeMatch[1], /candidateId=\{params\.id\}/);
  assert.match(bridgeMatch[1], /candidateName=\{candidate\.full_name\}/);
  assert.match(bridgeMatch[1], /sourceFilename=\{String\(candidate\.source_filename \|\| ''\)\}/);
  assert.match(bridgeMatch[1], /resumeAvailable=\{Boolean\(candidate\.source_storage_path\)\}/);
  assert.match(bridgeMatch[1], /focusInterviewId=\{params\.invitationId\}/, 'expected the current invitation id to be threaded through so Candidate Files can expand/highlight it');
});

test('the completed-interview route is internal, not the public/gate-exempt participant route - the gate middleware does not exempt it', () => {
  const exemptMatch = middleware.match(/const EXEMPT_PATHS = \[([\s\S]*?)\];/);
  assert.ok(exemptMatch, 'expected to find EXEMPT_PATHS in middleware.ts');
  assert.doesNotMatch(exemptMatch[1], /\/candidates/, 'the internal /candidates/[id]/interviews/[invitationId] assessment route must require the gate cookie like the rest of the internal app - workspace context must never be reachable without authentication');
  assert.match(exemptMatch[1], /'\/interview\/invite'/, 'confirms the actual public, unauthenticated route is the separate /interview/invite/[token] participant link');
});

test('the public participant interview-submission route has no coupling to Candidate Files/workspace focus - the internal bridge component is not used there', () => {
  assert.doesNotMatch(publicInvitePage, /CandidateDetailActions|CANDIDATE_FILES_FOCUS_EVENT/, 'the public /interview/invite/[token] page must never dispatch or reference the internal workspace-focus mechanism');
});

test('the participant preview route bypasses AppShell (and therefore WorkspacePanel) entirely, so it cannot render workspace context regardless', () => {
  assert.doesNotMatch(previewPage, /CandidateDetailActions|CANDIDATE_FILES_FOCUS_EVENT/, 'the preview route must also stay uncoupled from the internal workspace-focus mechanism');
  assert.match(appShell, /if \(pathname\.startsWith\('\/interview\/preview\/'\)\) \{\s*\n\s*return <>\{children\}<\/>;\s*\n\s*\}/, 'expected AppShell to keep short-circuiting to bare children (no side panel at all) for the preview route');
});

test('the application chrome, including the right rail, is already excluded from Print by the existing global print rules - unaffected by this correction', () => {
  assert.ok(
    matrixCss.includes('.brand-bar,.req-nav,.side-panel,.pull-tab,') && matrixCss.includes('{display:none!important}'),
    'expected .side-panel (WorkspacePanel) to remain excluded from print output alongside the rest of the app chrome'
  );
});
