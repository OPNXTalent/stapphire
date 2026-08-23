'use client';

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { InterviewScorecardPreview } from '@/components/InterviewScorecardPreview';
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

export function InterviewBuilder({ positionTitle, hasJobDescription }: { positionTitle: string; hasJobDescription: boolean }) {
  const bank = useMemo(() => buildQuestionBank(positionTitle), [positionTitle]);
  const initialQuestions = bank.filter((question) => question.stage === 'phone-screen').slice(0, 3).map(cloneFromBank);
  const [stage, setStage] = useState<InterviewStageId>('phone-screen');
  const [title, setTitle] = useState(`Phone Screen — ${positionTitle}`);
  const [questions, setQuestions] = useState<Question[]>(() => initialQuestions);
  const [openAreaId, setOpenAreaId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const stageConfig = INTERVIEW_STAGES.find((item) => item.id === stage)!;
  const previewQuestion = questions.find((question) => question.id === previewId) || questions[0] || null;
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
      if (selected) return { ...question, areas: question.areas.filter((item) => item !== area) };
      if (question.areas.length >= 4) return question;
      return { ...question, areas: [...question.areas, area] };
    }));
  }

  function addManualQuestion() {
    const next: Question = { id: id(), text: 'Add a new interview question…', areas: [] };
    setQuestions((current) => [...current, next]);
    setPreviewId(next.id);
  }

  function addBankQuestion(source: BankQuestion, targetId?: string) {
    setQuestions((current) => {
      if (current.some((question) => question.sourceId === source.id)) return current;
      const next = cloneFromBank(source);
      if (!targetId) return [...current, next];
      const targetIndex = current.findIndex((question) => question.id === targetId);
      if (targetIndex < 0) return [...current, next];
      const result = [...current];
      result.splice(targetIndex, 0, next);
      return result;
    });
  }

  function removeQuestion(questionId: string) {
    setQuestions((current) => current.filter((question) => question.id !== questionId));
    if (previewId === questionId) setPreviewId(null);
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
            <span className={styles.metric}>1–5 Star Rating</span>
          </div>
        </div>

        <div className={styles.questionList} onDragOver={(event) => event.preventDefault()} onDrop={dropAtEnd}>
          {questions.map((question, index) => {
            const maxed = question.areas.length >= 4;
            return (
              <div
                key={question.id}
                className={`${styles.questionCard} ${previewQuestion?.id === question.id ? styles.active : ''} ${dropTargetId === question.id ? styles.dropTarget : ''}`}
                onClick={() => setPreviewId(question.id)}
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
                  onClick={(event) => event.stopPropagation()}
                  onDragStart={(event) => startQuestionDrag(event, question.id)}
                  onDragEnd={() => { setDraggedQuestionId(null); setDropTargetId(null); }}
                >⠿</span>

                <div className={styles.questionMain}>
                  <div className={styles.questionTop}>
                    <span className={styles.questionNumber}>Q{index + 1}</span>
                    <input
                      className={styles.questionInput}
                      value={question.text}
                      aria-label={`Question ${index + 1}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => updateQuestion(question.id, { text: event.target.value })}
                    />
                    <button type="button" className={styles.removeQuestion} aria-label={`Remove question ${index + 1}`} onClick={(event) => { event.stopPropagation(); removeQuestion(question.id); }}>×</button>
                  </div>

                  <div className={styles.areaRow} onClick={(event) => event.stopPropagation()}>
                    <button type="button" className={styles.areaMenuButton} aria-expanded={openAreaId === question.id} onClick={() => setOpenAreaId(openAreaId === question.id ? null : question.id)}>
                      Areas of Evaluation ({question.areas.length}) ▾
                    </button>
                    {question.areas.map((area) => (
                      <span className={styles.chip} key={area}>{area}<button type="button" aria-label={`Remove ${area}`} onClick={() => toggleArea(question.id, area)}>×</button></span>
                    ))}

                    {openAreaId === question.id && (
                      <div className={styles.areaMenu} role="group" aria-label={`Areas of Evaluation for question ${index + 1}`}>
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
                  <div className={styles.areaHint}>Suggested Areas of Evaluation come with generated questions. Keep or adjust up to four.</div>
                </div>
              </div>
            );
          })}
          <div className={styles.dropEnd}>Drop a Question Bank item here to add it</div>
        </div>

        <div className={styles.questionActions}>
          <button type="button" className={styles.addQuestion} onClick={addManualQuestion}>+ Add Manual Question</button>
        </div>
      </div>

      <InterviewScorecardPreview question={previewQuestion} />

      <div className={styles.footer}>
        <span className={styles.footerNote}>Pre-production UI only. Question Bank generation, persistence, invitations, and scoring storage are not wired yet.</span>
        <button type="button" className={styles.saveButton} disabled title="Saving will be enabled with interview persistence.">Save Interview</button>
      </div>
    </div>
  );
}
