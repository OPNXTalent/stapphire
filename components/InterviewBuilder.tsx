'use client';

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  AREAS_OF_EVALUATION,
  buildQuestionBank,
  INTERVIEW_STAGES,
  type BankQuestion,
  type InterviewStageId
} from '@/lib/interviewQuestionBank';
import {
  INTERVIEW_BANK_ADD_EVENT,
  INTERVIEW_BANK_DRAG_MIME,
  INTERVIEW_BANK_USED_EVENT,
  INTERVIEW_BUILDER_CONTEXT_EVENT,
  type InterviewBankAddDetail
} from '@/lib/interviewQuestionBankEvents';
import styles from './InterviewBuilder.module.css';

type Question = { id: string; sourceId?: string; text: string; areas: string[] };
type RatingState = Record<string, number>;

function id() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function cloneFromBank(question: BankQuestion): Question {
  return { id: id(), sourceId: question.id, text: question.text, areas: [...question.areas] };
}

function parseBankQuestion(event: DragEvent<HTMLElement>): BankQuestion | null {
  const raw = event.dataTransfer.getData(INTERVIEW_BANK_DRAG_MIME);
  if (!raw) return null;
  try {
    const question = JSON.parse(raw) as BankQuestion;
    if (!question?.id || !question?.text || !Array.isArray(question.areas)) return null;
    return question;
  } catch {
    return null;
  }
}

function ratingKey(questionId: string, area: string) {
  return `${questionId}::${area}`;
}

export function InterviewBuilder({ positionTitle, hasJobDescription }: { positionTitle: string; hasJobDescription: boolean }) {
  const bank = useMemo(() => buildQuestionBank(positionTitle), [positionTitle]);
  const initialQuestions = bank.filter((question) => question.stage === 'phone-screen').slice(0, 3).map(cloneFromBank);
  const [stage, setStage] = useState<InterviewStageId>('phone-screen');
  const [title, setTitle] = useState(`Phone Screen — ${positionTitle}`);
  const [questions, setQuestions] = useState<Question[]>(() => initialQuestions);
  const [openAreaId, setOpenAreaId] = useState<string | null>(null);
  const [customAreaDrafts, setCustomAreaDrafts] = useState<Record<string, string>>({});
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<RatingState>({});

  const stageConfig = INTERVIEW_STAGES.find((item) => item.id === stage)!;
  const coveredAreas = useMemo(() => new Set(questions.flatMap((question) => question.areas)).size, [questions]);
  const usedSourceIds = useMemo(() => new Set(questions.map((question) => question.sourceId).filter(Boolean) as string[]), [questions]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(INTERVIEW_BUILDER_CONTEXT_EVENT, {
      detail: { stage, positionTitle }
    }));
  }, [stage, positionTitle]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(INTERVIEW_BANK_USED_EVENT, {
      detail: { sourceIds: Array.from(usedSourceIds) }
    }));
  }, [usedSourceIds]);

  useEffect(() => {
    function addFromPanel(event: Event) {
      const detail = (event as CustomEvent<InterviewBankAddDetail>).detail;
      if (!detail?.question) return;
      addBankQuestion(detail.question);
    }
    window.addEventListener(INTERVIEW_BANK_ADD_EVENT, addFromPanel);
    return () => window.removeEventListener(INTERVIEW_BANK_ADD_EVENT, addFromPanel);
    // addBankQuestion intentionally reads current state through setQuestions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeStage(nextStage: InterviewStageId) {
    setStage(nextStage);
    const next = INTERVIEW_STAGES.find((item) => item.id === nextStage)!;
    setTitle(`${next.label} — ${positionTitle}`);
  }

  function updateQuestion(questionId: string, patch: Partial<Question>) {
    setQuestions((current) => current.map((question) => question.id === questionId ? { ...question, ...patch } : question));
  }

  function toggleArea(questionId: string, area: string) {
    setQuestions((current) => current.map((question) => {
      if (question.id !== questionId) return question;
      const selected = question.areas.includes(area);
      if (selected) {
        setRatings((currentRatings) => {
          const next = { ...currentRatings };
          delete next[ratingKey(questionId, area)];
          return next;
        });
        return { ...question, areas: question.areas.filter((item) => item !== area) };
      }
      if (question.areas.length >= 4) return question;
      return { ...question, areas: [...question.areas, area] };
    }));
  }

  function addCustomArea(questionId: string) {
    const area = (customAreaDrafts[questionId] || '').trim();
    if (!area) return;
    setQuestions((current) => current.map((question) => {
      if (question.id !== questionId || question.areas.length >= 4) return question;
      if (question.areas.some((item) => item.toLocaleLowerCase() === area.toLocaleLowerCase())) return question;
      return { ...question, areas: [...question.areas, area] };
    }));
    setCustomAreaDrafts((current) => ({ ...current, [questionId]: '' }));
  }

  function setAreaRating(questionId: string, area: string, rating: number) {
    setRatings((current) => ({ ...current, [ratingKey(questionId, area)]: rating }));
  }

  function addManualQuestion() {
    const next: Question = { id: id(), text: '', areas: [] };
    setQuestions((current) => [...current, next]);
    setOpenAreaId(next.id);
  }

  function addBankQuestion(source: BankQuestion, targetId?: string) {
    const next = cloneFromBank(source);
    setQuestions((current) => {
      if (current.some((question) => question.sourceId === source.id)) return current;
      if (!targetId) return [...current, next];
      const targetIndex = current.findIndex((question) => question.id === targetId);
      if (targetIndex < 0) return [...current, next];
      const result = [...current];
      result.splice(targetIndex, 0, next);
      return result;
    });
    if (source.id.startsWith('custom-')) setOpenAreaId(next.id);
  }

  function removeQuestion(questionId: string) {
    setQuestions((current) => current.filter((question) => question.id !== questionId));
    setRatings((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${questionId}::`))));
    setCustomAreaDrafts((current) => {
      const next = { ...current };
      delete next[questionId];
      return next;
    });
    if (openAreaId === questionId) setOpenAreaId(null);
  }

  function reorderQuestion(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setQuestions((current) => {
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

  function startQuestionDrag(event: DragEvent<HTMLSpanElement>, questionId: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', questionId);
    setDraggedQuestionId(questionId);
  }

  return (
    <div className={styles.shell}>
      <div className={`card ${styles.setup}`}>
        <div className={styles.setupGrid}>
          <div className={styles.field}>
            <label htmlFor="interview-title">Interview title</label>
            <input id="interview-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="interview-stage">Stage</label>
            <select id="interview-stage" value={stage} onChange={(event) => changeStage(event.target.value as InterviewStageId)}>
              {INTERVIEW_STAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
        </div>
        <div className={styles.contextLine}>
          <span className={`${styles.bankState} ${hasJobDescription ? styles.ready : ''}`}>{hasJobDescription ? 'QUESTION BANK READY' : 'JD REQUIRED'}</span>
          <span>{hasJobDescription ? 'Generated automatically from this requisition’s JD + Hiring Criteria.' : 'Add a Job Description to generate the requisition Question Bank.'}</span>
        </div>
      </div>

      <div className={`card ${styles.questionsCard}`}>
        <div className={styles.questionsHeader}>
          <div>
            <span className="eyebrow">Interview questions</span>
            <h2>Build the instrument</h2>
            <p>{stageConfig.description}</p>
          </div>
          <div className={styles.metrics} aria-label="Interview metrics">
            <span className={styles.metric}>{questions.length} Questions</span>
            <span className={styles.metric}>{coveredAreas} Areas Evaluated</span>
            <span className={styles.metric}>1–5 Stars per Area</span>
          </div>
        </div>

        <div className={styles.questionList} onDragOver={(event) => event.preventDefault()} onDrop={dropAtEnd}>
          {questions.map((question, index) => {
            const maxed = question.areas.length >= 4;
            const customAreaDraft = customAreaDrafts[question.id] || '';
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
                  aria-label={`Drag question ${index + 1} to reorder`}
                  onDragStart={(event) => startQuestionDrag(event, question.id)}
                  onDragEnd={() => { setDraggedQuestionId(null); setDropTargetId(null); }}
                >⠿</span>

                <div className={styles.questionMain}>
                  <div className={styles.questionTop}>
                    <span className={styles.questionNumber}>Q{index + 1}</span>
                    <input
                      className={styles.questionInput}
                      value={question.text}
                      placeholder="Type your interview question…"
                      aria-label={`Question ${index + 1}`}
                      onChange={(event) => updateQuestion(question.id, { text: event.target.value })}
                    />
                    <button type="button" className={styles.removeQuestion} aria-label={`Remove question ${index + 1}`} onClick={() => removeQuestion(question.id)}>×</button>
                  </div>

                  <div className={styles.areaRow}>
                    <button type="button" className={styles.areaMenuButton} aria-expanded={openAreaId === question.id} onClick={() => setOpenAreaId(openAreaId === question.id ? null : question.id)}>
                      Areas of Evaluation ({question.areas.length}) ▾
                    </button>
                    {question.areas.map((area) => (
                      <span className={styles.chip} key={area}>{area}<button type="button" aria-label={`Remove ${area}`} onClick={() => toggleArea(question.id, area)}>×</button></span>
                    ))}

                    {openAreaId === question.id && (
                      <div className={styles.areaMenu} role="group" aria-label={`Areas of Evaluation for question ${index + 1}`}>
                        <div className={styles.customAreaCreator}>
                          <input
                            value={customAreaDraft}
                            disabled={maxed}
                            placeholder={maxed ? 'Maximum 4 areas' : 'Create a custom area…'}
                            aria-label={`Create custom Area of Evaluation for question ${index + 1}`}
                            onChange={(event) => setCustomAreaDrafts((current) => ({ ...current, [question.id]: event.target.value }))}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                addCustomArea(question.id);
                              }
                            }}
                          />
                          <button type="button" disabled={maxed || !customAreaDraft.trim()} onClick={() => addCustomArea(question.id)}>+ Add</button>
                        </div>
                        <div className={styles.areaMenuLabel}>Standard Areas</div>
                        {AREAS_OF_EVALUATION.map((area) => {
                          const checked = question.areas.includes(area);
                          const disabled = maxed && !checked;
                          return (
                            <label key={area} className={`${styles.areaOption} ${disabled ? styles.disabled : ''}`}>
                              <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleArea(question.id, area)} />
                              <span>{area}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className={styles.scoringBlock}>
                    <div className={styles.scoringHeader}>
                      <span>Area of Evaluation</span>
                      <span>Rating</span>
                    </div>
                    {question.areas.length ? question.areas.map((area) => {
                      const selectedRating = ratings[ratingKey(question.id, area)] || 0;
                      return (
                        <div className={styles.scoringRow} key={area}>
                          <span className={styles.scoringArea}>{area}</span>
                          <span className={styles.scoringStars} role="radiogroup" aria-label={`${area} rating for question ${index + 1}`}>
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                className={`${styles.scoreStar} ${star <= selectedRating ? styles.scoreStarSelected : ''}`}
                                role="radio"
                                aria-checked={selectedRating === star}
                                aria-label={`${star} star${star === 1 ? '' : 's'}`}
                                title={`${star} of 5`}
                                onClick={() => setAreaRating(question.id, area, star)}
                              >
                                {star <= selectedRating ? '★' : '☆'}
                              </button>
                            ))}
                          </span>
                        </div>
                      );
                    }) : (
                      <div className={styles.scoringEmpty}>Select a standard Area of Evaluation or create your own.</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div className={styles.dropEnd}>Drop a Question Bank item here to add it</div>
        </div>

        <div className={styles.questionActions}>
          <button type="button" className={styles.addQuestion} onClick={addManualQuestion}>+ Add Blank Question</button>
        </div>
      </div>

      <div className={styles.footer}>
        <span className={styles.footerNote}>Pre-production UI only. Stars demonstrate the participant form; ratings are not persisted yet.</span>
        <button type="button" className={styles.saveButton} disabled title="Saving will be enabled with interview persistence.">Save Interview</button>
      </div>
    </div>
  );
}
