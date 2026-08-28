'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AREAS_OF_EVALUATION,
  buildQuestionBank,
  INTERVIEW_STAGES,
  type BankQuestion,
  type InterviewStageId
} from '@/lib/interviewQuestionBank';
import {
  PHONE_SCREEN_DEFAULT_QUESTIONS,
  PHONE_SCREEN_QUESTION_TYPES,
  findPhoneScreenSeed,
  responseSpecForKind,
  responseSpecToWireFlags,
  wireFlagsToResponseSpec,
  type PhoneScreenResponseKind,
  type PhoneScreenResponseSpec
} from '@/lib/phoneScreenQuestions';
import { INTERVIEW_QUESTION_TYPES } from '@/lib/interviewQuestionTypes';
import { AOE_PREFERENCES_CHANGED_EVENT } from '@/lib/aoePreferences';
import {
  INTERVIEW_BANK_ADD_EVENT,
  INTERVIEW_BANK_DRAG_MIME,
  INTERVIEW_BANK_USED_EVENT,
  INTERVIEW_BUILDER_CONTEXT_EVENT,
  INTERVIEW_WORKSPACE_CLEAR_EVENT,
  INTERVIEW_WORKSPACE_FOCUS_EVENT,
  type InterviewBankAddDetail
} from '@/lib/interviewQuestionBankEvents';
import styles from './InterviewPlan.module.css';

type Question = {
  id: string;
  sourceId?: string;
  text: string;
  areas: string[];
  commentBox?: boolean;
  yesNo?: boolean;
  // Phone-screen only. The richer, semantic response kind (single
  // choice, numeric, yes/no/needs-discussion, etc) - a client-side view
  // model, never itself sent to the server. Only its derived commentBox/
  // yesNo wire flags are persisted (see responseSpecToWireFlags); this
  // field is reconstructed on load, not read back from the API.
  responseSpec?: PhoneScreenResponseSpec;
  // questionType: the controlled organizational category used to group
  // the Question Bank (never Areas of Evaluation, which stay separate,
  // Structured-Interview-only scoring metadata). cardTitle: the compact
  // header shown on the card, independent of questionType - renaming
  // one never changes the other. Both are client-side view-model
  // fields, like responseSpec: not part of the wire payload, and
  // reconstructed on load via sourceId lookup (see
  // reconstructTypeMetadata) rather than round-tripped through
  // persistence, since adding storage for them is out of scope this
  // pass.
  questionType: string;
  cardTitle: string;
};

type PersistedRound = {
  stage: string;
  title: string;
  questions?: Array<{
    id: string;
    sourceId?: string;
    text: string;
    areas: string[];
    commentBox?: boolean;
    yesNo?: boolean;
  }>;
};

// A stage "card" descriptor unifies the four fixed stages with any
// preserved legacy/additional round for rendering purposes (the list
// view and the selected-stage header both need this for either kind).
// tagline is only ever rendered for a legacy round ("Needs stage
// assignment"); a canonical stage instead renders its own
// description - the QUALIFY/VALIDATE/DEMONSTRATE/DIFFERENTIATE
// concept badge itself is presentation-only and no longer shown (the
// underlying tagline classification in INTERVIEW_STAGES is preserved
// and still available for future generator/workflow logic).
type StageCardInfo = { key: string; label: string; tagline: string; description?: string; legacy?: boolean };

function localId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function stageConfig(stageId: InterviewStageId) {
  return INTERVIEW_STAGES.find((item) => item.id === stageId)!;
}

function isCanonicalStage(key: string): key is InterviewStageId {
  return INTERVIEW_STAGES.some((item) => item.id === key);
}

function defaultTitleFor(stageId: InterviewStageId) {
  const stage = stageConfig(stageId);
  return `${stage.label} — ${stage.tagline}`;
}

function defaultTitles(): Record<InterviewStageId, string> {
  const result = {} as Record<InterviewStageId, string>;
  for (const stage of INTERVIEW_STAGES) result[stage.id] = defaultTitleFor(stage.id);
  return result;
}

function stageCardInfoFor(stage: typeof INTERVIEW_STAGES[number]): StageCardInfo {
  return { key: stage.id, label: stage.label, tagline: stage.tagline, description: stage.description };
}

// A round whose persisted stage key isn't one of the four canonical
// ids - kept visible, never mapped onto a canonical stage by guessing
// from its title. "Needs stage assignment" names what it is without
// implying it was silently reclassified.
function legacyCardInfoFor(key: string, title: string): StageCardInfo {
  return { key, label: title || key, tagline: 'Needs stage assignment', legacy: true };
}

// A Structured Interview bank question always carries commentBox: true
// (the existing narrative-comment format). A Phone Screen bank question
// instead carries the response kind its canonical seed specifies -
// buildQuestionBank() already adapts that seed's response onto every
// phone-screen BankQuestion, so this reads it directly rather than
// re-deriving it from a second, separately-imported question list.
function cloneBankQuestion(question: BankQuestion): Question {
  if (question.response) {
    const flags = responseSpecToWireFlags(question.response);
    return {
      id: localId(),
      sourceId: question.id,
      text: question.text,
      areas: [],
      commentBox: flags.commentBox,
      yesNo: flags.yesNo,
      responseSpec: question.response,
      questionType: question.questionType,
      cardTitle: question.cardTitle
    };
  }
  return {
    id: localId(),
    sourceId: question.id,
    text: question.text,
    areas: [...question.areas],
    commentBox: true,
    questionType: question.questionType,
    cardTitle: question.cardTitle
  };
}

function phoneScreenDefaultQuestions(): Question[] {
  return PHONE_SCREEN_DEFAULT_QUESTIONS.map((seed) => {
    const flags = responseSpecToWireFlags(seed.response);
    return {
      id: localId(),
      sourceId: seed.id,
      text: seed.text,
      areas: [],
      commentBox: flags.commentBox,
      yesNo: flags.yesNo,
      responseSpec: seed.response,
      questionType: seed.questionType,
      cardTitle: seed.cardTitle
    };
  });
}

function starterQuestionsFor(stageId: InterviewStageId, bank: BankQuestion[]): Question[] {
  if (stageId === 'phone-screen') return phoneScreenDefaultQuestions();
  // Filtered by stage rather than positionally sliced across the whole
  // flattened bank - phone-screen's canonical bank now contributes 20
  // entries (not the 6 it once did), so a positional slice here would
  // silently pull phone-screen content into round-1's starters.
  if (stageId === 'round-1') return bank.filter((question) => question.stage === 'round-1').slice(0, 5).map(cloneBankQuestion);
  return [];
}

function defaultQuestionsByStage(bank: BankQuestion[]): Record<InterviewStageId, Question[]> {
  const result = {} as Record<InterviewStageId, Question[]>;
  for (const stage of INTERVIEW_STAGES) result[stage.id] = starterQuestionsFor(stage.id, bank);
  return result;
}

// Reconstructs a phone-screen question's response kind after a reload.
// A sourceId links it back to the one canonical source, which is the
// only way to recover a kind the two persisted booleans can't
// represent (single-choice, numeric, yes-no-needs-discussion) - a
// disclosed limitation, not a bug: a custom question with no sourceId,
// or a kind change to a bank/default question that isn't itself
// wire-representable, only round-trips as far as yes-no/short-answer.
function reconstructResponseSpec(question: { sourceId?: string; commentBox?: boolean; yesNo?: boolean }): PhoneScreenResponseSpec {
  const seed = question.sourceId ? findPhoneScreenSeed(question.sourceId) : undefined;
  if (seed) return seed.response;
  return wireFlagsToResponseSpec({ commentBox: Boolean(question.commentBox), yesNo: Boolean(question.yesNo) });
}

// Reconstructs a question's questionType/cardTitle after a reload, the
// same way reconstructResponseSpec recovers a phone-screen question's
// response kind: a sourceId links back to the bank (which already
// covers phone-screen and every structured stage - buildQuestionBank's
// single return array), recovering the seed's original type/title.
// A question with no sourceId, or one whose sourceId no longer
// resolves, is treated as Custom - the same disclosed limitation as
// responseSpec: a recruiter's own rename/reassignment is not yet
// round-trip safe, since storing it is out of scope this pass.
function reconstructTypeMetadata(sourceId: string | undefined, bank: BankQuestion[]): { questionType: string; cardTitle: string } {
  const seed = sourceId ? bank.find((question) => question.id === sourceId) : undefined;
  if (seed) return { questionType: seed.questionType, cardTitle: seed.cardTitle };
  return { questionType: 'Custom', cardTitle: 'Custom Question' };
}

function parsePersistedQuestions(round: PersistedRound, isPhoneScreenStage: boolean, bank: BankQuestion[]): Question[] {
  if (!Array.isArray(round.questions)) return [];
  return round.questions.map((question) => {
    const base: Question = {
      id: question.id || localId(),
      ...(question.sourceId ? { sourceId: question.sourceId } : {}),
      text: String(question.text ?? ''),
      areas: Array.isArray(question.areas) ? [...question.areas] : [],
      commentBox: Boolean(question.commentBox),
      yesNo: Boolean(question.yesNo),
      ...reconstructTypeMetadata(question.sourceId, bank)
    };
    return isPhoneScreenStage ? { ...base, responseSpec: reconstructResponseSpec(base) } : base;
  });
}

function serializeQuestions(questions: Question[]) {
  return questions.map((question) => ({
    ...(question.sourceId ? { sourceId: question.sourceId } : {}),
    text: question.text,
    areas: question.areas,
    commentBox: Boolean(question.commentBox),
    yesNo: Boolean(question.yesNo)
  }));
}

function serializePlan(titlesByKey: Record<string, string>, questionsByKey: Record<string, Question[]>, additionalKeys: string[]) {
  return JSON.stringify({
    rounds: [
      ...INTERVIEW_STAGES.map((stage) => ({
        stage: stage.id,
        title: titlesByKey[stage.id],
        questions: serializeQuestions(questionsByKey[stage.id] || [])
      })),
      // Legacy/additional rounds are re-emitted verbatim, in their
      // original order, every time - phase1_replace_interview_plan
      // deletes and reinserts every round for the plan on each save, so
      // any round left out of this payload would be permanently lost.
      ...additionalKeys.map((key) => ({
        stage: key,
        title: titlesByKey[key],
        questions: serializeQuestions(questionsByKey[key] || [])
      }))
    ]
  });
}

function parseBankQuestion(event: DragEvent<HTMLElement>): BankQuestion | null {
  const raw = event.dataTransfer.getData(INTERVIEW_BANK_DRAG_MIME);
  if (!raw) return null;
  try {
    const question = JSON.parse(raw) as BankQuestion;
    return question?.id && typeof question?.text === 'string' && Array.isArray(question.areas) ? question : null;
  } catch {
    return null;
  }
}

function ratingKey(questionId: string, area: string) {
  return `${questionId}::${area}`;
}

const RESPONSE_KIND_OPTIONS: { value: PhoneScreenResponseKind; label: string }[] = [
  { value: 'yes-no', label: 'Yes / No' },
  { value: 'yes-no-needs-discussion', label: 'Yes / No / Needs discussion' },
  { value: 'single-choice', label: 'Single choice' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'short-answer', label: 'Short answer' }
];

// Question Type option lists for the card's reassignment selector.
// Phone Screen offers its own controlled category list (already ends
// with Custom); Structured Interview offers the app's existing
// generated Question Type vocabulary, plus Custom and General (the
// fallback bucket for a reloaded generated question whose original
// type wasn't persisted).
const PHONE_SCREEN_QUESTION_TYPE_OPTIONS: readonly string[] = PHONE_SCREEN_QUESTION_TYPES;
const STRUCTURED_QUESTION_TYPE_OPTIONS: readonly string[] = [...INTERVIEW_QUESTION_TYPES, 'Custom', 'General'];

export function InterviewPlan({
  requisitionId,
  positionTitle,
  candidateNames
}: {
  requisitionId: string;
  positionTitle: string;
  candidateNames: string[];
}) {
  const bank = useMemo(() => buildQuestionBank(positionTitle), [positionTitle]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [titlesByKey, setTitlesByKey] = useState<Record<string, string>>(() => defaultTitles());
  const [questionsByKey, setQuestionsByKey] = useState<Record<string, Question[]>>(() => defaultQuestionsByStage(bank));
  const [additionalKeys, setAdditionalKeys] = useState<string[]>([]);
  const [availableAreas, setAvailableAreas] = useState<string[]>([...AREAS_OF_EVALUATION]);
  const [openAreaId, setOpenAreaId] = useState<string | null>(null);
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropStageId, setDropStageId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [hydrated, setHydrated] = useState(false);
  const latestPayloadRef = useRef('');
  const savedPayloadRef = useRef('');
  const savingRef = useRef(false);

  const questions = selectedKey ? questionsByKey[selectedKey] || [] : [];
  const serializedPlan = useMemo(() => serializePlan(titlesByKey, questionsByKey, additionalKeys), [titlesByKey, questionsByKey, additionalKeys]);
  const usedSourceIds = useMemo(
    () => new Set(
      Object.values(questionsByKey)
        .flatMap((stageQuestions) => stageQuestions)
        .map((question) => question.sourceId)
        .filter(Boolean) as string[]
    ),
    [questionsByKey]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadAreas() {
      try {
        const response = await fetch('/api/aoe-preferences', { cache: 'no-store' });
        if (!response.ok) return;
        const result = await response.json();
        if (!cancelled && Array.isArray(result.activeAreas)) setAvailableAreas(result.activeAreas);
      } catch {
        // Canonical AOE remain available if preferences cannot be loaded.
      }
    }
    function syncAreas(event: Event) {
      const detail = (event as CustomEvent<{ activeAreas?: string[] }>).detail;
      if (Array.isArray(detail?.activeAreas)) setAvailableAreas(detail.activeAreas);
    }
    void loadAreas();
    window.addEventListener(AOE_PREFERENCES_CHANGED_EVENT, syncAreas);
    return () => {
      cancelled = true;
      window.removeEventListener(AOE_PREFERENCES_CHANGED_EVENT, syncAreas);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const defaultsTitles = defaultTitles();
    const defaultsQuestions = defaultQuestionsByStage(bank);
    setHydrated(false);

    async function loadPlan() {
      try {
        const response = await fetch(`/api/requisitions/${requisitionId}/interview-plan`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to load the Interview Plan.');
        const result = await response.json();
        if (cancelled) return;

        if (result?.plan) {
          const persistedRounds = (result.plan.rounds ?? []) as PersistedRound[];
          const loadedTitles: Record<string, string> = { ...defaultsTitles };
          const loadedQuestions: Record<string, Question[]> = { ...defaultsQuestions };
          const loadedAdditionalKeys: string[] = [];

          for (const stage of INTERVIEW_STAGES) {
            const persisted = persistedRounds.find((round) => round.stage === stage.id);
            if (!persisted) continue;
            loadedTitles[stage.id] = String(persisted.title || defaultTitleFor(stage.id));
            loadedQuestions[stage.id] = parsePersistedQuestions(persisted, stage.id === 'phone-screen', bank);
          }

          // Any round whose stage key isn't one of the four canonical
          // ids predates this feature (the old freeform "+ Add
          // Interview" builder) or otherwise can't be safely mapped onto
          // a canonical stage. It is kept exactly as persisted, in its
          // original order - never guessed at from its title, never
          // dropped - so its configuration, invitations, and records
          // stay reachable and the next autosave doesn't delete it.
          for (const round of persistedRounds) {
            if (isCanonicalStage(round.stage)) continue;
            loadedTitles[round.stage] = String(round.title || round.stage);
            loadedQuestions[round.stage] = parsePersistedQuestions(round, false, bank);
            loadedAdditionalKeys.push(round.stage);
          }

          setTitlesByKey(loadedTitles);
          setQuestionsByKey(loadedQuestions);
          setAdditionalKeys(loadedAdditionalKeys);
          const baseline = serializePlan(loadedTitles, loadedQuestions, loadedAdditionalKeys);
          latestPayloadRef.current = baseline;
          savedPayloadRef.current = baseline;
        } else {
          setTitlesByKey(defaultsTitles);
          setQuestionsByKey(defaultsQuestions);
          setAdditionalKeys([]);
          const baseline = serializePlan(defaultsTitles, defaultsQuestions, []);
          latestPayloadRef.current = baseline;
          savedPayloadRef.current = baseline;
        }
        setHydrated(true);
      } catch (error) {
        console.error(error);
        if (cancelled) return;
        setTitlesByKey(defaultsTitles);
        setQuestionsByKey(defaultsQuestions);
        setAdditionalKeys([]);
        const baseline = serializePlan(defaultsTitles, defaultsQuestions, []);
        latestPayloadRef.current = baseline;
        savedPayloadRef.current = baseline;
        setHydrated(true);
      }
    }

    void loadPlan();
    return () => { cancelled = true; };
  }, [bank, positionTitle, requisitionId]);

  useEffect(() => {
    if (!hydrated) return;
    latestPayloadRef.current = serializedPlan;
    if (serializedPlan === savedPayloadRef.current) return;

    const timer = window.setTimeout(() => {
      async function flushPendingPlan() {
        if (savingRef.current) return;
        savingRef.current = true;
        try {
          while (latestPayloadRef.current !== savedPayloadRef.current) {
            const payload = latestPayloadRef.current;
            const response = await fetch(`/api/requisitions/${requisitionId}/interview-plan`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: payload
            });
            if (!response.ok) {
              const result = await response.json().catch(() => null);
              throw new Error(result?.error || 'Unable to save the Interview Plan.');
            }
            savedPayloadRef.current = payload;
          }
        } catch (error) {
          console.error(error);
        } finally {
          savingRef.current = false;
        }
      }
      void flushPendingPlan();
    }, 500);

    return () => window.clearTimeout(timer);
  }, [hydrated, requisitionId, serializedPlan]);

  useEffect(() => {
    if (!openAreaId) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenAreaId(null);
    }
    function closeOnOutsideClick(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(`[data-area-picker="${openAreaId}"]`)) setOpenAreaId(null);
    }
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    };
  }, [openAreaId]);

  useEffect(() => {
    if (!selectedKey) {
      window.dispatchEvent(new CustomEvent(INTERVIEW_WORKSPACE_CLEAR_EVENT));
      return;
    }
    const detail = { stage: selectedKey, positionTitle };
    window.dispatchEvent(new CustomEvent(INTERVIEW_WORKSPACE_FOCUS_EVENT, { detail }));
    window.dispatchEvent(new CustomEvent(INTERVIEW_BUILDER_CONTEXT_EVENT, { detail }));
  }, [selectedKey, positionTitle]);

  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent(INTERVIEW_WORKSPACE_CLEAR_EVENT));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.dispatchEvent(new CustomEvent(INTERVIEW_BANK_USED_EVENT, {
      detail: { sourceIds: Array.from(usedSourceIds) }
    }));
  }, [hydrated, usedSourceIds]);

  useEffect(() => {
    function addFromBankPanel(event: Event) {
      const detail = (event as CustomEvent<InterviewBankAddDetail>).detail;
      if (!selectedKey || !detail?.question) return;
      addBankQuestion(detail.question);
    }
    window.addEventListener(INTERVIEW_BANK_ADD_EVENT, addFromBankPanel);
    return () => window.removeEventListener(INTERVIEW_BANK_ADD_EVENT, addFromBankPanel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  function patchQuestions(stageKey: string, updater: (current: Question[]) => Question[]) {
    setQuestionsByKey((current) => ({ ...current, [stageKey]: updater(current[stageKey] || []) }));
  }

  function renameInterview(title: string) {
    if (!selectedKey) return;
    setTitlesByKey((current) => ({ ...current, [selectedKey]: title }));
  }

  function addBankQuestionToStage(stageKey: string, source: BankQuestion, targetId?: string) {
    if (usedSourceIds.has(source.id)) return;
    patchQuestions(stageKey, (current) => {
      if (current.some((question) => question.sourceId === source.id)) return current;
      const next = cloneBankQuestion(source);
      if (!targetId) return [next, ...current];
      const targetIndex = current.findIndex((question) => question.id === targetId);
      if (targetIndex < 0) return [next, ...current];
      const result = [...current];
      result.splice(targetIndex, 0, next);
      return result;
    });
  }

  function addBankQuestion(source: BankQuestion, targetId?: string) {
    if (!selectedKey) return;
    addBankQuestionToStage(selectedKey, source, targetId);
  }

  function addManualQuestion() {
    if (!selectedKey) return;
    patchQuestions(selectedKey, (current) => [
      { id: localId(), text: 'Add a new interview question…', areas: [], commentBox: true, questionType: 'Custom', cardTitle: 'Custom Question' },
      ...current
    ]);
  }

  function addCustomPhoneScreenQuestion() {
    if (!selectedKey) return;
    const id = localId();
    patchQuestions(selectedKey, (current) => [
      { id, text: '', areas: [], commentBox: true, yesNo: false, responseSpec: { kind: 'short-answer' }, questionType: 'Custom', cardTitle: 'Custom Question' },
      ...current
    ]);
  }

  function updateQuestion(questionId: string, patch: Partial<Question>) {
    if (!selectedKey) return;
    patchQuestions(selectedKey, (current) => current.map((question) =>
      question.id === questionId ? { ...question, ...patch } : question
    ));
  }

  function removeQuestion(questionId: string) {
    if (!selectedKey) return;
    patchQuestions(selectedKey, (current) => current.filter((question) => question.id !== questionId));
    if (openAreaId === questionId) setOpenAreaId(null);
  }

  function toggleArea(questionId: string, area: string) {
    if (!selectedKey) return;
    patchQuestions(selectedKey, (current) => current.map((question) => {
      if (question.id !== questionId) return question;
      if (question.areas.includes(area)) return { ...question, areas: question.areas.filter((item) => item !== area) };
      if (question.areas.length >= 4) return question;
      return { ...question, areas: [...question.areas, area] };
    }));
  }

  function toggleCommentBox(questionId: string) {
    if (!selectedKey) return;
    patchQuestions(selectedKey, (current) => current.map((question) =>
      question.id === questionId ? { ...question, commentBox: !question.commentBox } : question
    ));
  }

  function toggleYesNo(questionId: string) {
    if (!selectedKey) return;
    patchQuestions(selectedKey, (current) => current.map((question) =>
      question.id === questionId ? { ...question, yesNo: !question.yesNo } : question
    ));
  }

  // The single entry point for changing a Phone Screen question's
  // response kind. It always sets both the rich view-model responseSpec
  // and its honest wire-flag derivation together, so the two can never
  // drift apart.
  function setResponseSpec(questionId: string, spec: PhoneScreenResponseSpec) {
    if (!selectedKey) return;
    const flags = responseSpecToWireFlags(spec);
    patchQuestions(selectedKey, (current) => current.map((question) =>
      question.id === questionId ? { ...question, responseSpec: spec, commentBox: flags.commentBox, yesNo: flags.yesNo } : question
    ));
  }

  // Renaming a question's card header never touches its questionType -
  // the two are intentionally decoupled (see the Question type above).
  function setCardTitle(questionId: string, cardTitle: string) {
    if (!selectedKey) return;
    patchQuestions(selectedKey, (current) => current.map((question) =>
      question.id === questionId ? { ...question, cardTitle } : question
    ));
  }

  // Reassigning a question's organizational Question Type never touches
  // its cardTitle - the two are intentionally decoupled.
  function setQuestionType(questionId: string, questionType: string) {
    if (!selectedKey) return;
    patchQuestions(selectedKey, (current) => current.map((question) =>
      question.id === questionId ? { ...question, questionType } : question
    ));
  }

  function reorderQuestion(sourceId: string, targetId: string) {
    if (!selectedKey || sourceId === targetId) return;
    patchQuestions(selectedKey, (current) => {
      const source = current.find((question) => question.id === sourceId);
      const targetIndex = current.findIndex((question) => question.id === targetId);
      if (!source || targetIndex < 0) return current;
      const next = current.filter((question) => question.id !== sourceId);
      next.splice(targetIndex, 0, source);
      return next;
    });
  }

  function dropOnQuestion(event: DragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault();
    event.stopPropagation();
    const bankQuestion = parseBankQuestion(event);
    if (bankQuestion) addBankQuestion(bankQuestion, targetId);
    else if (draggedQuestionId) reorderQuestion(draggedQuestionId, targetId);
    setDraggedQuestionId(null);
    setDropTargetId(null);
  }

  function dropAtEnd(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const bankQuestion = parseBankQuestion(event);
    if (bankQuestion) addBankQuestion(bankQuestion);
    setDraggedQuestionId(null);
    setDropTargetId(null);
  }

  function renderHeading() {
    return (
      <div className={styles.headingRow}>
        <div className={styles.interviewHeading}>
          <span className="eyebrow">Selection process</span>
          <h2>Interviews</h2>
          <p>Four fixed assessment stages. Select a stage to build its questions.</p>
        </div>
      </div>
    );
  }

  function renderStageCard(info: StageCardInfo, selected = false) {
    const stageQuestions = questionsByKey[info.key] || [];
    return (
      <button
        type="button"
        className={`${styles.roundBar} ${selected ? styles.selectedBar : ''}`}
        onClick={() => setSelectedKey(selected ? null : info.key)}
        aria-expanded={selected}
      >
        {info.legacy ? (
          <span className={styles.roundTitle}>
            {info.label}
            <span className={`${styles.stageTagline} ${styles.legacyTagline}`}>{info.tagline}</span>
          </span>
        ) : (
          <span className={styles.roundTitleStack}>
            <span className={styles.roundName}>{info.label}</span>
            {info.description && <span className={styles.roundExplainer}>{info.description}</span>}
          </span>
        )}
        <span className={styles.roundMeta}>
          <span>{candidateNames.length} Candidates</span><span>•</span><span>{stageQuestions.length} Question{stageQuestions.length === 1 ? '' : 's'}</span>
        </span>
      </button>
    );
  }

  if (!selectedKey) {
    return (
      <section className={styles.plan} data-requisition-id={requisitionId}>
        {renderHeading()}
        <div className={styles.roundList}>
          {INTERVIEW_STAGES.map((stage) => (
            <div
              key={stage.id}
              className={`${styles.roundShell} ${dropStageId === stage.id ? styles.roundDropTarget : ''}`}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(INTERVIEW_BANK_DRAG_MIME)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                  setDropStageId(stage.id);
                }
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropStageId(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const bankQuestion = parseBankQuestion(event);
                if (bankQuestion) addBankQuestionToStage(stage.id, bankQuestion);
                setDropStageId(null);
              }}
            >
              {renderStageCard(stageCardInfoFor(stage))}
            </div>
          ))}
        </div>

        {additionalKeys.length > 0 && (
          <div className={styles.additionalRounds} data-additional-interviews="true">
            <p className={styles.additionalRoundsLabel}>Additional interviews — outside the four fixed stages. Their configuration, invitations, and records are preserved; assign a stage when ready.</p>
            <div className={styles.roundList}>
              {additionalKeys.map((key) => (
                <div
                  key={key}
                  className={`${styles.roundShell} ${dropStageId === key ? styles.roundDropTarget : ''}`}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes(INTERVIEW_BANK_DRAG_MIME)) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'copy';
                      setDropStageId(key);
                    }
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropStageId(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const bankQuestion = parseBankQuestion(event);
                    if (bankQuestion) addBankQuestionToStage(key, bankQuestion);
                    setDropStageId(null);
                  }}
                >
                  {renderStageCard(legacyCardInfoFor(key, titlesByKey[key]))}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  const selectedCardInfo = isCanonicalStage(selectedKey)
    ? stageCardInfoFor(stageConfig(selectedKey))
    : legacyCardInfoFor(selectedKey, titlesByKey[selectedKey]);
  const title = titlesByKey[selectedKey] ?? (isCanonicalStage(selectedKey) ? defaultTitleFor(selectedKey) : selectedKey);
  const isPhoneScreen = selectedKey === 'phone-screen';
  const formDesignerHref = `/form-branding-preview?requisitionId=${encodeURIComponent(requisitionId)}&stage=${encodeURIComponent(selectedKey)}`;

  return (
    <section className={styles.plan} data-requisition-id={requisitionId} data-interview-plan="selected">
      {renderHeading()}
      <div className={styles.selectedRound}>
        {renderStageCard(selectedCardInfo, true)}

        <div className={styles.roundContent}>
          <div className={styles.roundSetup}>
            <label htmlFor="interview-name">Interview name</label>
            <input id="interview-name" value={title} maxLength={200} onChange={(event) => renameInterview(event.target.value)} />
            <a className={styles.formDesignerLink} href={formDesignerHref}>Form Designer</a>
            <button type="button" className={styles.backToStages} onClick={() => setSelectedKey(null)}>Back to stages</button>
          </div>

          {isPhoneScreen ? (
            <>
              <div className={styles.phoneScreenToolbar}>
                <p className={styles.phoneScreenHint}>Compact qualification format — short, closed-form questions answered in minutes. No Areas of Evaluation, star ratings, or permanent comment blocks.</p>
                <button type="button" className={styles.addCustomQuestion} onClick={addCustomPhoneScreenQuestion}>+ Custom Question</button>
              </div>

              <div className={styles.editor} onDragOver={(event) => event.preventDefault()} onDrop={dropAtEnd}>
                {questions.map((question, index) => {
                  const spec = question.responseSpec ?? { kind: 'short-answer' as const };
                  return (
                    <div
                      key={question.id}
                      className={`${styles.questionCard} ${dropTargetId === question.id ? styles.dropTarget : ''}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (draggedQuestionId !== question.id || event.dataTransfer.types.includes(INTERVIEW_BANK_DRAG_MIME)) setDropTargetId(question.id);
                      }}
                      onDrop={(event) => dropOnQuestion(event, question.id)}
                    >
                      <span
                        className={styles.dragHandle}
                        draggable
                        title="Drag to reorder"
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', question.id);
                          setDraggedQuestionId(question.id);
                        }}
                        onDragEnd={() => { setDraggedQuestionId(null); setDropTargetId(null); }}
                      >⠿</span>

                      <div className={styles.questionMain}>
                        <div className={styles.cardHeaderRow}>
                          {/* A built-in question's cardTitle equals its questionType (e.g. "Location" / "Location") -
                              showing both would repeat the same word twice, so the free-text title only appears once
                              a question is actually Custom (where the title is meaningful, independent content). */}
                          {question.questionType === 'Custom' && (
                            <input
                              className={styles.cardTitleInput}
                              value={question.cardTitle}
                              maxLength={60}
                              placeholder="Custom Question"
                              aria-label={`Card title for question ${index + 1}`}
                              onChange={(event) => setCardTitle(question.id, event.target.value)}
                            />
                          )}
                          <select
                            className={styles.questionTypeSelect}
                            value={question.questionType}
                            aria-label={`Question type for question ${index + 1}`}
                            onChange={(event) => setQuestionType(question.id, event.target.value)}
                          >
                            {PHONE_SCREEN_QUESTION_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
                          </select>
                        </div>
                        <div className={styles.questionTop}>
                          <span className={styles.questionNumber}>Q{index + 1}</span>
                          <textarea
                            rows={2}
                            value={question.text}
                            placeholder="Type your screening question…"
                            aria-label={`Question ${index + 1}`}
                            onChange={(event) => updateQuestion(question.id, { text: event.target.value })}
                          />
                          <button type="button" className={styles.removeQuestion} onClick={() => removeQuestion(question.id)} aria-label={`Remove question ${index + 1}`}>×</button>
                        </div>

                        <div className={styles.responseKindRow}>
                          <label className={styles.responseKindLabel} htmlFor={`response-kind-${question.id}`}>Response type</label>
                          <select
                            id={`response-kind-${question.id}`}
                            className={styles.responseKindSelect}
                            value={spec.kind}
                            onChange={(event) => setResponseSpec(question.id, responseSpecForKind(event.target.value as PhoneScreenResponseKind, question.responseSpec))}
                          >
                            {RESPONSE_KIND_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>
                        {spec.kind === 'single-choice' && (
                          <input
                            type="text"
                            className={styles.responseKindDetail}
                            placeholder="Options, comma separated"
                            value={spec.options.join(', ')}
                            aria-label={`Response options for question ${index + 1}`}
                            onChange={(event) => setResponseSpec(question.id, { kind: 'single-choice', options: event.target.value.split(',').map((option) => option.trim()).filter(Boolean) })}
                          />
                        )}
                        {spec.kind === 'numeric' && (
                          <input
                            type="text"
                            className={styles.responseKindDetail}
                            placeholder="Unit (optional, e.g. years)"
                            value={spec.unit ?? ''}
                            aria-label={`Response unit for question ${index + 1}`}
                            onChange={(event) => setResponseSpec(question.id, { kind: 'numeric', unit: event.target.value || undefined })}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className={styles.dropEnd}>Drop a Question Bank item here</div>
              </div>
            </>
          ) : (
            <>
              <button type="button" className={styles.addManual} onClick={addManualQuestion}>+ Add Question</button>

              <div className={styles.editor} onDragOver={(event) => event.preventDefault()} onDrop={dropAtEnd}>
                {questions.map((question, index) => {
                  const maxed = question.areas.length >= 4;
                  return (
                    <div
                      key={question.id}
                      className={`${styles.questionCard} ${dropTargetId === question.id ? styles.dropTarget : ''}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (draggedQuestionId !== question.id || event.dataTransfer.types.includes(INTERVIEW_BANK_DRAG_MIME)) setDropTargetId(question.id);
                      }}
                      onDrop={(event) => dropOnQuestion(event, question.id)}
                    >
                      <span
                        className={styles.dragHandle}
                        draggable
                        title="Drag to reorder"
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', question.id);
                          setDraggedQuestionId(question.id);
                        }}
                        onDragEnd={() => { setDraggedQuestionId(null); setDropTargetId(null); }}
                      >⠿</span>

                      <div className={styles.questionMain}>
                        <div className={styles.cardHeaderRow}>
                          <input
                            className={styles.cardTitleInput}
                            value={question.cardTitle}
                            maxLength={60}
                            placeholder="Custom Question"
                            aria-label={`Card title for question ${index + 1}`}
                            onChange={(event) => setCardTitle(question.id, event.target.value)}
                          />
                          <select
                            className={styles.questionTypeSelect}
                            value={question.questionType}
                            aria-label={`Question type for question ${index + 1}`}
                            onChange={(event) => setQuestionType(question.id, event.target.value)}
                          >
                            {STRUCTURED_QUESTION_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
                          </select>
                        </div>
                        <div className={styles.questionTop}>
                          <span className={styles.questionNumber}>Q{index + 1}</span>
                          <textarea rows={2} value={question.text} aria-label={`Question ${index + 1}`} onChange={(event) => updateQuestion(question.id, { text: event.target.value })} />
                          <button type="button" className={styles.removeQuestion} onClick={() => removeQuestion(question.id)} aria-label={`Remove question ${index + 1}`}>×</button>
                        </div>

                        <div className={styles.areaLine} data-area-picker={question.id}>
                          <button type="button" className={styles.areaButton} onClick={() => setOpenAreaId(openAreaId === question.id ? null : question.id)} aria-expanded={openAreaId === question.id}>
                            Areas of Evaluation ({question.areas.length}) ▾
                          </button>
                          {question.areas.map((area) => (
                            <span className={styles.areaChip} key={area}>{area}<button type="button" onClick={() => toggleArea(question.id, area)} aria-label={`Remove ${area}`}>×</button></span>
                          ))}
                          {question.commentBox && (
                            <span className={`${styles.areaChip} ${styles.commentChip}`}>Comment Box<button type="button" onClick={() => toggleCommentBox(question.id)} aria-label="Remove Comment Box">×</button></span>
                          )}
                          {question.yesNo && (
                            <span className={styles.areaChip}>Yes / No<button type="button" onClick={() => toggleYesNo(question.id)} aria-label="Remove Yes or No response">×</button></span>
                          )}
                          {openAreaId === question.id && (
                            <div className={styles.areaMenu}>
                              <label className={`${styles.areaOption} ${styles.commentOption}`}>
                                <input type="checkbox" checked={Boolean(question.commentBox)} onChange={() => toggleCommentBox(question.id)} />
                                <span>Comment Box</span>
                              </label>
                              <label className={`${styles.areaOption} ${styles.commentOption}`}>
                                <input type="checkbox" checked={Boolean(question.yesNo)} onChange={() => toggleYesNo(question.id)} />
                                <span>Yes / No</span>
                              </label>
                              {availableAreas.map((area) => {
                                const checked = question.areas.includes(area);
                                return (
                                  <label className={styles.areaOption} key={area}>
                                    <input type="checkbox" checked={checked} disabled={maxed && !checked} onChange={() => toggleArea(question.id, area)} />
                                    <span>{area}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {question.areas.length > 0 && (
                          <div className={styles.scoringTable} role="table" aria-label={`Question ${index + 1} scoring`}>
                            <div className={`${styles.scoringRow} ${styles.scoringHeader}`} role="row">
                              <span role="columnheader">Area of Evaluation</span><span role="columnheader">Rating</span>
                            </div>
                            {question.areas.map((area) => {
                              const key = ratingKey(question.id, area);
                              const value = ratings[key] || 0;
                              return (
                                <div className={styles.scoringRow} role="row" key={area}>
                                  <span className={styles.scoringArea} role="cell">{area}</span>
                                  <span className={styles.starGroup} role="cell" aria-label={`${area} rating`}>
                                    {[1, 2, 3, 4, 5].map((star) => (
                                      <button type="button" key={star} className={`${styles.star} ${value >= star ? styles.starSelected : ''}`} onClick={() => setRatings((current) => ({ ...current, [key]: star }))} aria-label={`Rate ${area} ${star} out of 5`} aria-pressed={value === star}>
                                        {value >= star ? '★' : '☆'}
                                      </button>
                                    ))}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {question.yesNo && (
                          <div className={styles.commentBoxPreview}>
                            <strong>Response</strong>
                            <label><input type="radio" name={`builder-yes-no-${question.id}`} /> Yes</label>
                            <label><input type="radio" name={`builder-yes-no-${question.id}`} /> No</label>
                          </div>
                        )}
                        {question.commentBox && (
                          <div className={styles.commentBoxPreview}>
                            <label htmlFor={`question-comment-${question.id}`}>Comments</label>
                            <textarea id={`question-comment-${question.id}`} placeholder="Add comments…" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className={styles.dropEnd}>Drop a Question Bank item here</div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
