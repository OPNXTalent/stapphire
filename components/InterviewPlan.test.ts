import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This project has no React/DOM testing infrastructure - these tests
// inspect the component's own source for the four-fixed-stage Selection
// Process redesign, the full-width Phone Screen question-card branch
// (sharing its visual shell with Structured Interview), its rich
// response-kind controls, and the preservation of legacy/additional
// rounds. Existing Structured Interview behavior (AOE picker, star
// scoring, comment boxes) is separately protected by
// interviewStabilization.test.ts and is not touched here except to
// confirm it stays scoped to its own branch.

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'InterviewPlan.tsx'), 'utf8');
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'InterviewPlan.module.css'), 'utf8');

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

test('none of the four stage-concept badges (Qualify/Validate/Demonstrate/Differentiate) render anywhere in the stage bar - presentation only, the underlying tagline classification stays intact', () => {
  assert.doesNotMatch(source, />Qualify</);
  assert.doesNotMatch(source, />Validate</);
  assert.doesNotMatch(source, />Demonstrate</);
  assert.doesNotMatch(source, />Differentiate</);
  // The legacy round's own, distinct "Needs stage assignment" badge is unrelated to this cleanup and must be unaffected.
  const renderStageCardMatch = source.match(/function renderStageCard\(info: StageCardInfo, selected = false\) \{([\s\S]*?)\n  \}/);
  assert.ok(renderStageCardMatch, 'expected renderStageCard');
  assert.match(renderStageCardMatch[1], /info\.legacy \? \(/, 'a legacy round must still branch to its own badge');
  assert.match(renderStageCardMatch[1], /<span className=\{`\$\{styles\.stageTagline\} \$\{styles\.legacyTagline\}`\}>\{info\.tagline\}<\/span>/);
});

test('each of the four fixed stages shows its canonical one-sentence explanation directly under its name in the stage bar, wrapping cleanly rather than being truncated', () => {
  const renderStageCardMatch = source.match(/function renderStageCard\(info: StageCardInfo, selected = false\) \{([\s\S]*?)\n  \}/);
  assert.ok(renderStageCardMatch, 'expected renderStageCard');
  assert.match(renderStageCardMatch[1], /<span className=\{styles\.roundTitleStack\}>/);
  assert.match(renderStageCardMatch[1], /<span className=\{styles\.roundName\}>\{info\.label\}<\/span>/);
  assert.match(renderStageCardMatch[1], /info\.description && <span className=\{styles\.roundExplainer\}>\{info\.description\}<\/span>/);
  assert.match(source, /function stageCardInfoFor\(stage: typeof INTERVIEW_STAGES\[number\]\): StageCardInfo \{\s*\n\s*return \{ key: stage\.id, label: stage\.label, tagline: stage\.tagline, description: stage\.description \};/, 'the canonical description must flow from INTERVIEW_STAGES, not be hardcoded per stage');
});

test('candidate/question counts stay in the right-hand column of the stage bar regardless of explanation length', () => {
  const renderStageCardMatch = source.match(/function renderStageCard\(info: StageCardInfo, selected = false\) \{([\s\S]*?)\n  \}/);
  assert.ok(renderStageCardMatch);
  assert.match(renderStageCardMatch[1], /<span className=\{styles\.roundMeta\}>/);
  assert.match(renderStageCardMatch[1], /\{candidateNames\.length\} Candidates/);
  assert.match(renderStageCardMatch[1], /\{stageQuestions\.length\} Question/);
});

test('the underlying stage classification (tagline field) is preserved on INTERVIEW_STAGES and on StageCardInfo, even though the badge is no longer rendered for a canonical stage', () => {
  assert.match(source, /type StageCardInfo = \{ key: string; label: string; tagline: string; description\?: string; legacy\?: boolean \};/);
});

test('selecting a stage dispatches the existing workspace-focus/builder-context events with that exact stage id, connecting the right panel (Question Bank) to that stage', () => {
  const effectMatch = source.match(/useEffect\(\(\) => \{\s*\n\s*if \(!selectedKey\) \{([\s\S]*?)\n {2}\}, \[selectedKey, positionTitle\]\);/);
  assert.ok(effectMatch, 'expected the selectedKey-driven focus/context dispatch effect');
  assert.match(effectMatch[1], /const detail = \{ stage: selectedKey, positionTitle \};/);
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
  assert.match(source, /function patchQuestions\(stageKey: string, updater: \(current: Question\[\]\) => Question\[\]\)/);
  assert.match(source, /function dropOnQuestion\(event: DragEvent<HTMLDivElement>, targetId: string\)/);
  assert.match(source, /function reorderQuestion\(sourceId: string, targetId: string\)/);
  // Both branches must call into these same shared functions, not stage-specific reimplementations.
  const { phoneScreen, structured } = extractStageBranches();
  assert.match(phoneScreen, /onDrop=\{\(event\) => dropOnQuestion\(event, question\.id\)\}/, 'phone-screen branch must reuse dropOnQuestion');
  assert.match(structured, /onDrop=\{\(event\) => dropOnQuestion\(event, question\.id\)\}/, 'structured branch must reuse dropOnQuestion');
});

test('the Phone Screen branch never renders Areas of Evaluation, star ratings, score bars, or a permanently visible comment block', () => {
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

// --- Correction 1: rich, semantically-required response kinds ---

test('each Phone Screen question has a response-kind selector offering all five semantic kinds, not just Yes/No and Short Answer', () => {
  const { phoneScreen } = extractStageBranches();
  assert.match(phoneScreen, /RESPONSE_KIND_OPTIONS\.map\(\(option\) => \(/, 'expected the response-kind <select> to be driven by the full RESPONSE_KIND_OPTIONS list');
  const optionsMatch = source.match(/const RESPONSE_KIND_OPTIONS: \{ value: PhoneScreenResponseKind; label: string \}\[\] = \[([\s\S]*?)\];/);
  assert.ok(optionsMatch, 'expected RESPONSE_KIND_OPTIONS');
  for (const kind of ['yes-no', 'yes-no-needs-discussion', 'single-choice', 'numeric', 'short-answer']) {
    assert.match(optionsMatch[1], new RegExp(`value: '${kind}'`), `expected ${kind} to be offered as a response kind`);
  }
});

test('changing a question\'s response kind goes through the single setResponseSpec function, which keeps responseSpec and its wire-flag derivation in sync', () => {
  const setResponseSpecMatch = source.match(/function setResponseSpec\(questionId: string, spec: PhoneScreenResponseSpec\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(setResponseSpecMatch, 'expected setResponseSpec');
  assert.match(setResponseSpecMatch[1], /const flags = responseSpecToWireFlags\(spec\);/);
  assert.match(setResponseSpecMatch[1], /responseSpec: spec, commentBox: flags\.commentBox, yesNo: flags\.yesNo/);
});

test('single-choice questions expose an editable options control, and numeric questions expose an editable unit control, conditionally rendered by response kind', () => {
  const { phoneScreen } = extractStageBranches();
  assert.match(phoneScreen, /spec\.kind === 'single-choice' &&/);
  assert.match(phoneScreen, /spec\.kind === 'numeric' &&/);
  assert.match(phoneScreen, /placeholder="Options, comma separated"/);
  assert.match(phoneScreen, /placeholder="Unit \(optional, e\.g\. years\)"/);
});

test('the old two-button Yes/No-vs-Short-Answer toggle and its narrow PhoneScreenResponseType are gone', () => {
  assert.doesNotMatch(source, /function setResponseType\(/);
  assert.doesNotMatch(source, /PhoneScreenResponseType/);
  assert.doesNotMatch(source, /responseTypeOf\(/);
  assert.doesNotMatch(source, /styles\.responseTypeRow/);
});

test('dragging a Phone Screen bank question onto the form gives it the seed\'s intended response spec immediately, reading it straight off the BankQuestion the canonical adapter already carries - not re-imported/re-derived from a second question list', () => {
  const cloneMatch = source.match(/function cloneBankQuestion\(question: BankQuestion\): Question \{([\s\S]*?)\n\}/);
  assert.ok(cloneMatch, 'expected cloneBankQuestion');
  assert.match(cloneMatch[1], /if \(question\.response\) \{/);
  assert.match(cloneMatch[1], /const flags = responseSpecToWireFlags\(question\.response\);/);
  assert.match(cloneMatch[1], /responseSpec: question\.response/);
  // The pre-existing Structured Interview fallback (protected by interviewStabilization.test.ts) must still exist for non-phone-screen bank entries.
  assert.match(cloneMatch[1], /commentBox: true,/);
  assert.doesNotMatch(source, /import \{ PHONE_SCREEN_BANK_QUESTIONS/, 'cloneBankQuestion must not need a direct import of the bank list - the canonical response travels through BankQuestion itself');
});

test('cloneBankQuestion and every question-creation path carry questionType/cardTitle through from the bank/seed - never left undefined', () => {
  assert.match(source, /questionType: question\.questionType,\s*\n\s*cardTitle: question\.cardTitle/);
  assert.match(source, /questionType: seed\.questionType,\s*\n\s*cardTitle: seed\.cardTitle/);
});

test('a Phone Screen question\'s response kind (and single-choice options / numeric unit) can only be represented up to what the two persisted flags allow - only yes-no and short-answer are honestly wire-representable, the rest defer to a client-side view model', () => {
  assert.match(source, /function reconstructResponseSpec\(/, 'expected a reconstruction helper used on load');
  assert.match(source, /return wireFlagsToResponseSpec\(\{ commentBox: Boolean\(question\.commentBox\), yesNo: Boolean\(question\.yesNo\) \}\);/);
});

test('a candidate whose stage tab was never persisted (e.g. a requisition created before this feature) still gets Phone Screen\'s six default questions, not an empty form', () => {
  assert.match(source, /function phoneScreenDefaultQuestions\(\): Question\[\] \{/);
  assert.match(source, /PHONE_SCREEN_DEFAULT_QUESTIONS\.map\(\(seed\) => \{/);
});

test('round-1\'s starter/default questions are filtered by stage, not positionally sliced across the whole flattened bank - phone-screen now contributing 20 entries must not crowd them out', () => {
  const starterMatch = source.match(/function starterQuestionsFor\(stageId: InterviewStageId, bank: BankQuestion\[\]\): Question\[\] \{([\s\S]*?)\n\}/);
  assert.ok(starterMatch, 'expected starterQuestionsFor');
  assert.match(starterMatch[1], /bank\.filter\(\(question\) => question\.stage === 'round-1'\)\.slice\(0, 5\)\.map\(cloneBankQuestion\)/);
  assert.doesNotMatch(starterMatch[1], /bank\.slice\(0, 11\)/, 'must not positionally slice the flattened bank');
});

// --- Full-width Phone Screen card redesign (shared shell with Structured Interview) ---
// The compact multi-column grid is gone; Phone Screen now reuses the
// exact same full-width, vertically-stacked question-card shell as
// Structured Interview (.editor/.questionCard/.dragHandle/.questionMain/
// .questionTop), differing only in its evidence-collection controls
// (Response Type instead of AOE/star/scoring/comment box).

test('Phone Screen no longer uses a compact grid or multi-column auto-fill layout', () => {
  assert.doesNotMatch(source, /compactGrid|compactCard|compactCardHead|compactQuestionText|compactDropEnd/, 'no trace of the old compact-card classes should remain');
  assert.doesNotMatch(source, /auto-fill/, 'no multi-column auto-fill grid anywhere in the builder');
});

test('Phone Screen questions render in a full-width vertical sequence, reusing the identical shell classes Structured Interview already uses (.editor/.questionCard/.dragHandle/.questionMain/.questionTop/.questionNumber/.removeQuestion)', () => {
  const { phoneScreen, structured } = extractStageBranches();
  for (const sharedClass of ['editor', 'questionCard', 'dragHandle', 'questionMain', 'questionTop', 'questionNumber', 'removeQuestion', 'dropEnd']) {
    const pattern = new RegExp(`styles\\.${sharedClass}\\b`);
    assert.match(phoneScreen, pattern, `Phone Screen must reuse styles.${sharedClass}`);
    assert.match(structured, pattern, `Structured Interview must still use styles.${sharedClass}`);
  }
  // One full-width card per row, vertically stacked in recruiter-defined order - the same flat, unsliced map used before.
  assert.match(phoneScreen, /\{questions\.map\(\(question, index\) => \{/);
});

test('a built-in Phone Screen question never shows a duplicate heading (e.g. both "Location" and "Location") - the free-text card-title input only renders once the question is genuinely Custom', () => {
  const { phoneScreen } = extractStageBranches();
  const headerMatch = phoneScreen.match(/<div className=\{styles\.cardHeaderRow\}>([\s\S]*?)<\/div>/);
  assert.ok(headerMatch, 'expected the Phone Screen card header row');
  assert.match(headerMatch[1], /question\.questionType === 'Custom' && \(/, 'the cardTitle input must be gated on questionType === Custom, not always shown');
  assert.match(headerMatch[1], /className=\{styles\.questionTypeSelect\}/, 'the Question Type selector is always shown - it is the sole header for a built-in question');
});

test('a Custom Phone Screen question still shows its editable card title, defaulting to "Custom Question", alongside its (reassignable) Custom type', () => {
  assert.match(source, /questionType: 'Custom', cardTitle: 'Custom Question'/, 'addCustomPhoneScreenQuestion must still seed this default');
  const { phoneScreen } = extractStageBranches();
  assert.match(phoneScreen, /placeholder="Custom Question"/);
});

test('Response Type and its applicable configuration still render beneath the question text inside the shared full-width card, unaffected by the layout change', () => {
  const { phoneScreen } = extractStageBranches();
  assert.match(phoneScreen, /<div className=\{styles\.responseKindRow\}>/);
  assert.match(phoneScreen, /Response type<\/label>/);
  assert.match(phoneScreen, /spec\.kind === 'single-choice' &&/);
  assert.match(phoneScreen, /spec\.kind === 'numeric' &&/);
});

test('the Phone Screen card still wires onDragOver/onDrop to the same dropOnQuestion/parseBankQuestion machinery as Structured Interview - drag/drop was not reimplemented for the new shell', () => {
  const { phoneScreen, structured } = extractStageBranches();
  assert.match(phoneScreen, /onDrop=\{\(event\) => dropOnQuestion\(event, question\.id\)\}/);
  assert.match(structured, /onDrop=\{\(event\) => dropOnQuestion\(event, question\.id\)\}/);
  const phoneScreenDragStart = phoneScreen.match(/onDragStart=\{\(event\) => \{\s*\n\s*event\.dataTransfer\.effectAllowed = 'move';\s*\n\s*event\.dataTransfer\.setData\('text\/plain', question\.id\);\s*\n\s*setDraggedQuestionId\(question\.id\);\s*\n\s*\}\}/);
  assert.ok(phoneScreenDragStart, 'Phone Screen reorder drag-start must match the Structured Interview pattern exactly');
});

// --- Correction 3: preserving non-fixed/legacy rounds ---

test('loading a persisted plan backfills any missing fixed stage with its defaults, and never guesses a canonical stage for a non-fixed round', () => {
  const loadMatch = source.match(/for \(const stage of INTERVIEW_STAGES\) \{\s*\n\s*const persisted = persistedRounds\.find\(\(round\) => round\.stage === stage\.id\);\s*\n\s*if \(!persisted\) continue;/);
  assert.ok(loadMatch, 'expected the load loop to iterate the fixed stages and skip (keep defaults for) any stage with no matching persisted round');
});

test('any persisted round whose stage is not one of the four canonical ids is kept, verbatim and in order, as an additionalKeys entry - never mapped, dropped, or mutated', () => {
  const legacyLoadMatch = source.match(/for \(const round of persistedRounds\) \{\s*\n\s*if \(isCanonicalStage\(round\.stage\)\) continue;\s*\n\s*loadedTitles\[round\.stage\] = String\(round\.title \|\| round\.stage\);\s*\n\s*loadedQuestions\[round\.stage\] = parsePersistedQuestions\(round, false, bank\);\s*\n\s*loadedAdditionalKeys\.push\(round\.stage\);\s*\n\s*\}/);
  assert.ok(legacyLoadMatch, 'expected the legacy-round preservation loop to read the round\'s stage/title/questions verbatim, with no title-based guessing of a canonical stage');
  assert.doesNotMatch(source, /guessStage|inferStage|mapTitleToStage/i, 'must never attempt to guess a canonical stage from a legacy round\'s title');
});

test('serializePlan re-emits every additionalKeys round on every save, so autosave (delete-then-reinsert on the server) never silently drops a legacy round', () => {
  const serializeMatch = source.match(/function serializePlan\([\s\S]*?\) \{([\s\S]*?)\n\}/);
  assert.ok(serializeMatch, 'expected serializePlan');
  assert.match(serializeMatch[1], /\.\.\.INTERVIEW_STAGES\.map\(\(stage\) => \(\{/, 'the four fixed stages must still come from the fixed INTERVIEW_STAGES list');
  assert.match(serializeMatch[1], /\.\.\.additionalKeys\.map\(\(key\) => \(\{/, 'every additionalKeys round must also be serialized');
  assert.match(serializeMatch[1], /stage: key,/);
});

test('a legacy/additional round is rendered in a clearly-labeled, distinct section of the not-selected view - not merged silently into the four fixed stage cards', () => {
  assert.match(source, /\{additionalKeys\.length > 0 && \(/);
  assert.match(source, /data-additional-interviews="true"/);
  assert.match(source, /legacyCardInfoFor\(key, titlesByKey\[key\]\)/);
});

test('a legacy round\'s card is visibly distinguished ("Needs stage assignment"), not given one of the four canonical taglines', () => {
  const legacyInfoMatch = source.match(/function legacyCardInfoFor\(key: string, title: string\): StageCardInfo \{([\s\S]*?)\n\}/);
  assert.ok(legacyInfoMatch, 'expected legacyCardInfoFor');
  assert.match(legacyInfoMatch[1], /tagline: 'Needs stage assignment'/);
});

test('selecting a legacy round routes through the existing Structured Interview editor branch (its full AOE/star/scoring/comment-box configuration stays reachable), never the Phone Screen branch', () => {
  assert.match(source, /const isPhoneScreen = selectedKey === 'phone-screen';/, 'a legacy key can never equal the literal phone-screen id, so it always falls into the structured branch');
});

// --- Question Type metadata (questionType / cardTitle) ---

test('every question-creation path sets both questionType and cardTitle - a custom question defaults to Custom / "Custom Question"', () => {
  assert.match(source, /questionType: string;\s*\n\s*cardTitle: string;/, 'expected both fields on the Question type');
  const manualMatch = source.match(/function addManualQuestion\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(manualMatch);
  assert.match(manualMatch[1], /questionType: 'Custom', cardTitle: 'Custom Question'/);
  const customPhoneScreenMatch = source.match(/function addCustomPhoneScreenQuestion\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(customPhoneScreenMatch);
  assert.match(customPhoneScreenMatch[1], /questionType: 'Custom', cardTitle: 'Custom Question'/);
});

test('renaming a card title (setCardTitle) never touches questionType, and reassigning a Question Type (setQuestionType) never touches cardTitle - the two are decoupled', () => {
  const setCardTitleMatch = source.match(/function setCardTitle\(questionId: string, cardTitle: string\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(setCardTitleMatch, 'expected setCardTitle');
  assert.match(setCardTitleMatch[1], /\{ \.\.\.question, cardTitle \}/);
  assert.doesNotMatch(setCardTitleMatch[1], /questionType/, 'setCardTitle must not touch questionType');

  const setQuestionTypeMatch = source.match(/function setQuestionType\(questionId: string, questionType: string\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(setQuestionTypeMatch, 'expected setQuestionType');
  assert.match(setQuestionTypeMatch[1], /\{ \.\.\.question, questionType \}/);
  assert.doesNotMatch(setQuestionTypeMatch[1], /cardTitle/, 'setQuestionType must not touch cardTitle');
});

test('a question\'s questionType/cardTitle is reconstructed on load by looking the sourceId up in the bank (covering every stage, not just phone-screen), falling back to Custom for a question the bank can\'t resolve', () => {
  const reconstructMatch = source.match(/function reconstructTypeMetadata\(sourceId: string \| undefined, bank: BankQuestion\[\]\): \{ questionType: string; cardTitle: string \} \{([\s\S]*?)\n\}/);
  assert.ok(reconstructMatch, 'expected reconstructTypeMetadata');
  assert.match(reconstructMatch[1], /bank\.find\(\(question\) => question\.id === sourceId\)/);
  assert.match(reconstructMatch[1], /return \{ questionType: 'Custom', cardTitle: 'Custom Question' \};/);
});

test('Phone Screen keeps its conditional custom title, while Structured Interview removes the redundant title bar and keeps Question Type', () => {
  const { phoneScreen, structured } = extractStageBranches();
  assert.match(phoneScreen, /className=\{styles\.cardTitleInput\}/);
  assert.match(phoneScreen, /onChange=\{\(event\) => setCardTitle\(question\.id, event\.target\.value\)\}/);
  assert.doesNotMatch(structured, /className=\{styles\.cardTitleInput\}/, 'the long Structured Interview title bar must be removed');
  for (const branch of [phoneScreen, structured]) {
    assert.match(branch, /className=\{styles\.questionTypeSelect\}/);
    assert.match(branch, /onChange=\{\(event\) => setQuestionType\(question\.id, event\.target\.value\)\}/);
  }
  assert.match(phoneScreen, /PHONE_SCREEN_QUESTION_TYPE_OPTIONS\.map\(/, 'Phone Screen must offer its own controlled type list');
  assert.match(structured, /STRUCTURED_QUESTION_TYPE_OPTIONS\.map\(/, 'Structured Interview must offer the generated Question Type vocabulary');
});

test('the sole Question Type control is compact and left-aligned, and the question number no longer indents the textarea', () => {
  assert.match(css, /\.cardHeaderRow \.questionTypeSelect:only-child\{grid-column:1;max-width:150px;justify-self:start\}/);
  assert.match(css, /\.questionTop\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;/);
  assert.match(css, /\.questionNumber\{grid-column:1\/-1;/, 'the question number must sit above rather than left of the textarea');
  assert.match(css, /\.questionTop textarea\{grid-column:1;box-sizing:border-box;width:100%;/, 'the textarea must begin at the question-content left edge');
});

test('the selected form is never regrouped by Question Type - questions render in the recruiter-controlled order from the questions array, with no grouping helper in this file', () => {
  assert.doesNotMatch(source, /groupByType|collapsedTypes|typeSection/, 'InterviewPlan.tsx must not group its own question list - only the Question Bank panel groups');
  assert.match(source, /\{questions\.map\(\(question, index\) => \{/, 'phone-screen form must map the flat questions array directly, preserving order');
});
