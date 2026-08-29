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
  assert.doesNotMatch(phoneScreenReturnMatch[1], /Generate 5 Questions/, 'Phone Screen must not show the Structured Interview AI question generator');
  assert.doesNotMatch(phoneScreenReturnMatch[1], /Manage AOE/, 'Phone Screen must not show Areas of Evaluation management');
  // Phone Screen does get its own, narrower Question Type filter for generation - a real requirement of this pass, distinct from the Structured generator UI it must not duplicate.
  assert.match(phoneScreenReturnMatch[1], /aria-label="Phone Screen Question Type"/);
});

test('the Phone Screen bank\'s static baseline is a small, representative subset of the canonical bank (not the whole 14-question list), combined with any AI-generated Phone Screen questions, both filtered by the shared usedIds tracking', () => {
  assert.match(source, /import \{ PHONE_SCREEN_BANK_QUESTIONS, PHONE_SCREEN_QUESTION_TYPES, responseSpecFromParts, type PhoneScreenQuestionType, type PhoneScreenResponseKind, type PhoneScreenResponseSpec \} from '@\/lib\/phoneScreenQuestions';/);
  assert.match(source, /const PHONE_SCREEN_REPRESENTATIVE_IDS = new Set\(\[/, 'expected a curated representative-id subset');
  const representativeMatch = source.match(/const representativePhoneScreenQuestions = useMemo<AvailableQuestion\[\]>\(\s*\n\s*\(\) => PHONE_SCREEN_BANK_QUESTIONS\s*\n\s*\.filter\(\(question\) => PHONE_SCREEN_REPRESENTATIVE_IDS\.has\(question\.id\) && !usedIds\.has\(question\.id\)\)/);
  assert.ok(representativeMatch, 'expected representativePhoneScreenQuestions to filter the fixed bank down to only the curated ids, excluding used ones');
  const combinedMatch = source.match(/const availablePhoneScreenQuestions = useMemo<AvailableQuestion\[\]>\(\s*\n\s*\(\) => \[\.\.\.generatedPhoneScreenQuestions, \.\.\.representativePhoneScreenQuestions\]\.filter\(\(question\) => !usedIds\.has\(question\.id\)\)/);
  assert.ok(combinedMatch, 'expected the combined available list to merge generated and representative questions, filtered by usedIds');
});

test('a representative subset of exactly the specified four questions (Schedule, Work Arrangement, Travel, Language) is curated for the static baseline', () => {
  const idsMatch = source.match(/const PHONE_SCREEN_REPRESENTATIVE_IDS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(idsMatch);
  assert.equal((idsMatch[1].match(/'phone-screen-bank-\d+'/g) || []).length, 4, 'expected exactly four curated ids');
});

test('each Phone Screen bank question carries its canonical response metadata AND its questionType/cardTitle through the drag payload, not just its text/areas', () => {
  assert.match(source, /\.map\(\(question\) => \(\{ id: question\.id, text: question\.text, areas: \[\], response: question\.response, questionType: question\.questionType, cardTitle: question\.cardTitle \}\)\)/, 'availablePhoneScreenQuestions must preserve response/questionType/cardTitle so cloneBankQuestion on the receiving side can see them');
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

test('Structured Interview keeps its single "Create Your Own Question" wildcard tile; Phone Screen replaces it with exactly one clear manual-creation action ("+ Custom Screen Question"), never both', () => {
  const matches = source.match(/draggable onDragStart=\{startBlankDrag\}/g) || [];
  assert.equal(matches.length, 1, 'Structured Interview must keep exactly one wildcard tile; Phone Screen must not have its own copy of it');

  const phoneScreenReturnMatch = source.match(/if \(isPhoneScreen\) \{([\s\S]*?)\n {2}\}\n\n {2}return \(/);
  assert.ok(phoneScreenReturnMatch);
  assert.doesNotMatch(phoneScreenReturnMatch[1], /Create Your Own Question/, 'the old Phone Screen wildcard tile must be gone');
  const customButtonMatches = phoneScreenReturnMatch[1].match(/\+ Custom Screen Question/g) || [];
  assert.equal(customButtonMatches.length, 1, 'expected exactly one manual-creation action on Phone Screen');
  assert.match(phoneScreenReturnMatch[1], /onClick=\{addCustomPhoneScreenQuestion\}/);
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
  const headerMatches = source.match(/<span className=\{styles\.typeSectionName\}>\{group\.type\} <span className=\{styles\.bankCount\}>\{group\.questions\.length\}<\/span><\/span>/g) || [];
  assert.equal(headerMatches.length, 2, 'expected one type-section header per branch (phone-screen and structured)');
  assert.match(source, /const \[collapsedTypes, setCollapsedTypes\] = useState<Set<string>>\(\(\) => new Set\(\)\);/, 'sections must start expanded (empty collapsed set)');
  assert.match(source, /function toggleTypeCollapsed\(type: string\)/);
  const toggleMatches = source.match(/onClick=\{\(\) => toggleTypeCollapsed\(group\.type\)\}/g) || [];
  assert.equal(toggleMatches.length, 2, 'both branches must reuse the same toggle function');
});

test('Custom is never a reusable, drag-from-the-bank category - groupByType excludes it entirely so manual-creation stays outside the alphabetized sections', () => {
  const groupByTypeMatch = source.match(/function groupByType<T extends \{ questionType: string \}>\(questions: T\[\]\): QuestionGroup<T>\[\] \{([\s\S]*?)\n\}/);
  assert.ok(groupByTypeMatch, 'expected groupByType');
  assert.match(groupByTypeMatch[1], /if \(question\.questionType === 'Custom'\) continue;/);
  assert.doesNotMatch(source, /function typeSectionLabel\(/, 'no separate "Custom Questions" label function should remain now that Custom is excluded outright');
});

test('sections sort alphabetically, case-insensitively (so a capitalization difference never splits one category into two), by Question Type - not a fixed canonical order or first-seen order', () => {
  const groupByTypeMatch = source.match(/function groupByType<T extends \{ questionType: string \}>\(questions: T\[\]\): QuestionGroup<T>\[\] \{([\s\S]*?)\n\}/);
  assert.ok(groupByTypeMatch);
  assert.match(groupByTypeMatch[1], /\.trim\(\)\.toLocaleLowerCase\(\)/, 'grouping key must be normalized so capitalization differences merge into one category');
  assert.match(groupByTypeMatch[1], /\.sort\(\(a, b\) => a\.type\.localeCompare\(b\.type, undefined, \{ sensitivity: 'base' \}\)\)/, 'groups must be sorted alphabetically, case-insensitively');
  assert.doesNotMatch(source, /STRUCTURED_QUESTION_TYPE_ORDER|PHONE_SCREEN_QUESTION_TYPE_ORDER/, 'no fixed canonical ordering list should remain');
  assert.match(source, /const phoneScreenGroups = useMemo\(\s*\n\s*\(\) => groupByType\(availablePhoneScreenQuestions\),/);
  assert.match(source, /const structuredGroups = useMemo\(\s*\n\s*\(\) => groupByType\(availableQuestions\),/);
});

test('empty categories never render - groupByType only returns groups with at least one available question', () => {
  const groupByTypeMatch = source.match(/function groupByType<T extends \{ questionType: string \}>\(questions: T\[\]\): QuestionGroup<T>\[\] \{([\s\S]*?)\n\}/);
  assert.ok(groupByTypeMatch);
  assert.match(groupByTypeMatch[1], /\.filter\(\(group\) => group\.questions\.length > 0\)/);
});

test('every question card shows its cardTitle as a compact header above the question text, in both branches', () => {
  const cardTitleMatches = source.match(/<p className=\{styles\.cardTitle\}>\{question\.cardTitle\}<\/p>/g) || [];
  assert.equal(cardTitleMatches.length, 2, 'expected a cardTitle header on both the phone-screen and structured question cards');
});

test('a freshly generated batch of questions is categorized using the server-validated, real per-question Question Type from the response\'s `generated` field - never a single client-side guessed label for the whole batch', () => {
  const generateMoreMatch = source.match(/async function generateMore\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(generateMoreMatch, 'expected generateMore');
  assert.doesNotMatch(generateMoreMatch[1], /const batchType = selectedQuestionType/, 'must not tag an entire mixed batch with one guessed type');
  assert.match(generateMoreMatch[1], /Array\.isArray\(result\.generated\)/, 'must read the server-computed per-question metadata');
  assert.match(generateMoreMatch[1], /questionType: question\.questionType,\s*\n\s*cardTitle: question\.questionType/);
});

test('generateMore and generatePhoneScreenQuestionsAction both auto-expand every Question Type category their batch just populated', () => {
  const generateMoreMatch = source.match(/async function generateMore\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(generateMoreMatch);
  assert.match(generateMoreMatch[1], /const newTypes = new Set\(questions\.map\(\(question\) => question\.questionType\)\);/);
  assert.match(generateMoreMatch[1], /next\.delete\(type\)/);

  const phoneScreenGenerateMatch = source.match(/async function generatePhoneScreenQuestionsAction\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(phoneScreenGenerateMatch, 'expected generatePhoneScreenQuestionsAction');
  assert.match(phoneScreenGenerateMatch[1], /const newTypes = new Set\(questions\.map\(\(question\) => question\.questionType\)\);/);
});

test('generatePhoneScreenQuestionsAction posts stage: \'phone-screen\' and merges the server\'s validated per-question metadata (including its reconstructed response spec) into the Phone Screen bank', () => {
  const phoneScreenGenerateMatch = source.match(/async function generatePhoneScreenQuestionsAction\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(phoneScreenGenerateMatch);
  assert.match(phoneScreenGenerateMatch[1], /body: JSON\.stringify\(\{ stage: 'phone-screen', questionType: phoneScreenQuestionType \|\| null, requestId \}\)/);
  assert.match(phoneScreenGenerateMatch[1], /responseSpecFromParts\(question\.responseKind, question\.responseOptions, question\.responseUnit\)/);
  assert.match(phoneScreenGenerateMatch[1], /setGeneratedPhoneScreenQuestions\(/);
});

test('a wildcard-dragged custom question (Structured Interview) defaults to questionType Custom / cardTitle "Custom Question"', () => {
  const blankDragMatch = source.match(/function startBlankDrag\(event: DragEvent<HTMLDivElement>\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(blankDragMatch, 'expected startBlankDrag');
  assert.match(blankDragMatch[1], /questionType: 'Custom',/);
  assert.match(blankDragMatch[1], /cardTitle: 'Custom Question'/);
});

test('the Phone Screen "+ Custom Screen Question" button dispatches the same INTERVIEW_BANK_ADD_EVENT the drag-and-drop transport uses, with a fresh, unique id and Custom questionType/cardTitle', () => {
  const addCustomMatch = source.match(/function addCustomPhoneScreenQuestion\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(addCustomMatch, 'expected addCustomPhoneScreenQuestion');
  assert.match(addCustomMatch[1], /id: `custom-phone-screen-\$\{suffix\}`/);
  assert.match(addCustomMatch[1], /questionType: 'Custom',/);
  assert.match(addCustomMatch[1], /cardTitle: 'Custom Question',/);
  assert.match(addCustomMatch[1], /response: \{ kind: 'short-answer' \}/);
  assert.match(addCustomMatch[1], /dispatchEvent\(new CustomEvent\(INTERVIEW_BANK_ADD_EVENT, \{ detail: \{ question \} \}\)\)/);
});

// --- Generation request idempotency (client-side lifecycle) ---
// The database function recognizes a retried generation attempt by its
// requestId, so the client must mint one id per attempt and only reuse
// it across an UNCERTAIN failure (the fetch itself never returned a
// response - whether the server-side charge/insert happened is
// unknown). A DEFINITIVE outcome - success or a clean error response -
// must clear it, since the atomic RPC guarantees a clean error means
// nothing was charged, so the next click is a genuinely new action.

test('generateMore mints a request id only when none is already pending, reusing a pending one across a retry rather than replacing it', () => {
  const generateMoreMatch = source.match(/async function generateMore\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(generateMoreMatch);
  assert.match(generateMoreMatch[1], /const requestId = structuredRequestId \?\? createRequestId\(\);/);
  assert.match(generateMoreMatch[1], /if \(!structuredRequestId\) setStructuredRequestId\(requestId\);/);
});

test('generateMore tracks whether a real HTTP response was obtained, and only clears the pending request id on a definitive outcome - preserving it when fetch itself never returned a response', () => {
  const generateMoreMatch = source.match(/async function generateMore\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(generateMoreMatch);
  const body = generateMoreMatch[1];
  assert.match(body, /let gotResponse = false;/);
  assert.match(body, /gotResponse = true;/);
  // gotResponse is set immediately after fetch() resolves, before any
  // later throw (a non-ok status, malformed JSON, etc.) - so every
  // failure that reaches the catch block after this point is a
  // definitive one.
  const fetchIndex = body.indexOf('await fetch(');
  const gotResponseIndex = body.indexOf('gotResponse = true;');
  assert.ok(fetchIndex >= 0 && gotResponseIndex > fetchIndex);
  assert.match(body, /setStructuredRequestId\(null\);\s*\n\s*\} catch \(generationError\) \{/, 'success must clear the pending id');
  assert.match(body, /if \(gotResponse\) setStructuredRequestId\(null\);/, 'a definitive error response must also clear it, but only when a response was actually obtained');
});

test('generatePhoneScreenQuestionsAction has the exact same request id lifecycle as generateMore, using its own independent pending id', () => {
  const match = source.match(/async function generatePhoneScreenQuestionsAction\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(match);
  const body = match[1];
  assert.match(body, /const requestId = phoneScreenRequestId \?\? createRequestId\(\);/);
  assert.match(body, /if \(!phoneScreenRequestId\) setPhoneScreenRequestId\(requestId\);/);
  assert.match(body, /let gotResponse = false;/);
  assert.match(body, /gotResponse = true;/);
  assert.match(body, /setPhoneScreenRequestId\(null\);\s*\n\s*\} catch \(generationError\) \{/);
  assert.match(body, /if \(gotResponse\) setPhoneScreenRequestId\(null\);/);
});

test('createRequestId is a single shared helper, not duplicated per call site', () => {
  const definitions = source.match(/function createRequestId\(\)/g) || [];
  assert.equal(definitions.length, 1);
  const usages = source.match(/createRequestId\(\)/g) || [];
  assert.equal(usages.length, 3, 'expected the definition plus exactly two call sites (structured and Phone Screen)');
});

