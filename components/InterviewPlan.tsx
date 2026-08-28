'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AREAS_OF_EVALUATION,
  buildQuestionBank,
  INTERVIEW_STAGES,
  type BankQuestion,
  type InterviewStageId
} from '@/lib/interviewQuestionBank';
import { PHONE_SCREEN_BANK_QUESTIONS, PHONE_SCREEN_DEFAULT_QUESTIONS, type PhoneScreenResponseType } from '@/lib/phoneScreenQuestions';
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

function localId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function stageConfig(stageId: InterviewStageId) {
  return INTERVIEW_STAGES.find((item) => item.id === stageId)!;
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

// A Structured Interview bank question always carries commentBox: true
// (the existing narrative-comment format). A Phone Screen bank question
// instead carries the compact response type its seed specifies, so a
// dragged-in bank question lands with the right control immediately
// rather than needing to be reconfigured every time.
function cloneBankQuestion(question: BankQuestion): Question {
  const phoneScreenSeed = PHONE_SCREEN_BANK_QUESTIONS.find((seed) => seed.id === question.id);
  if (phoneScreenSeed) {
    return {
      id: localId(),
      sourceId: question.id,
      text: question.text,
      areas: [],
      commentBox: phoneScreenSeed.responseType === 'short-answer',
      yesNo: phoneScreenSeed.responseType === 'yes-no'
    };
  }
  return { id: localId(), sourceId: question.id, text: question.text, areas: [...question.areas], commentBox: true };
}

function phoneScreenDefaultQuestions(): Question[] {
  return PHONE_SCREEN_DEFAULT_QUESTIONS.map((seed) => ({
    id: localId(),
    text: seed.text,
    areas: [],
    commentBox: seed.responseType === 'short-answer',
    yesNo: seed.responseType === 'yes-no'
  }));
}

function starterQuestionsFor(stageId: InterviewStageId, bank: BankQuestion[]): Question[] {
  if (stageId === 'phone-screen') return phoneScreenDefaultQuestions();
  if (stageId === 'round-1') return bank.slice(0, 11).map(cloneBankQuestion);
  return [];
}

function defaultQuestionsByStage(bank: BankQuestion[]): Record<InterviewStageId, Question[]> {
  const result = {} as Record<InterviewStageId, Question[]>;
  for (const stage of INTERVIEW_STAGES) result[stage.id] = starterQuestionsFor(stage.id, bank);
  return result;
}

function serializePlan(titlesByStage: Record<InterviewStageId, string>, questionsByStage: Record<InterviewStageId, Question[]>) {
  return JSON.stringify({
    rounds: INTERVIEW_STAGES.map((stage) => ({
      stage: stage.id,
      title: titlesByStage[stage.id],
      questions: (questionsByStage[stage.id] || []).map((question) => ({
        ...(question.sourceId ? { sourceId: question.sourceId } : {}),
        text: question.text,
        areas: question.areas,
        commentBox: Boolean(question.commentBox),
        yesNo: Boolean(question.yesNo)
      }))
    }))
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

function responseTypeOf(question: Question): PhoneScreenResponseType {
  return question.yesNo ? 'yes-no' : 'short-answer';
}

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
  const [selectedStage, setSelectedStage] = useState<InterviewStageId | null>(null);
  const [titlesByStage, setTitlesByStage] = useState<Record<InterviewStageId, string>>(() => defaultTitles());
  const [questionsByStage, setQuestionsByStage] = useState<Record<InterviewStageId, Question[]>>(() => defaultQuestionsByStage(bank));
  const [availableAreas, setAvailableAreas] = useState<string[]>([...AREAS_OF_EVALUATION]);
  const [openAreaId, setOpenAreaId] = useState<string | null>(null);
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropStageId, setDropStageId] = useState<InterviewStageId | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [hydrated, setHydrated] = useState(false);
  const latestPayloadRef = useRef('');
  const savedPayloadRef = useRef('');
  const savingRef = useRef(false);

  const questions = selectedStage ? questionsByStage[selectedStage] || [] : [];
  const serializedPlan = useMemo(() => serializePlan(titlesByStage, questionsByStage), [titlesByStage, questionsByStage]);
  const usedSourceIds = useMemo(
    () => new Set(
      Object.values(questionsByStage)
        .flatMap((stageQuestions) => stageQuestions)
        .map((question) => question.sourceId)
        .filter(Boolean) as string[]
    ),
    [questionsByStage]
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
          const loadedTitles: Record<InterviewStageId, string> = { ...defaultsTitles };
          const loadedQuestions: Record<InterviewStageId, Question[]> = { ...defaultsQuestions };
          for (const stage of INTERVIEW_STAGES) {
            const persisted = persistedRounds.find((round) => round.stage === stage.id);
            if (!persisted) continue;
            loadedTitles[stage.id] = String(persisted.title || defaultTitleFor(stage.id));
            loadedQuestions[stage.id] = Array.isArray(persisted.questions)
              ? persisted.questions.map((question) => ({
                  id: question.id || localId(),
                  ...(question.sourceId ? { sourceId: question.sourceId } : {}),
                  text: String(question.text ?? ''),
                  areas: Array.isArray(question.areas) ? [...question.areas] : [],
                  commentBox: Boolean(question.commentBox),
                  yesNo: Boolean(question.yesNo)
                }))
              : [];
          }
          setTitlesByStage(loadedTitles);
          setQuestionsByStage(loadedQuestions);
          const baseline = serializePlan(loadedTitles, loadedQuestions);
          latestPayloadRef.current = baseline;
          savedPayloadRef.current = baseline;
        } else {
          setTitlesByStage(defaultsTitles);
          setQuestionsByStage(defaultsQuestions);
          const baseline = serializePlan(defaultsTitles, defaultsQuestions);
          latestPayloadRef.current = baseline;
          savedPayloadRef.current = baseline;
        }
        setHydrated(true);
      } catch (error) {
        console.error(error);
        if (cancelled) return;
        setTitlesByStage(defaultsTitles);
        setQuestionsByStage(defaultsQuestions);
        const baseline = serializePlan(defaultsTitles, defaultsQuestions);
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
    if (!selectedStage) {
      window.dispatchEvent(new CustomEvent(INTERVIEW_WORKSPACE_CLEAR_EVENT));
      return;
    }
    const detail = { stage: selectedStage, positionTitle };
    window.dispatchEvent(new CustomEvent(INTERVIEW_WORKSPACE_FOCUS_EVENT, { detail }));
    window.dispatchEvent(new CustomEvent(INTERVIEW_BUILDER_CONTEXT_EVENT, { detail }));
  }, [selectedStage, positionTitle]);

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
      if (!selectedStage || !detail?.question) return;
      addBankQuestion(detail.question);
    }
    window.addEventListener(INTERVIEW_BANK_ADD_EVENT, addFromBankPanel);
    return () => window.removeEventListener(INTERVIEW_BANK_ADD_EVENT, addFromBankPanel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStage]);

  function patchQuestions(stageId: InterviewStageId, updater: (current: Question[]) => Question[]) {
    setQuestionsByStage((current) => ({ ...current, [stageId]: updater(current[stageId] || []) }));
  }

  function renameInterview(title: string) {
    if (!selectedStage) return;
    setTitlesByStage((current) => ({ ...current, [selectedStage]: title }));
  }

  function addBankQuestionToStage(stageId: InterviewStageId, source: BankQuestion, targetId?: string) {
    if (usedSourceIds.has(source.id)) return;
    patchQuestions(stageId, (current) => {
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
    if (!selectedStage) return;
    addBankQuestionToStage(selectedStage, source, targetId);
  }

  function addManualQuestion() {
    if (!selectedStage) return;
    patchQuestions(selectedStage, (current) => [
      { id: localId(), text: 'Add a new interview question…', areas: [], commentBox: true },
      ...current
    ]);
  }

  function addCustomPhoneScreenQuestion() {
    if (!selectedStage) return;
    const id = localId();
    patchQuestions(selectedStage, (current) => [
      { id, text: '', areas: [], commentBox: true, yesNo: false },
      ...current
    ]);
  }

  function updateQuestion(questionId: string, patch: Partial<Question>) {
    if (!selectedStage) return;
    patchQuestions(selectedStage, (current) => current.map((question) =>
      question.id === questionId ? { ...question, ...patch } : question
    ));
  }

  function removeQuestion(questionId: string) {
    if (!selectedStage) return;
    patchQuestions(selectedStage, (current) => current.filter((question) => question.id !== questionId));
    if (openAreaId === questionId) setOpenAreaId(null);
  }

  function toggleArea(questionId: string, area: string) {
    if (!selectedStage) return;
    patchQuestions(selectedStage, (current) => current.map((question) => {
      if (question.id !== questionId) return question;
      if (question.areas.includes(area)) return { ...question, areas: question.areas.filter((item) => item !== area) };
      if (question.areas.length >= 4) return question;
      return { ...question, areas: [...question.areas, area] };
    }));
  }

  function toggleCommentBox(questionId: string) {
    if (!selectedStage) return;
    patchQuestions(selectedStage, (current) => current.map((question) =>
      question.id === questionId ? { ...question, commentBox: !question.commentBox } : question
    ));
  }

  function toggleYesNo(questionId: string) {
    if (!selectedStage) return;
    patchQuestions(selectedStage, (current) => current.map((question) =>
      question.id === questionId ? { ...question, yesNo: !question.yesNo } : question
    ));
  }

  function setResponseType(questionId: string, type: PhoneScreenResponseType) {
    if (!selectedStage) return;
    patchQuestions(selectedStage, (current) => current.map((question) =>
      question.id === questionId ? { ...question, yesNo: type === 'yes-no', commentBox: type === 'short-answer' } : question
    ));
  }

  function reorderQuestion(sourceId: string, targetId: string) {
    if (!selectedStage || sourceId === targetId) return;
    patchQuestions(selectedStage, (current) => {
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

  function renderStageCard(stage: typeof INTERVIEW_STAGES[number], selected = false) {
    const stageQuestions = questionsByStage[stage.id] || [];
    return (
      <button
        type="button"
        className={`${styles.roundBar} ${selected ? styles.selectedBar : ''}`}
        onClick={() => setSelectedStage(selected ? null : stage.id)}
        aria-expanded={selected}
      >
        <span className={styles.roundTitle}>
          {stage.label}
          <span className={styles.stageTagline}>{stage.tagline}</span>
        </span>
        <span className={styles.roundMeta}>
          <span>{candidateNames.length} Candidates</span><span>•</span><span>{stageQuestions.length} Question{stageQuestions.length === 1 ? '' : 's'}</span>
        </span>
      </button>
    );
  }

  if (!selectedStage) {
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
              {renderStageCard(stage)}
            </div>
          ))}
        </div>
      </section>
    );
  }

  const stage = stageConfig(selectedStage);
  const title = titlesByStage[selectedStage] ?? defaultTitleFor(selectedStage);
  const isPhoneScreen = selectedStage === 'phone-screen';
  const formDesignerHref = `/form-branding-preview?requisitionId=${encodeURIComponent(requisitionId)}&stage=${encodeURIComponent(selectedStage)}`;

  return (
    <section className={styles.plan} data-requisition-id={requisitionId} data-interview-plan="selected">
      {renderHeading()}
      <div className={styles.selectedRound}>
        {renderStageCard(stage, true)}

        <div className={styles.roundContent}>
          <div className={styles.roundSetup}>
            <label htmlFor="interview-name">Interview name</label>
            <input id="interview-name" value={title} maxLength={200} onChange={(event) => renameInterview(event.target.value)} />
            <a className={styles.formDesignerLink} href={formDesignerHref}>Form Designer</a>
            <button type="button" className={styles.backToStages} onClick={() => setSelectedStage(null)}>Back to stages</button>
          </div>

          {isPhoneScreen ? (
            <>
              <div className={styles.phoneScreenToolbar}>
                <p className={styles.phoneScreenHint}>Compact qualification format — short, closed-form questions answered in minutes. No Areas of Evaluation, star ratings, or permanent comment blocks.</p>
                <button type="button" className={styles.addCustomQuestion} onClick={addCustomPhoneScreenQuestion}>+ Custom Question</button>
              </div>

              <div className={styles.compactGrid} onDragOver={(event) => event.preventDefault()} onDrop={dropAtEnd}>
                {questions.map((question, index) => (
                  <div
                    key={question.id}
                    className={`${styles.compactCard} ${dropTargetId === question.id ? styles.dropTarget : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (draggedQuestionId !== question.id || event.dataTransfer.types.includes(INTERVIEW_BANK_DRAG_MIME)) setDropTargetId(question.id);
                    }}
                    onDrop={(event) => dropOnQuestion(event, question.id)}
                  >
                    <div className={styles.compactCardHead}>
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
                      <span className={styles.questionNumber}>Q{index + 1}</span>
                      <button type="button" className={styles.removeQuestion} onClick={() => removeQuestion(question.id)} aria-label={`Remove question ${index + 1}`}>×</button>
                    </div>
                    <textarea
                      rows={2}
                      className={styles.compactQuestionText}
                      value={question.text}
                      placeholder="Type your screening question…"
                      aria-label={`Question ${index + 1}`}
                      onChange={(event) => updateQuestion(question.id, { text: event.target.value })}
                    />
                    <div className={styles.responseTypeRow} role="radiogroup" aria-label={`Response type for question ${index + 1}`}>
                      <button
                        type="button"
                        className={`${styles.responseTypeBtn} ${responseTypeOf(question) === 'yes-no' ? styles.responseTypeActive : ''}`}
                        role="radio"
                        aria-checked={responseTypeOf(question) === 'yes-no'}
                        onClick={() => setResponseType(question.id, 'yes-no')}
                      >Yes / No</button>
                      <button
                        type="button"
                        className={`${styles.responseTypeBtn} ${responseTypeOf(question) === 'short-answer' ? styles.responseTypeActive : ''}`}
                        role="radio"
                        aria-checked={responseTypeOf(question) === 'short-answer'}
                        onClick={() => setResponseType(question.id, 'short-answer')}
                      >Short Answer</button>
                    </div>
                  </div>
                ))}
                <div className={`${styles.dropEnd} ${styles.compactDropEnd}`}>Drop a Question Bank item here</div>
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
