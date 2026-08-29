import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'api', 'requisitions', '[id]', 'interview-question-bank', 'route.ts'),
  'utf8'
);

test('the separate, non-atomic metadata backfill is gone - the route no longer issues its own UPDATE against the bank table after the RPC call', () => {
  assert.doesNotMatch(source, /function backfillQuestionTypeMetadata/, 'the old application-level backfill function must be removed');
  assert.doesNotMatch(source, /\.from\('phase1_interview_question_bank'\)\s*\n\s*\.update\(/, 'no separate UPDATE against the bank table should remain - metadata persistence now happens inside the atomic RPC');
});

test('a generation request identifier is required and validated before any generation work begins', () => {
  assert.match(source, /function isValidRequestId\(value: unknown\): value is string/);
  assert.match(source, /if \(!isValidRequestId\(body\.requestId\)\) return NextResponse\.json\(\{ error: 'A generation request identifier is required\.' \}, \{ status: 400 \}\);/);
});

test('the request identifier is threaded through to both generators and into the RPC payload for both stages', () => {
  assert.match(source, /generatePhoneScreenQuestions\(\{ basis, questionType: phoneScreenType, existingQuestions, requestId \}\)/);
  assert.match(source, /generateInterviewQuestions\(\{ basis, selectedAreas, questionType, existingQuestions, availableAreas, requestId \}\)/);
  const requestIdInPayload = source.match(/requestId\s*\n\s*\}\)\)/g) || [];
  assert.equal(requestIdInPayload.length, 2, 'expected requestId as the final field of the p_questions payload for both the Phone Screen and Structured RPC calls');
});

test('there is no pre-check against organization.credits_remaining before generation - a replay of an already-completed request must succeed even at zero credits, since the RPC itself only charges a genuinely fresh batch', () => {
  assert.doesNotMatch(source, /credits_remaining as number\) < 1/, 'the route must not reject a request purely because credits are at zero before knowing whether this is a replay');
});

test('the RPC error is inspected, not ignored, and the exact INSUFFICIENT_QC signal is still mapped to a 402 for both stages', () => {
  const insufficientMatches = source.match(/error\.message\?\.includes\('INSUFFICIENT_QC'\)/g) || [];
  assert.equal(insufficientMatches.length, 2, 'expected the INSUFFICIENT_QC check to remain for both the Phone Screen and Structured paths');
});

test('the response is built directly from the RPC\'s own returned data.questions - not a client-reconstructed array that could drift from what was actually persisted', () => {
  const generatedAssignments = source.match(/generated: data\.questions/g) || [];
  assert.equal(generatedAssignments.length, 2, 'expected both response paths to use the RPC\'s own data.questions for `generated`');
});

test('Phone Screen questions are sent to the RPC with stage, Question Type, and response metadata inline - not stripped down to {id,text,areas} the way the pre-atomicity version sent them', () => {
  const phoneScreenPayloadMatch = source.match(/p_questions: questions\.map\(\(question\) => \(\{\s*\n\s*id: question\.id,\s*\n\s*text: question\.text,\s*\n\s*areas: \[\],\s*\n\s*stage: 'phone-screen',\s*\n\s*questionType: question\.questionType,\s*\n\s*responseKind: question\.responseKind,/);
  assert.ok(phoneScreenPayloadMatch, 'expected the Phone Screen RPC payload to include stage/questionType/responseKind inline');
});
