import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const panel = readFileSync(new URL('./CandidateFilesPanel.tsx', import.meta.url), 'utf8');
const filesRoute = readFileSync(new URL('../app/api/candidates/[id]/files/route.ts', import.meta.url), 'utf8');
const fileRoute = readFileSync(new URL('../app/api/candidates/[id]/files/[fileId]/route.ts', import.meta.url), 'utf8');
const layoutRoute = readFileSync(new URL('../app/api/candidates/[id]/file-layout/route.ts', import.meta.url), 'utf8');
const interviewPage = readFileSync(new URL('../app/candidates/[id]/interviews/[invitationId]/page.tsx', import.meta.url), 'utf8');

test('Candidate Files projects only submitted authoritative interview invitations', () => {
  assert.match(panel, /interview-invitations/);
  assert.match(panel, /filter\(\(item: \{ status\?: string \}\) => item\.status === 'submitted'\)/);
  assert.match(panel, /Submitted.*interview\.stage.*participantName.*submittedAt/s);
  assert.match(interviewPage, /ratings/);
  assert.match(interviewPage, /comments/);
  assert.match(interviewPage, /recommendation/);
  assert.match(interviewPage, /yesNoResponses/);
});

test('general uploads support multiple files without replacing existing records', () => {
  assert.match(panel, /multiple/);
  assert.match(panel, /Promise\.all\(tasks\.map/);
  assert.match(panel, /setUploads\(\(current\) => \[data\.file as CandidateUpload, \.\.\.current\]\)/);
  const uploadFiles = panel.match(/async function uploadFiles[\s\S]*?\n  async function deleteUpload/)?.[0] ?? '';
  assert.doesNotMatch(uploadFiles, /setUploads\(\[\]\)/);
  assert.match(filesRoute, /phase1_candidate_uploads/);
  assert.match(filesRoute, /candidate-files/);
  assert.match(fileRoute, /Content-Disposition/);
});

test('custom folders remain containers and cannot be removed while they contain uploads', () => {
  assert.match(filesRoute, /value\.startsWith\('custom-'\)/);
  assert.match(layoutRoute, /removedCustomKeys/);
  assert.match(layoutRoute, /phase1_candidate_uploads/);
  assert.match(layoutRoute, /status: 409/);
});

// Workspace-context correction: arriving at Candidate Files from a
// completed-interview assessment (via candidate.focusInterviewId,
// threaded through by the CandidateDetailActions bridge) should expand
// Interviews and highlight the current assessment - without changing
// default behavior for every other entry point, where focusInterviewId
// is simply undefined.

test('the Interviews folder defaults open only when a specific interview is being focused, not for every candidate-files visit', () => {
  const detailsMatch = panel.match(/<details className=\{styles\.folder\} open=\{([\s\S]*?)\}>/);
  assert.ok(detailsMatch, 'expected the folder <details> element to have a conditional open prop');
  assert.match(detailsMatch[1], /section\.key === 'interviews' && Boolean\(candidate\.focusInterviewId\)/, 'only the interviews folder, and only when focusInterviewId is present, should default open - every other folder/visit keeps its existing collapsed-by-default behavior');
});

test('the current assessment\'s row is highlighted and marked aria-current, distinguishing it without needing a broad architecture change', () => {
  assert.match(panel, /const isCurrent = interview\.id === candidate\.focusInterviewId;/);
  assert.match(panel, /className=\{`\$\{styles\.interviewRow\} \$\{isCurrent \? styles\.interviewRowActive : ''\}`\}/);
  assert.match(panel, /aria-current=\{isCurrent \? 'true' : undefined\}/);
});

test('focusInterviewId is optional on the shared candidate selection type, so every existing dispatcher (which never passes it) is unaffected', () => {
  const eventsFile = readFileSync(new URL('../lib/candidateFilesEvents.ts', import.meta.url), 'utf8');
  assert.match(eventsFile, /focusInterviewId\?: string;/);
});
