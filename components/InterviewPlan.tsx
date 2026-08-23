'use client';

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  AREAS_OF_EVALUATION,
  buildQuestionBank,
  type BankQuestion,
  type InterviewStageId
} from '@/lib/interviewQuestionBank';
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
  title: string;
  stage: InterviewStageId;
};

type Question = {
  id: string;
  sourceId?: string;
  text: string;
  areas: string[];
};

function localId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function cloneBankQuestion(question: BankQuestion): Question {
  return { id: localId(), sourceId: question.id, text: question.text, areas: [...question.areas] };
}

function parseBankQuestion(event: DragEvent<HTMLElement>): BankQuestion | null {
  const raw = event.dataTransfer.getData(INTERVIEW_BANK_DRAG_MIME);
  if (!raw) return null;
  try {
    const question = JSON.parse(raw) as BankQuestion;
    return question?.id && question?.text && Array.isArray(question.areas) ? question : null;
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
  const rounds = useMemo<InterviewRound[]>(() => [
    { id: 'phone-screen', title: `Phone Screen — ${positionTitle}`, stage: 'phone-screen' },
    { id: 'round-1', title: 'Round 1 — Hiring Manager', stage: 'round-1' },
    { id: 'round-2', title: 'Round 2 — Panel Interview', stage: 'round-2' }
  ], [positionTitle]);
  const bank = useMemo(() => buildQuestionBank(positionTitle), [positionTitle]);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [questionsByRound, setQuestionsByRound] = useState<Record<string, Question[]>>(() => ({
    'phone-screen': bank.filter((question) => question.stage === 'phone-screen').slice(0, 3).map(cloneBankQuestion),
    'round-1': bank.filter((question) => question.stage === 'round-1').slice(0, 4).map(cloneBankQuestion),
    'round-2': bank.filter((question) => question.stage === 'round-2').slice(0, 4).map(cloneBankQuestion)
  }));
  const [openAreaId, setOpenAreaId] = useState<string | null>(null);
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});

  const selectedRound = rounds.find((round) => round.id === selectedRoundId) || null;
  const questions = selectedRound ? questionsByRound[selectedRound.id] || [] : [];
  const usedSourceIds = useMemo(
    () => new Set(questions.map((question) => question.sourceId).filter(Boolean) as string[]),
    [questions]
  );

  useEffect(() => {
    if (!selectedRound) {
      window.dispatchEvent(new CustomEvent(INTERVIEW_WORKSPACE_CLEAR_EVENT));
      return;
    }
    const detail = { stage: selectedRound.stage, positionTitle };
    window.dispatchEvent(new CustomEvent(INTERVIEW_WORKSPACE_FOCUS_EVENT, { detail }));
    window.dispatchEvent(new CustomEvent(INTERVIEW_BUILDER_CONTEXT_EVENT, { detail }));
  }, [selectedRound, positionTitle]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent(INTERVIEW_WORKSPACE_CLEAR_EVENT));
    };
  }, []);

  useEffect(() => {
    if (!selectedRound) return;
    window.dispatchEvent(new CustomEvent(INTERVIEW_BANK_USED_EVENT, {
      detail: { sourceIds: Array.from(usedSourceIds) }
    }));
  }, [selectedRound, usedSourceIds]);

  useEffect(() => {
    function addFromBankPanel(event: Event) {
      const detail = (event as CustomEvent<InterviewBankAddDetail>).detail;
      if (!selectedRoundId || !detail?.question) return;
      addBankQuestion(detail.question);
    }
    window.addEventListener(INTERVIEW_BANK_ADD_EVENT, addFromBankPanel);
    return () => window.removeEventListener(INTERVIEW_BANK_ADD_EVENT, addFromBankPanel);
    // The selected round is intentionally the dependency for bank additions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoundId]);

  function patchQuestions(roundId: string, updater: (current: Question[]) => Question[]) {
    setQuestionsByRound((current) => ({
      ...current,
      [roundId]: updater(current[roundId] || [])
    }));
  }

  function addBankQuestion(source: BankQuestion, targetId?: string) {
    if (!selectedRoundId) return;
    patchQuestions(selectedRoundId, (current) => {
      if (current.some((question) => question.sourceId === source.id)) return current;
      const next = cloneBankQuestion(source);
      if (!targetId) return [...current, next];
      const targetIndex = current.findIndex((question) => question.id === targetId);
      if (targetIndex < 0) return [...current, next];
      const result = [...current];
      result.splice(targetIndex, 0, next);
      return result;
    });
  }

  function addManualQuestion() {
    if (!selectedRoundId) return;
    patchQuestions(selectedRoundId, (current) => [
      ...current,
      { id: localId(), text: 'Add a new interview question…', areas: [] }
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
      if (question.areas.includes(area)) {
        return { ...question, areas: question.areas.filter((item) => item !== area) };
      }
      if (question.areas.length >= 4) return question;
      return { ...question, areas: [...question.areas, area] };
    }));
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
        <span className={styles.roundTitle}>{round.title}</span>
        <span className={styles.roundMeta}>
          <span>{candidateNames.length} Candidates</span>
          <span>•</span>
          <span>0 Participants</span>
          <span>•</span>
          <span>0 Submitted</span>
        </span>
      </button>
    );
  }

  function renderHeading() {
    return (
      <div className={styles.interviewHeading}>
        <span className="eyebrow">Interview planning</span>
        <h2>Interviews</h2>
        <p>Build each interview round and define how candidates will be evaluated.</p>
      </div>
    );
  }

  if (!selectedRound) {
    return (
      <section className={styles.plan} data-requisition-id={requisitionId}>
        {renderHeading()}
        <div className={styles.roundList}>
          {rounds.map((round) => <div key={round.id}>{renderRoundBar(round)}</div>)}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.plan} data-requisition-id={requisitionId} data-interview-plan="selected">
      {renderHeading()}
      <div className={styles.selectedRound}>
        {renderRoundBar(selectedRound, true)}

        <div className={styles.roundContent}>
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
                    if (draggedQuestionId !== question.id || event.dataTransfer.types.includes(INTERVIEW_BANK_DRAG_MIME)) {
                      setDropTargetId(question.id);
                    }
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
                    onDragEnd={() => {
                      setDraggedQuestionId(null);
                      setDropTargetId(null);
                    }}
                  >⠿</span>

                  <div className={styles.questionMain}>
                    <div className={styles.questionTop}>
                      <span className={styles.questionNumber}>Q{index + 1}</span>
                      <input
                        value={question.text}
                        aria-label={`Question ${index + 1}`}
                        onChange={(event) => updateQuestion(question.id, { text: event.target.value })}
                      />
                      <button type="button" className={styles.removeQuestion} onClick={() => removeQuestion(question.id)} aria-label={`Remove question ${index + 1}`}>×</button>
                    </div>

                    <div className={styles.areaLine}>
                      <button
                        type="button"
                        className={styles.areaButton}
                        onClick={() => setOpenAreaId(openAreaId === question.id ? null : question.id)}
                        aria-expanded={openAreaId === question.id}
                      >
                        Areas of Evaluation ({question.areas.length}) ▾
                      </button>
                      {question.areas.map((area) => (
                        <span className={styles.areaChip} key={area}>{area}<button type="button" onClick={() => toggleArea(question.id, area)} aria-label={`Remove ${area}`}>×</button></span>
                      ))}
                      {openAreaId === question.id && (
                        <div className={styles.areaMenu}>
                          {AREAS_OF_EVALUATION.map((area) => {
                            const checked = question.areas.includes(area);
                            return (
                              <label className={styles.areaOption} key={area}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={maxed && !checked}
                                  onChange={() => toggleArea(question.id, area)}
                                />
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
                          <span role="columnheader">Area of Evaluation</span>
                          <span role="columnheader">Rating</span>
                        </div>
                        {question.areas.map((area) => {
                          const key = ratingKey(question.id, area);
                          const value = ratings[key] || 0;
                          return (
                            <div className={styles.scoringRow} role="row" key={area}>
                              <span className={styles.scoringArea} role="cell">{area}</span>
                              <span className={styles.starGroup} role="cell" aria-label={`${area} rating`}>
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <button
                                    type="button"
                                    key={star}
                                    className={`${styles.star} ${value >= star ? styles.starSelected : ''}`}
                                    onClick={() => setRatings((current) => ({ ...current, [key]: star }))}
                                    aria-label={`Rate ${area} ${star} out of 5`}
                                    aria-pressed={value === star}
                                  >
                                    {value >= star ? '★' : '☆'}
                                  </button>
                                ))}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div className={styles.dropEnd}>Drop a Question Bank item here</div>
          </div>

          <button type="button" className={styles.addManual} onClick={addManualQuestion}>+ Add Manual Question</button>
        </div>
      </div>
    </section>
  );
}
