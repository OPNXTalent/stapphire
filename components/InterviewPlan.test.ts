import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This project has no React/DOM testing infrastructure - these tests
// inspect the component's own source for the four-fixed-stage Selection
// Process redesign and the Phone Screen compact-format branch. Existing
// Structured Interview behavior (AOE picker, star scoring, comment
// boxes) is separately protected by interviewStabilization.test.ts and
// is not touched here except to confirm it stays scoped to its own
// branch.

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'InterviewPlan.tsx'), 'utf8');

test('the four stages are fixed - no freeform add/remove/reorder of interviews remains', () => {
  assert.doesNotMatch(source, /function addInterview/);
  assert.doesNotMatch(source, /function removeInterview/);
  assert.doesNotMatch(source, /function reorderInterview/);
  assert.doesNotMatch(source, /\+ Add Interview/);
  assert.doesNotMatch(source, /roundKey\(\)/);
});

test('the not-selected view renders exactly the four fixed stages from INTERVIEW_STAGES, not a dynamic user-created list', () => {
  assert.match(source, /\{INTERVIEW_STAGES\.map\(\(stage\) => \(/, 'expected the stage list to map directly over the fixed INTERVIEW_STAGES constant');
});

test('each stage card shows its tagline (Qualify/Validate/Demonstrate/Differentiate) alongside its name', () => {
  assert.match(source, /<span className=\{styles\.stageTagline\}>\{stage\.tagline\}<\/span>/);
});

test('selecting a stage dispatches the existing workspace-focus/builder-context events with that exact stage id, connecting the right panel (Question Bank) to that stage', () => {
  const effectMatch = source.match(/useEffect\(\(\) => \{\s*\n\s*if \(!selectedStage\) \{([\s\S]*?)\n {2}\}, \[selectedStage, positionTitle\]\);/);
  assert.ok(effectMatch, 'expected the selectedStage-driven focus/context dispatch effect');
  assert.match(effectMatch[1], /const detail = \{ stage: selectedStage, positionTitle \};/);
  assert.match(effectMatch[1], /dispatchEvent\(new CustomEvent\(INTERVIEW_WORKSPACE_FOCUS_EVENT, \{ detail \}\)\)/);
  assert.match(effectMatch[1], /dispatchEvent\(new CustomEvent\(INTERVIEW_BUILDER_CONTEXT_EVENT, \{ detail \}\)\)/);
});

// The two branches of the {isPhoneScreen ? (...) : (...)} ternary are
// extracted by locating the ternary's start and the "  ) : (" boundary
// between its two arms, rather than a single brittle greedy regex.
function extractStageBranches() {
  const startIndex = source.indexOf('{isPhoneScreen ? (');
  assert.ok(startIndex >= 0, 'expected the isPhoneScreen ternary');
  const boundaryIndex = source.indexOf('\n          ) : (\n', startIndex);
  assert.ok(boundaryIndex >= 0, 'expected the boundary between the two ternary arms');
  const endIndex = source.indexOf('\n          )}\n', boundaryIndex);
  assert.ok(endIndex >= 0, 'expected the end of the ternary');
  return {
    phoneScreen: source.slice(startIndex, boundaryIndex),
    structured: source.slice(boundaryIndex, endIndex)
  };
}

test('Phone Screen and the other three stages share the same add/remove/reorder/persistence plumbing (patchQuestions, dropOnQuestion, reorderQuestion, serializePlan) rather than duplicating four separate systems', () => {
  assert.match(source, /function patchQuestions\(stageId: InterviewStageId, updater: \(current: Question\[\]\) => Question\[\]\)/);
  assert.match(source, /function dropOnQuestion\(event: DragEvent<HTMLDivElement>, targetId: string\)/);
  assert.match(source, /function reorderQuestion\(sourceId: string, targetId: string\)/);
  // Both branches must call into these same shared functions, not stage-specific reimplementations.
  const { phoneScreen, structured } = extractStageBranches();
  assert.match(phoneScreen, /onDrop=\{\(event\) => dropOnQuestion\(event, question\.id\)\}/, 'phone-screen branch must reuse dropOnQuestion');
  assert.match(structured, /onDrop=\{\(event\) => dropOnQuestion\(event, question\.id\)\}/, 'structured branch must reuse dropOnQuestion');
});

test('the Phone Screen compact branch never renders Areas of Evaluation, star ratings, score bars, or a permanently visible comment block', () => {
  const { phoneScreen } = extractStageBranches();
  // The phone-screen branch's own copy legitimately mentions "Areas of
  // Evaluation"/"star ratings" in prose to reassure recruiters they are
  // absent - so these checks target the actual AOE/star/scoring
  // machinery (elements, handlers, toggles), not that literal text.
  assert.doesNotMatch(phoneScreen, /styles\.areaLine|styles\.areaButton|styles\.areaChip|styles\.areaMenu/, 'no AOE picker UI');
  assert.doesNotMatch(phoneScreen, /toggleArea\(/, 'no AOE toggling');
  assert.doesNotMatch(phoneScreen, /styles\.star\b|styles\.starGroup|styles\.starSelected/, 'no star rating controls');
  assert.doesNotMatch(phoneScreen, /styles\.scoringTable|styles\.scoringRow/, 'no score table/bars');
  assert.doesNotMatch(phoneScreen, /styles\.commentBoxPreview/, 'no permanently visible comment block');
});

test('the Structured Interview branch keeps its existing AOE/star/scoring/comment-box markup, unchanged and untouched by the Phone Screen redesign', () => {
  const { structured } = extractStageBranches();
  assert.match(structured, /Areas of Evaluation \(\{question\.areas\.length\}\) ▾/);
  assert.match(structured, /styles\.scoringTable/);
  assert.match(structured, /styles\.commentBoxPreview/);
  assert.match(structured, /question\.areas\.length > 0 && \(/);
});

test('each Phone Screen question has an editable response-type control (Yes/No or Short Answer), set via the shared setResponseType function, mutually exclusive', () => {
  const setResponseTypeMatch = source.match(/function setResponseType\(questionId: string, type: PhoneScreenResponseType\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(setResponseTypeMatch, 'expected setResponseType');
  assert.match(setResponseTypeMatch[1], /yesNo: type === 'yes-no', commentBox: type === 'short-answer'/, 'the two response types must be mutually exclusive, not independently toggleable like Structured Interview\'s comment box / yes-no');
});

test('Phone Screen default questions are editable, removable, and reorderable using the same functions as every other question', () => {
  assert.match(source, /function updateQuestion\(questionId: string, patch: Partial<Question>\)/);
  assert.match(source, /function removeQuestion\(questionId: string\)/);
  assert.match(source, /function reorderQuestion\(sourceId: string, targetId: string\)/);
});

test('a flexible Custom Question action is visibly available on the Phone Screen (not the Structured Interview\'s CSS-hidden .addManual button)', () => {
  assert.match(source, /function addCustomPhoneScreenQuestion\(\) \{/);
  assert.match(source, /<button type="button" className=\{styles\.addCustomQuestion\} onClick=\{addCustomPhoneScreenQuestion\}>\+ Custom Question<\/button>/);
  assert.doesNotMatch(source, /addCustomQuestion\{display:none/, 'unlike .addManual, the Phone Screen custom-question action must not be hidden');
});

test('dragging a Phone Screen bank question onto the form gives it the seed\'s intended response type immediately, rather than always defaulting to the Structured Interview comment-box shape', () => {
  const cloneMatch = source.match(/function cloneBankQuestion\(question: BankQuestion\): Question \{([\s\S]*?)\n\}/);
  assert.ok(cloneMatch, 'expected cloneBankQuestion');
  assert.match(cloneMatch[1], /const phoneScreenSeed = PHONE_SCREEN_BANK_QUESTIONS\.find\(\(seed\) => seed\.id === question\.id\);/);
  assert.match(cloneMatch[1], /commentBox: phoneScreenSeed\.responseType === 'short-answer'/);
  assert.match(cloneMatch[1], /yesNo: phoneScreenSeed\.responseType === 'yes-no'/);
  // The pre-existing Structured Interview fallback (protected by interviewStabilization.test.ts) must still exist for non-phone-screen bank ids.
  assert.match(cloneMatch[1], /commentBox: true \};/);
});

test('the persisted plan always serializes exactly the four fixed stage ids, in a stable order, reusing the same wire shape as before (no schema/migration change)', () => {
  const serializeMatch = source.match(/function serializePlan\([\s\S]*?\) \{([\s\S]*?)\n\}/);
  assert.ok(serializeMatch, 'expected serializePlan');
  assert.match(serializeMatch[1], /rounds: INTERVIEW_STAGES\.map\(\(stage\) => \(\{/, 'rounds must be derived from the fixed INTERVIEW_STAGES list, not a dynamic rounds array');
  assert.match(serializeMatch[1], /stage: stage\.id,/);
  assert.match(serializeMatch[1], /commentBox: Boolean\(question\.commentBox\),/);
  assert.match(serializeMatch[1], /yesNo: Boolean\(question\.yesNo\)/);
});

test('loading a persisted plan backfills any missing fixed stage with its defaults, and ignores any legacy non-fixed stage keys, instead of crashing or losing the other three stages', () => {
  const loadMatch = source.match(/for \(const stage of INTERVIEW_STAGES\) \{\s*\n\s*const persisted = persistedRounds\.find\(\(round\) => round\.stage === stage\.id\);\s*\n\s*if \(!persisted\) continue;/);
  assert.ok(loadMatch, 'expected the load loop to iterate the fixed stages and skip (keep defaults for) any stage with no matching persisted round');
});

test('a candidate whose stage tab was never persisted (e.g. a requisition created before this feature) still gets Phone Screen\'s six default questions, not an empty form', () => {
  assert.match(source, /function phoneScreenDefaultQuestions\(\): Question\[\] \{/);
  assert.match(source, /PHONE_SCREEN_DEFAULT_QUESTIONS\.map\(\(seed\) => \(\{/);
});
