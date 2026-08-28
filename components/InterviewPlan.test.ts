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

test('Phone Screen custom-question creation has exactly one entry point (the Question Bank panel\'s "+ Custom Screen Question" button) - InterviewPlan.tsx no longer duplicates it with its own button/function', () => {
  assert.doesNotMatch(source, /function addCustomPhoneScreenQuestion\(\)/, 'the old, now-redundant per-form custom-question function must be removed');
  assert.doesNotMatch(source, /\+ Custom Question</, 'the old duplicate toolbar button must be removed');
  // Manual creation for every stage, including Phone Screen, now flows through the one shared bank-add listener.
  const addFromPanelMatch = source.match(/function addFromBankPanel\(event: Event\) \{([\s\S]*?)\n {4}\}/);
  assert.ok(addFromPanelMatch, 'expected the shared addFromBankPanel listener');
  assert.match(addFromPanelMatch[1], /addBankQuestion\(detail\.question\)/);
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

test('the free-text card-title field is gone entirely - neither Phone Screen nor Structured Interview shows a cardTitle input; the Question Type dropdown is the sole header', () => {
  const { phoneScreen, structured } = extractStageBranches();
  for (const branch of [phoneScreen, structured]) {
    assert.doesNotMatch(branch, /styles\.cardTitleInput/, 'no card renders a cardTitle input');
    assert.doesNotMatch(branch, /placeholder="Custom Question"/, 'no free-text placeholder for a title remains');
  }
  assert.doesNotMatch(source, /function setCardTitle\(/, 'setCardTitle is dead code now that nothing calls it');
});

test('cardTitle is retained on the Question type only as an internal, backward-compatible field, always derived from questionType via deriveCardTitle - never independently editable', () => {
  assert.match(source, /function deriveCardTitle\(questionType: string\): string \{/);
  assert.match(source, /return questionType === 'Custom' \? 'Custom Question' : questionType;/);
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

test('every question-creation path sets questionType (and its derived cardTitle) - a manually-added question always defaults to Custom / "Custom Question"', () => {
  assert.match(source, /questionType: string;\s*\n\s*cardTitle: string;/, 'expected both fields on the Question type');
  const manualMatch = source.match(/function addManualQuestion\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(manualMatch);
  assert.match(manualMatch[1], /questionType: 'Custom', cardTitle: 'Custom Question'/);
});

test('every Question Type reassignment - Phone Screen or Structured - goes through the single setQuestionType function, which applies that type\'s canonical template synchronously unless the question is already customized', () => {
  const setQuestionTypeMatch = source.match(/function setQuestionType\(questionId: string, questionType: string\) \{([\s\S]*?)\n {2}\}\n\n {2}function reorderQuestion/);
  assert.ok(setQuestionTypeMatch, 'expected setQuestionType');
  const body = setQuestionTypeMatch[1];
  assert.match(body, /templateForPhoneScreenType\(questionType\)/, 'Phone Screen path must look up a template for the target type');
  assert.match(body, /templateForStructuredType\(bank, selectedKey, questionType\)/, 'Structured path must look up a stage-scoped template for the target type');
  assert.match(body, /isQuestionTextCustomized\(question\.text, currentTemplate\?\.text\)/, 'must decide via the shared customization check, not its own ad hoc logic');
  assert.match(body, /window\.confirm\(/, 'a customized question must be confirmed before its content is replaced');
});

test('a plain reassignment (no template for the target type, e.g. Custom) only ever changes questionType/cardTitle - it never touches text, response, or areas', () => {
  const applyLabelOnlyMatch = source.match(/const applyLabelOnly = \(\) => \{([\s\S]*?)\n {4}\};/);
  assert.ok(applyLabelOnlyMatch, 'expected the label-only fallback inside setQuestionType');
  assert.match(applyLabelOnlyMatch[1], /\{ \.\.\.item, questionType, cardTitle: deriveCardTitle\(questionType\) \}/);
  assert.doesNotMatch(applyLabelOnlyMatch[1], /text:|responseSpec:|areas:/, 'a plain type reassignment must not touch content fields');
});

test('cancelling the replace-content confirmation leaves the question\'s data exactly as it was, and still forces the controlled Question Type <select> back in sync with that unchanged data', () => {
  // Both apply() closures are only invoked from inside the `if (window.confirm(...)) apply();` guard,
  // so declining the confirmation never calls apply() - no code path can still mutate the question's content.
  const confirmGuards = source.match(/if \(window\.confirm\([\s\S]*?\)\) apply\(\);/g);
  assert.ok(confirmGuards && confirmGuards.length >= 2, 'expected a guarded apply() call for both the Phone Screen and Structured paths');
  // A native <select> already shows the just-picked option before this handler runs, so Cancel must still
  // patch (with an identity update) to force React to reconcile the controlled value back to the unchanged data.
  const noOpPatches = source.match(/else patchQuestions\(selectedKey, \(current\) => current\.map\(\(item\) => item\.id === questionId \? \{ \.\.\.item \} : item\)\);/g);
  assert.ok(noOpPatches && noOpPatches.length >= 2, 'expected a no-op patch on Cancel for both the Phone Screen and Structured paths');
});

test('a question\'s questionType/cardTitle is reconstructed on load, preferring the persisted questionType (so a generated question survives reload) and falling back to a sourceId bank lookup, then Custom, only when nothing was persisted', () => {
  const reconstructMatch = source.match(/function reconstructTypeMetadata\(question: \{ sourceId\?: string; questionType\?: string \}, bank: BankQuestion\[\]\): \{ questionType: string; cardTitle: string \} \{([\s\S]*?)\n\}/);
  assert.ok(reconstructMatch, 'expected reconstructTypeMetadata');
  assert.match(reconstructMatch[1], /if \(question\.questionType\) return \{ questionType: question\.questionType, cardTitle: deriveCardTitle\(question\.questionType\) \};/, 'a persisted questionType must win first');
  assert.match(reconstructMatch[1], /bank\.find\(\(item\) => item\.id === question\.sourceId\)/);
  assert.match(reconstructMatch[1], /return \{ questionType: 'Custom', cardTitle: 'Custom Question' \};/);
});

test('every Phone Screen and Structured Interview question card shows a Question Type reassignment selector, immediately above its response/AOE configuration - no separate cardTitle input alongside it', () => {
  const { phoneScreen, structured } = extractStageBranches();
  for (const branch of [phoneScreen, structured]) {
    assert.match(branch, /className=\{styles\.questionTypeSelect\}/);
    assert.match(branch, /onChange=\{\(event\) => setQuestionType\(question\.id, event\.target\.value\)\}/);
  }
  assert.match(phoneScreen, /PHONE_SCREEN_QUESTION_TYPE_OPTIONS\.map\(/, 'Phone Screen must offer its own controlled type list');
  assert.match(structured, /STRUCTURED_QUESTION_TYPE_OPTIONS\.map\(/, 'Structured Interview must offer the generated Question Type vocabulary');

  // Question Type dropdown immediately above AOE for Structured; above the response config for Phone Screen.
  const structuredTypeIndex = structured.indexOf('questionTypeSelect');
  const structuredAreaIndex = structured.indexOf('styles.areaLine');
  assert.ok(structuredTypeIndex >= 0 && structuredAreaIndex > structuredTypeIndex, 'Structured Question Type selector must precede the AOE row');

  const phoneScreenTypeIndex = phoneScreen.indexOf('questionTypeSelect');
  const phoneScreenResponseIndex = phoneScreen.indexOf('styles.responseKindRow');
  assert.ok(phoneScreenTypeIndex >= 0 && phoneScreenResponseIndex > phoneScreenTypeIndex, 'Phone Screen Question Type selector must precede its response configuration');

  // Question text (questionTop/textarea) leads both cards, ahead of the Question Type selector.
  assert.ok(structured.indexOf('questionTop') < structuredTypeIndex, 'question text must render above the Structured Question Type selector');
  assert.ok(phoneScreen.indexOf('questionTop') < phoneScreenTypeIndex, 'question text must render above the Phone Screen Question Type selector');
});

test('a canonical (non-Custom) Phone Screen Question Type hides the manual response-format dropdown - only Custom exposes it', () => {
  const { phoneScreen } = extractStageBranches();
  assert.match(phoneScreen, /question\.questionType === 'Custom' \? \(/, 'the response-kind <select> must be gated on Custom');
  assert.match(phoneScreen, /Response: \{RESPONSE_KIND_OPTIONS\.find/, 'a canonical type shows a plain response-kind label instead');
});

test('the selected form is never regrouped by Question Type - questions render in the recruiter-controlled order from the questions array, with no grouping helper in this file', () => {
  assert.doesNotMatch(source, /groupByType|collapsedTypes|typeSection/, 'InterviewPlan.tsx must not group its own question list - only the Question Bank panel groups');
  assert.match(source, /\{questions\.map\(\(question, index\) => \{/, 'phone-screen form must map the flat questions array directly, preserving order');
});

// --- Available-height usage ---

const editorCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'InterviewPlan.module.css'), 'utf8');

test('the editor no longer reserves a large arbitrary fixed bottom gutter - only a modest one - so it uses the available viewport height beneath its header', () => {
  const editorRuleMatch = editorCss.match(/\.editor\{[^}]*\}/);
  assert.ok(editorRuleMatch, 'expected the base .editor rule');
  assert.doesNotMatch(editorRuleMatch[0], /padding:10px 10px 96px/, 'the old, oversized fixed bottom padding must be gone');
  assert.match(editorRuleMatch[0], /flex:1;min-height:0/, 'the editor must still grow via flex/min-height, not a fixed height');
  assert.match(editorRuleMatch[0], /overflow-y:auto/, 'the editor must keep its own vertical scrolling');
  assert.match(editorRuleMatch[0], /overflow-x:hidden/, 'the editor must never scroll horizontally');
});

test('the editor keeps a dedicated, larger exception only while an AOE picker menu is actually open - that is functional space for the open menu, not wasted chrome', () => {
  assert.match(editorCss, /\.editor:has\(\.areaMenu\)\{padding-bottom:300px\}/);
});

test('switching or opening a stage resets the editor\'s own scroll position to the top, so it never opens clipped mid-question', () => {
  const scrollResetMatch = source.match(/useEffect\(\(\) => \{\s*\n\s*if \(selectedKey && editorRef\.current\) editorRef\.current\.scrollTop = 0;\s*\n\s*\}, \[selectedKey\]\);/);
  assert.ok(scrollResetMatch, 'expected a selectedKey-driven scroll-reset effect targeting editorRef');
  const { phoneScreen, structured } = extractStageBranches();
  assert.match(phoneScreen, /ref=\{editorRef\}/, 'the Phone Screen editor container must be the one being reset');
  assert.match(structured, /ref=\{editorRef\}/, 'the Structured Interview editor container must be the one being reset');
});

// --- Persisted Question Type / Phone Screen response package ---

test('serializeQuestions always emits questionType, and derives responseKind/responseOptions/responseUnit/responseQualifying from responseSpec when present - so a placed question\'s real category and response package are saved, not just its wire flags', () => {
  const serializeMatch = source.match(/function serializeQuestions\(questions: Question\[\]\) \{([\s\S]*?)\n\}/);
  assert.ok(serializeMatch, 'expected serializeQuestions');
  const body = serializeMatch[1];
  assert.match(body, /questionType: question\.questionType,/);
  assert.match(body, /spec \? \{ responseKind: spec\.kind \} : \{\}/);
  assert.match(body, /spec\?\.kind === 'single-choice' && spec\.options\.length > 0 \? \{ responseOptions: spec\.options \} : \{\}/);
  assert.match(body, /spec\?\.kind === 'single-choice' && spec\.qualifying && spec\.qualifying\.length > 0 \? \{ responseQualifying: spec\.qualifying \} : \{\}/);
  assert.match(body, /spec\?\.kind === 'numeric' && spec\.unit \? \{ responseUnit: spec\.unit \} : \{\}/);
});

test('reconstructResponseSpec prefers a persisted responseKind (via responseSpecFromParts) over the sourceId/wire-flag fallback, so a generated Phone Screen question\'s exact response package survives reload', () => {
  const reconstructMatch = source.match(/function reconstructResponseSpec\(question: \{([\s\S]*?)\n\}\): PhoneScreenResponseSpec \{([\s\S]*?)\n\}/);
  assert.ok(reconstructMatch, 'expected reconstructResponseSpec');
  assert.match(reconstructMatch[2], /if \(question\.responseKind\) \{/);
  assert.match(reconstructMatch[2], /responseSpecFromParts\(question\.responseKind, question\.responseOptions, question\.responseUnit, question\.responseQualifying\)/);
  assert.match(reconstructMatch[2], /findPhoneScreenSeed\(question\.sourceId\)/, 'the sourceId fallback must remain for records saved before this migration');
});
