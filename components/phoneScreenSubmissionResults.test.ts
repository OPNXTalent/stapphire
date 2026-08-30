import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const participant = readFileSync(new URL('./ParticipantInterviewPreview.tsx', import.meta.url), 'utf8');
const invitationPage = readFileSync(new URL('../app/interview/invite/[token]/page.tsx', import.meta.url), 'utf8');
const invitationResultsRoute = readFileSync(new URL('../app/api/candidates/[id]/interview-invitations/route.ts', import.meta.url), 'utf8');
const results = readFileSync(new URL('./CandidateInterviewRounds.tsx', import.meta.url), 'utf8');

test('successful submission replaces the form with a dedicated confirmation state', () => {
  const confirmation = participant.match(/if \(submitted\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(confirmation, /SUBMISSION RECEIVED/);
  assert.match(confirmation, /has been submitted successfully/);
  assert.match(confirmation, /You may close this window/);
  assert.doesNotMatch(confirmation, /formQuestions\.map|submitInterview|Submit Interview/);
});

test('a reload of an already-submitted invitation also displays confirmation', () => {
  assert.match(invitationPage, /initiallySubmitted=\{invitation\.status === 'submitted'\}/);
  assert.match(participant, /useState\(initiallySubmitted\)/);
});

test('Phone Screen participant labels are stage-specific', () => {
  assert.match(participant, /PHONE SCREEN ASSESSMENT/);
  assert.match(participant, /Phone Screen Summary/);
  assert.match(participant, /Screening Notes/);
  assert.match(participant, /Submit Phone Screen/);
});

test('Phone Screen results render qualification responses and never fabricate AOE scores', () => {
  assert.match(results, /const isPhoneScreen = round\.id === 'phone-screen'/);
  assert.match(results, /Qualification Question/);
  assert.match(results, /phoneScreenResponseLabel\(response\)/);
  assert.match(results, /Screen Recommendation/);
  assert.match(results, /Suggested Next Step/);
  assert.match(results, /isPhoneScreen \? \([\s\S]*?\) : <>[\s\S]*?styles\.aggregateTable/);
});

test('the results API preserves snapshot question order across mixed response controls', () => {
  assert.match(invitationResultsRoute, /const screenResponses = questions\.flatMap/);
  assert.match(invitationResultsRoute, /screenResponses,/);
});

test('structured interview results retain AOE, overall average, and panel decision output', () => {
  assert.match(results, /Area of Evaluation/);
  assert.match(results, /Overall Interview Average/);
  assert.match(results, /Panel Recommendation/);
  assert.match(results, /Suggested Decision/);
  assert.match(results, /decisionSummary\.composition/);
  assert.match(results, /decisionSummary\.label/);
});
