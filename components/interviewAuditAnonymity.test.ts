import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const leader = readFileSync(new URL('./CandidateInterviewRounds.tsx', import.meta.url), 'utf8');
const auditPage = readFileSync(new URL('../app/candidates/[id]/interviews/[invitationId]/page.tsx', import.meta.url), 'utf8');
const actions = readFileSync(new URL('./CompletedInterviewActions.tsx', import.meta.url), 'utf8');

test('Hiring Leader assessments use neutral contributor labels without rendering participant identity', () => {
  const renderAssessment = leader.match(/function renderAssessment[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(renderAssessment, /Panel Contributor \{contributorNumber\}/);
  assert.doesNotMatch(renderAssessment, /assessment\.contributor/);
  assert.match(leader, /Panel Recommendation/);
  assert.match(leader, /decisionSummary\.composition/);
});

test('the HR audit record retains attributable participant identity and submitted context', () => {
  assert.match(auditPage, /phase1_interview_invitations/);
  assert.match(auditPage, /invitation\.participant_name/);
  assert.match(auditPage, /submittedTimestamp\(invitation\.submitted_at\)/);
  assert.match(auditPage, /invitation\.stage/);
  assert.match(auditPage, /invitation\.round_title/);
});

test('the completed interview opens as a fully expanded immutable record', () => {
  assert.match(auditPage, /invitation\.status !== 'submitted'/);
  assert.match(auditPage, /READ ONLY/);
  assert.match(auditPage, /questions\.map/);
  assert.match(auditPage, /ratings\[/);
  assert.match(auditPage, /'★'\.repeat\(value\)/);
  assert.match(auditPage, /yesNoResponses\[/);
  assert.match(auditPage, /questionComments\[/);
  assert.match(auditPage, /submission\.comments/);
  assert.match(auditPage, /submission\.recommendation/);
  assert.doesNotMatch(auditPage, /aria-expanded|View Answers|Participant Assessments/);
});

test('Share and Print target the stable completed-record URL rather than an invitation token', () => {
  assert.match(auditPage, /const href = `\/candidates\/\$\{params\.id\}\/interviews\/\$\{params\.invitationId\}`/);
  assert.match(actions, /new URL\(href, window\.location\.origin\)/);
  assert.match(actions, /navigator\.clipboard\.writeText\(url\)/);
  assert.match(actions, /print=1/);
  assert.doesNotMatch(actions, /\/interview\/invite\//);
});
