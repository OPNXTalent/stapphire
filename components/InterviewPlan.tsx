'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AREAS_OF_EVALUATION,
  buildQuestionBank,
  type BankQuestion,
  type InterviewStageId
} from '@/lib/interviewQuestionBank';
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

type InterviewRound = {
  id: string;
  stage: string;
  title: string;
  bankStage: InterviewStageId;
};

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

const LEGACY_BANK_STAGES = new Set<InterviewStageId>(['phone-screen', 'round-1', 'round-2', 'final']);

function localId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function roundKey() {
  return `interview-${localId()}`.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 120);
}

function bankStageFor(stage: string): InterviewStageId {
  return LEGACY_BANK_STAGES.has(stage as InterviewStageId) ? stage as InterviewStageId : 'round-1';
}

function cloneBankQuestion(question: BankQuestion): Question {
  return { id: localId(), sourceId: question.id, text: question.text, areas: [...question.areas], commentBox: true };
}

function starterRounds(): InterviewRound[] {
  return [
    { id: 'round-1', stage: 'round-1', title: 'Interview Form 1', bankStage: 'round-1' }
  ];
}

function starterQuestions(bank: BankQuestion[]) {
  return {
    'round-1': bank.slice(0, 11).map(cloneBankQuestion)
  } satisfies Record<string, Question[]>;
}

function serializePlan(rounds: InterviewRound[], questionsByRound: Record<string, Question[]>) {
  return JSON.stringify({
    rounds: rounds.map((round) => ({
      stage: round.stage,
      title: round.title,
      questions: (questionsByRound[round.id] || []).map((question) => ({
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
  const [rounds, setRounds] = useState<InterviewRound[]>(() => starterRounds());
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [questionsByRound, setQuestionsByRound] = useState<Record<string, Question[]>>(() => starterQuestions(bank));
  const [availableAreas, setAvailableAreas] = useState<string[]>([...AREAS_OF_EVALUATION]);
  const [openAreaId, setOpenAreaId] = useState<string | null>(null);
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
  const [draggedRoundId, setDraggedRoundId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropRoundId, setDropRoundId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [hydrated, setHydrated] = useState(false);
  const latestPayloadRef = useRef('');
  const savedPayloadRef = useRef('');
  const savingRef = useRef(false);

  const selectedRound = rounds.find((round) => round.id === selectedRoundId) || null;
  const questions = selectedRound ? questionsByRound[selectedRound.id] || [] : [];
  const serializedPlan = useMemo(() => serializePlan(rounds, questionsByRound), [rounds, questionsByRound]);
  const usedSourceIds = useMemo(
    () => new Set(
      Object.values(questionsByRound)
        .flatMap((roundQuestions) => roundQuestions)
        .map((question) => question.sourceId)
        .filter(Boolean) as string[]
    ),
    [questionsByRound]
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
    const defaultsRounds = starterRounds();
    const defaultsQuestions = starterQuestions(bank);
    setHydrated(false);

    async function loadPlan() {
      try {
        const response = await fetch(`/api/requisitions/${requisitionId}/interview-plan`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to load the Interview Plan.');
        const result = await response.json();
        if (cancelled) return;

        if (result?.plan) {
          const persistedRounds = (result.plan.rounds ?? []) as PersistedRound[];
          const loadedRounds: InterviewRound[] = persistedRounds.map((round) => ({
            id: round.stage,
            stage: round.stage,
            title: String(round.title || 'Interview'),
            bankStage: bankStageFor(round.stage)
          }));
          const loadedQuestions: Record<string, Question[]> = {};
          for (const round of persistedRounds) {
            loadedQuestions[round.stage] = Array.isArray(round.questions)
              ? round.questions.map((question) => ({
                  id: question.id || localId(),
                  ...(question.sourceId ? { sourceId: question.sourceId } : {}),
                  text: String(question.text ?? ''),
                  areas: Array.isArray(question.areas) ? [...question.areas] : [],
                  commentBox: Boolean(question.commentBox),
                  yesNo: Boolean(question.yesNo)
                }))
              : [];
          }
          setRounds(loadedRounds);
          setQuestionsByRound(loadedQuestions);
          const baseline = serializePlan(loadedRounds, loadedQuestions);
          latestPayloadRef.current = baseline;
          savedPayloadRef.current = baseline;
        } else {
          setRounds(defaultsRounds);
          setQuestionsByRound(defaultsQuestions);
          const baseline = serializePlan(defaultsRounds, defaultsQuestions);
          latestPayloadRef.current = baseline;
          savedPayloadRef.current = baseline;
        }
        setHydrated(true);
      } catch (error) {
        console.error(error);
        if (cancelled) return;
        setRounds(defaultsRounds);
        setQuestionsByRound(defaultsQuestions);
        const baseline = serializePlan(defaultsRounds, defaultsQuestions);
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
    if (!selectedRound) {
      window.dispatchEvent(new CustomEvent(INTERVIEW_WORKSPACE_CLEAR_EVENT));
      return;
    }
    const detail = { stage: selectedRound.bankStage, positionTitle };
    window.dispatchEvent(new CustomEvent(INTERVIEW_WORKSPACE_FOCUS_EVENT, { detail }));
    window.dispatchEvent(new CustomEvent(INTERVIEW_BUILDER_CONTEXT_EVENT, { detail }));
  }, [selectedRound, positionTitle]);

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
      if (!selectedRoundId || !detail?.question) return;
      addBankQuestion(detail.question);
    }
    window.addEventListener(INTERVIEW_BANK_ADD_EVENT, addFromBankPanel);
    return () => window.removeEventListener(INTERVIEW_BANK_ADD_EVENT, addFromBankPanel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoundId]);

  function patchQuestions(roundId: string, updater: (current: Question[]) => Question[]) {
    setQuestionsByRound((current) => ({ ...current, [roundId]: updater(current[roundId] || []) }));
  }

  function addInterview() {
    if (rounds.length >= 10) return;
    const stage = roundKey();
    const nextRound: InterviewRound = { id: stage, stage, title: 'New Interview', bankStage: 'round-1' };
    setRounds((current) => [...current, nextRound]);
    setQuestionsByRound((current) => ({ ...current, [stage]: [] }));
    setSelectedRoundId(stage);
  }

  function renameInterview(title: string) {
    if (!selectedRoundId) return;
    setRounds((current) => current.map((round) => round.id === selectedRoundId ? { ...round, title } : round));
  }

  function removeInterview() {
    if (!selectedRoundId) return;
    const removeId = selectedRoundId;
    setRounds((current) => current.filter((round) => round.id !== removeId));
    setQuestionsByRound((current) => {
      const next = { ...current };
      delete next[removeId];
      return next;
    });
    setSelectedRoundId(null);
  }

  function reorderInterview(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setRounds((current) => {
      const source = current.find((round) => round.id === sourceId);
      const targetIndex = current.findIndex((round) => round.id === targetId);
      if (!source || targetIndex < 0) return current;
      const next = current.filter((round) => round.id !== sourceId);
      next.splice(targetIndex, 0, source);
      return next;
    });
  }

  function addBankQuestionToRound(roundId: string, source: BankQuestion, targetId?: string) {
    if (usedSourceIds.has(source.id)) return;
    patchQuestions(roundId, (current) => {
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
    if (!selectedRoundId) return;
    addBankQuestionToRound(selectedRoundId, source, targetId);
  }

  function addManualQuestion() {
    if (!selectedRoundId) return;
    patchQuestions(selectedRoundId, (current) => [
      { id: localId(), text: 'Add a new interview question…', areas: [], commentBox: true },
      ...current
    ]);
  }

  function updateQuestion(questionId: string, patch: Partial<Question>) {
    if (!selectedRoundId) return;
    patchQuestions(selectedRoundId, (current) => current.map((question) =>
      question.id === questionId ? { ...question, ...patch } : question
    ));
  }

  function removeQuestion(questionId: string) {
    if (!selectedRoundId) return;
    patchQuestions(selectedRoundId, (current) => current.filter((question) => question.id !== questionId));
    if (openAreaId === questionId) setOpenAreaId(null);
  }

  function toggleArea(questionId: string, area: string) {
    if (!selectedRoundId) return;
    patchQuestions(selectedRoundId, (current) => current.map((question) => {
      if (question.id !== questionId) return question;
      if (question.areas.includes(area)) return { ...question, areas: question.areas.filter((item) => item !== area) };
      if (question.areas.length >= 4) return question;
      return { ...question, areas: [...question.areas, area] };
    }));
  }

  function toggleCommentBox(questionId: string) {
    if (!selectedRoundId) return;
    patchQuestions(selectedRoundId, (current) => current.map((question) =>
      question.id === questionId ? { ...question, commentBox: !question.commentBox } : question
    ));
  }

  function toggleYesNo(questionId: string) {
    if (!selectedRoundId) return;
    patchQuestions(selectedRoundId, (current) => current.map((question) =>
      question.id === questionId ? { ...question, yesNo: !question.yesNo } : question
    ));
  }

  function reorderQuestion(sourceId: string, targetId: string) {
    if (!selectedRoundId || sourceId === targetId) return;
    patchQuestions(selectedRoundId, (current) => {
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

  function renderRoundBar(round: InterviewRound, selected = false) {
    return (
      <button
        type="button"
        className={`${styles.roundBar} ${selected ? styles.selectedBar : ''}`}
        onClick={() => setSelectedRoundId(selected ? null : round.id)}
        aria-expanded={selected}
      >
        <span className={styles.roundTitle}>{round.title || 'Untitled Interview'}</span>
        <span className={styles.roundMeta}>
          <span>{candidateNames.length} Candidates</span><span>•</span><span>0 Participants</span><span>•</span><span>0 Submitted</span>
        </span>
      </button>
    );
  }

  function renderHeading() {
    return (
      <div className={styles.headingRow}>
        <div className={styles.interviewHeading}>
          <span className="eyebrow">Interview planning</span>
          <h2>Interviews</h2>
          <p>Create the interviews your process needs. Names and order are fully flexible.</p>
        </div>
        <button type="button" className={styles.addInterview} onClick={addInterview} disabled={rounds.length >= 10}>+ Add Interview</button>
      </div>
    );
  }

  if (!selectedRound) {
    return (
      <section className={styles.plan} data-requisition-id={requisitionId}>
        {renderHeading()}
        <div className={styles.roundList}>
          {rounds.map((round) => (
            <div
              key={round.id}
              className={`${styles.roundShell} ${dropRoundId === round.id ? styles.roundDropTarget : ''}`}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(INTERVIEW_BANK_DRAG_MIME)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                  setDropRoundId(round.id);
                  return;
                }
                if (draggedRoundId && draggedRoundId !== round.id) event.preventDefault();
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropRoundId(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const bankQuestion = parseBankQuestion(event);
                if (bankQuestion) addBankQuestionToRound(round.id, bankQuestion);
                else if (draggedRoundId) reorderInterview(draggedRoundId, round.id);
                setDraggedRoundId(null);
                setDropRoundId(null);
              }}
            >
              <span
                className={styles.roundDragHandle}
                draggable
                title="Drag to reorder interviews"
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', round.id);
                  setDraggedRoundId(round.id);
                }}
                onDragEnd={() => { setDraggedRoundId(null); setDropRoundId(null); }}
              >⠿</span>
              {renderRoundBar(round)}
            </div>
          ))}
          {rounds.length === 0 && <p className={styles.emptyPlan}>No interviews yet. Add the first interview when you are ready.</p>}
        </div>
      </section>
    );
  }

  const formDesignerHref = `/form-branding-preview?requisitionId=${encodeURIComponent(requisitionId)}&stage=${encodeURIComponent(selectedRound.stage)}`;

  return (
    <section className={styles.plan} data-requisition-id={requisitionId} data-interview-plan="selected">
      {renderHeading()}
      <div className={styles.selectedRound}>
        {renderRoundBar(selectedRound, true)}

        <div className={styles.roundContent}>
          <div className={styles.roundSetup}>
            <label htmlFor="interview-name">Interview name</label>
            <input id="interview-name" value={selectedRound.title} maxLength={200} onChange={(event) => renameInterview(event.target.value)} />
            <a className={styles.formDesignerLink} href={formDesignerHref}>Form Designer</a>
            <button type="button" className={styles.removeInterview} onClick={removeInterview}>Remove Interview</button>
          </div>

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
        </div>
      </div>
    </section>
  );
}
