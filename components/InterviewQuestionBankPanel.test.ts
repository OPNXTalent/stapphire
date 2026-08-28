import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'InterviewQuestionBankPanel.tsx'), 'utf8');

test('Phone Screen gets its own early-return branch, not a duplicated right-panel implementation - the Structured Interview generator UI remains the single shared component below it', () => {
  assert.match(source, /if \(isPhoneScreen\) \{\s*\n\s*return \(/, 'expected an early return for the phone-screen branch');
  const phoneScreenReturnMatch = source.match(/if \(isPhoneScreen\) \{([\s\S]*?)\n {2}\}\n\n {2}return \(/);
  assert.ok(phoneScreenReturnMatch, 'expected to isolate the phone-screen branch body');
  assert.doesNotMatch(phoneScreenReturnMatch[1], /Generate \d+ Questions/, 'Phone Screen must not show the AI question generator');
  assert.doesNotMatch(phoneScreenReturnMatch[1], /Manage AOE/, 'Phone Screen must not show Areas of Evaluation management');
  assert.doesNotMatch(phoneScreenReturnMatch[1], /questionTypeSelect/, 'Phone Screen must not show the Question Type generator dropdown');
});

test('the Phone Screen bank list is sourced from the fixed PHONE_SCREEN_BANK_QUESTIONS list, filtered by the same usedIds tracking the Structured Interview bank already uses', () => {
  assert.match(source, /import \{ PHONE_SCREEN_BANK_QUESTIONS, type PhoneScreenResponseKind, type PhoneScreenResponseSpec \} from '@\/lib\/phoneScreenQuestions';/);
  const memoMatch = source.match(/const availablePhoneScreenQuestions = useMemo<AvailableQuestion\[\]>\(\s*\n\s*\(\) => PHONE_SCREEN_BANK_QUESTIONS\s*\n\s*\.filter\(\(question\) => !usedIds\.has\(question\.id\)\)/);
  assert.ok(memoMatch, 'expected availablePhoneScreenQuestions to filter the fixed bank list by the shared usedIds set, matching availableQuestions\' own filtering pattern');
});

test('each Phone Screen bank question carries its canonical response metadata through the drag payload, not just its text/areas', () => {
  assert.match(source, /\.map\(\(question\) => \(\{ id: question\.id, text: question\.text, areas: \[\], response: question\.response \}\)\)/, 'availablePhoneScreenQuestions must preserve response so cloneBankQuestion on the receiving side can see the intended response kind');
});

test('a Phone Screen bank item shows a short response-kind badge, reusing the existing .chips styling', () => {
  assert.match(source, /RESPONSE_KIND_LABELS\[question\.response\.kind\]/);
});

test('Phone Screen bank questions drag onto the form through the exact same transport as Structured Interview bank questions (startDrag / INTERVIEW_BANK_DRAG_MIME), not a new mechanism', () => {
  const phoneScreenReturnMatch = source.match(/if \(isPhoneScreen\) \{([\s\S]*?)\n {2}\}\n\n {2}return \(/);
  assert.ok(phoneScreenReturnMatch);
  assert.match(phoneScreenReturnMatch[1], /onDragStart=\{\(event\) => startDrag\(event, question\)\}/);
  assert.match(phoneScreenReturnMatch[1], /onDragEnd=\{\(\) => window\.setTimeout\(\(\) => void refreshUsedIds\(\), 750\)\}/);
});

test('the "Create Your Own Question" wildcard is present on both Phone Screen and Structured Interview banks, reusing the same startBlankDrag mechanism', () => {
  const matches = source.match(/draggable onDragStart=\{startBlankDrag\}/g) || [];
  assert.equal(matches.length, 2, 'expected exactly one wildcard tile per branch (phone-screen and structured), both wired to the same startBlankDrag function');
});

test('the stale pre-plan-load "already used" starter ids were updated to match the new Phone Screen default question ids, not left pointing at the old (now unrelated) buildQuestionBank phone-screen ids', () => {
  assert.match(source, /'phone-screen-default-1','phone-screen-default-2','phone-screen-default-3','phone-screen-default-4','phone-screen-default-5','phone-screen-default-6'/);
  assert.doesNotMatch(source, /'phone-screen-1','phone-screen-2'/, 'the old buildQuestionBank-based ids must not remain, since they no longer correspond to what is actually pre-loaded onto a new Phone Screen');
});

test('the selected stage\'s name/tagline and its canonical explainer are computed once and shared between both branches, not duplicated', () => {
  const stageContextMatches = source.match(/const stageContext = stageInfo && \(/g) || [];
  assert.equal(stageContextMatches.length, 1, 'expected exactly one stageContext computation, reused by both the phone-screen and structured returns');
  const usageMatches = source.match(/\{stageContext\}/g) || [];
  assert.equal(usageMatches.length, 2, 'expected {stageContext} to be rendered in both the phone-screen and structured branches');
});

test('the stage explainer is system guidance, not user-editable - a <p>, not an input/textarea, sourced from INTERVIEW_STAGES rather than local state', () => {
  const contextMatch = source.match(/const stageContext = stageInfo && \(([\s\S]*?)\n {2}\);/);
  assert.ok(contextMatch, 'expected to find the stageContext JSX');
  assert.match(contextMatch[1], /<h2 className=\{styles\.stageContextTitle\}>\{stageInfo\.label\} <span className=\{styles\.stageContextTagline\}>\{stageInfo\.tagline\}<\/span><\/h2>/);
  assert.match(contextMatch[1], /<p className=\{styles\.stageContextExplainer\}>\{stageInfo\.description\}<\/p>/);
  assert.doesNotMatch(contextMatch[1], /<input|<textarea|onChange/, 'the explainer must be static system text, never an editable field');
});

test('the stage context (title + explainer) renders above the Question Bank heading in both branches', () => {
  const phoneScreenIndex = source.indexOf('{stageContext}', source.indexOf('if (isPhoneScreen)'));
  const phoneScreenBankHeadingIndex = source.indexOf('Question Bank <span', phoneScreenIndex);
  assert.ok(phoneScreenIndex >= 0 && phoneScreenBankHeadingIndex > phoneScreenIndex, 'phone-screen branch: stageContext must precede the Question Bank heading');

  const structuredIndex = source.indexOf('{stageContext}', phoneScreenBankHeadingIndex);
  const structuredBankHeadingIndex = source.indexOf('Question Bank <span', structuredIndex);
  assert.ok(structuredIndex >= 0 && structuredBankHeadingIndex > structuredIndex, 'structured branch: stageContext must precede the Question Bank heading');
});
