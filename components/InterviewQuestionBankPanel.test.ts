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
  assert.match(source, /import \{ PHONE_SCREEN_BANK_QUESTIONS, PHONE_SCREEN_QUESTION_TYPES, type PhoneScreenResponseKind, type PhoneScreenResponseSpec \} from '@\/lib\/phoneScreenQuestions';/);
  const memoMatch = source.match(/const availablePhoneScreenQuestions = useMemo<AvailableQuestion\[\]>\(\s*\n\s*\(\) => PHONE_SCREEN_BANK_QUESTIONS\s*\n\s*\.filter\(\(question\) => !usedIds\.has\(question\.id\)\)/);
  assert.ok(memoMatch, 'expected availablePhoneScreenQuestions to filter the fixed bank list by the shared usedIds set, matching availableQuestions\' own filtering pattern');
});

test('each Phone Screen bank question carries its canonical response metadata AND its questionType/cardTitle through the drag payload, not just its text/areas', () => {
  assert.match(source, /\.map\(\(question\) => \(\{ id: question\.id, text: question\.text, areas: \[\], response: question\.response, questionType: question\.questionType, cardTitle: question\.cardTitle \}\)\)/, 'availablePhoneScreenQuestions must preserve response/questionType/cardTitle so cloneBankQuestion on the receiving side can see them');
});

test('a Phone Screen bank item shows a short response-kind badge, reusing the existing .chips styling', () => {
  assert.match(source, /RESPONSE_KIND_LABELS\[question\.response\.kind\]/);
});

test('question badges are nested in the same content column as the question text, rather than restarting at the card edge beneath the drag handle', () => {
  const alignedBadgeBlocks = source.match(/<div className=\{styles\.questionBody\}>[\s\S]*?<div className=\{styles\.chips\}>/g) || [];
  assert.equal(alignedBadgeBlocks.length, 2, 'expected both Phone Screen response badges and Structured Interview AOE badges to live inside questionBody');
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

test('the duplicated stage-context block (repeated stage name, concept badge, and explainer) is gone from the right panel - that context now lives only in the full-width stage bar', () => {
  assert.doesNotMatch(source, /stageContext/, 'no trace of the stageContext computation or its usage should remain');
  assert.doesNotMatch(source, /stageContextTitle|stageContextTagline|stageContextExplainer/, 'no trace of the stageContext CSS classes should remain');
  assert.doesNotMatch(source, /\bINTERVIEW_STAGES\b/, 'INTERVIEW_STAGES is no longer needed in this file once stageContext is removed');
});

test('the panel content begins directly with the .generator wrapper (Question Bank heading, count, and guidance) in both branches - nothing precedes it', () => {
  const phoneScreenMatch = source.match(/if \(isPhoneScreen\) \{\s*\n\s*return \(\s*\n\s*<div className=\{styles\.panel\}>\s*\n\s*<div className=\{styles\.generator\}>/);
  assert.ok(phoneScreenMatch, 'phone-screen branch: .panel must be followed immediately by .generator, with nothing in between');

  const structuredMatch = source.match(/\n {2}return \(\s*\n\s*<div className=\{styles\.panel\}>\s*\n\s*<div className=\{styles\.generator\}>/);
  assert.ok(structuredMatch, 'structured branch: .panel must be followed immediately by .generator, with nothing in between');
});

test('Question Bank remains the panel\'s functional heading, still showing its live count', () => {
  const headingMatches = source.match(/<h3>Question Bank <span className=\{styles\.bankCount\}>/g) || [];
  assert.equal(headingMatches.length, 2, 'expected the Question Bank heading in both the phone-screen and structured branches');
});

// --- Question Type organization ---

test('the Question Bank groups questions into collapsible Question Type sections in both branches, not a flat list', () => {
  assert.match(source, /function groupByType<T extends \{ questionType: string \}>\(/, 'expected a shared grouping helper');
  assert.match(source, /const phoneScreenGroups = useMemo\(/);
  assert.match(source, /const structuredGroups = useMemo\(/);
  assert.match(source, /phoneScreenGroups\.map\(\(group\) => \{/);
  assert.match(source, /structuredGroups\.map\(\(group\) => \{/);
});

test('each Question Type section header shows the type name and its available-question count, and can be collapsed/expanded', () => {
  const headerMatches = source.match(/<span className=\{styles\.typeSectionName\}>\{typeSectionLabel\(group\.type\)\} <span className=\{styles\.bankCount\}>\{group\.questions\.length\}<\/span><\/span>/g) || [];
  assert.equal(headerMatches.length, 2, 'expected one type-section header per branch (phone-screen and structured)');
  assert.match(source, /const \[collapsedTypes, setCollapsedTypes\] = useState<Set<string>>\(\(\) => new Set\(\)\);/, 'sections must start expanded (empty collapsed set)');
  assert.match(source, /function toggleTypeCollapsed\(type: string\)/);
  const toggleMatches = source.match(/onClick=\{\(\) => toggleTypeCollapsed\(group\.type\)\}/g) || [];
  assert.equal(toggleMatches.length, 2, 'both branches must reuse the same toggle function');
});

test('the Custom bucket displays as "Custom Questions" while every other section displays its type name as-is', () => {
  assert.match(source, /function typeSectionLabel\(type: string\) \{\s*\n\s*return type === 'Custom' \? 'Custom Questions' : type;\s*\n\s*\}/);
});

test('sections are ordered by a stable canonical list, not first-seen order - Structured Interview appends Custom then General after the app\'s existing generated Question Type vocabulary', () => {
  assert.match(source, /const STRUCTURED_QUESTION_TYPE_ORDER: readonly string\[\] = \[\.\.\.INTERVIEW_QUESTION_TYPES, 'Custom', 'General'\];/);
  assert.match(source, /groupByType\(availablePhoneScreenQuestions, PHONE_SCREEN_QUESTION_TYPES\)/);
  assert.match(source, /groupByType\(availableQuestions, STRUCTURED_QUESTION_TYPE_ORDER\)/);
});

test('every question card shows its cardTitle as a compact header above the question text, in both branches', () => {
  const cardTitleMatches = source.match(/<p className=\{styles\.cardTitle\}>\{question\.cardTitle\}<\/p>/g) || [];
  assert.equal(cardTitleMatches.length, 2, 'expected a cardTitle header on both the phone-screen and structured question cards');
});

test('a freshly generated batch of questions is tagged, client-side, with the recruiter\'s selected Question Type (or "General" if none was selected) - the generator itself only returns text/areas', () => {
  const generateMoreMatch = source.match(/async function generateMore\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(generateMoreMatch, 'expected generateMore');
  assert.match(generateMoreMatch[1], /const batchType = selectedQuestionType \|\| 'General';/);
  assert.match(generateMoreMatch[1], /questionType: batchType, cardTitle: batchType/);
});

test('a wildcard-dragged custom question defaults to questionType Custom / cardTitle "Custom Question" the same way the button-created one does elsewhere in the builder', () => {
  const blankDragMatch = source.match(/function startBlankDrag\(event: DragEvent<HTMLDivElement>\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(blankDragMatch, 'expected startBlankDrag');
  assert.match(blankDragMatch[1], /questionType: 'Custom',/);
  assert.match(blankDragMatch[1], /cardTitle: 'Custom Question',/);
});
