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
