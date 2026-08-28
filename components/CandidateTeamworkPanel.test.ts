import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This project has no React/DOM testing infrastructure - these inspect
// the component's own source. Regression coverage for: Teamwork must be
// connected to the candidate's requisition context (invitation.
// requisition_id, threaded through the existing CANDIDATE_FILES_FOCUS_EVENT/
// candidate-selection mechanism - not a second Teamwork implementation).

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'CandidateTeamworkPanel.tsx'), 'utf8');

test('CandidateTeamworkPanel is the single Teamwork implementation used for a focused candidate - not duplicated', () => {
  assert.match(source, /export function CandidateTeamworkPanel\(\{ candidate \}: \{ candidate: CandidateFilesSelection \}\)/, 'expected the existing single-prop signature to remain the same shape');
});

test('the requisition this candidate (and therefore this Teamwork thread) belongs to is rendered explicitly and is verifiable, sourced from the shared candidate selection - not a second/parallel requisitionId prop', () => {
  assert.match(source, /data-requisition-id=\{candidate\.requisitionId\}/, 'expected candidate.requisitionId (already carried on the shared CandidateFilesSelection object) to be rendered, not a separate requisitionId prop invented for this component alone');
});

test('candidate teamwork notes remain scoped by candidate id, matching the read-only-by-candidate API this component already calls', () => {
  assert.match(source, /candidateId=\{candidate\.id\}/);
  assert.match(source, /endpoint=\{`\/api\/candidates\/\$\{candidate\.id\}\/teamwork`\}/);
});
