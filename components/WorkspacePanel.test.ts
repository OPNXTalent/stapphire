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
