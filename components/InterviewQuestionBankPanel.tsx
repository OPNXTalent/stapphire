'use client';

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { buildQuestionBank, INTERVIEW_STAGES, type BankQuestion, type InterviewStageId } from '@/lib/interviewQuestionBank';
import {
  INTERVIEW_BANK_ADD_EVENT,
  INTERVIEW_BANK_DRAG_MIME,
  INTERVIEW_BANK_USED_EVENT,
  INTERVIEW_BUILDER_CONTEXT_EVENT,
  type InterviewBankUsedDetail,
  type InterviewBuilderContextDetail
} from '@/lib/interviewQuestionBankEvents';
import styles from './InterviewQuestionBankPanel.module.css';

function customQuestionId(stage: InterviewStageId) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `custom-${stage}-${suffix}`;
}

export function InterviewQuestionBankPanel({
  initialStage = 'phone-screen',
  initialPositionTitle = 'this role'
}: {
  initialStage?: InterviewStageId;
  initialPositionTitle?: string;
}) {
  const [stage, setStage] = useState<InterviewStageId>(initialStage);
  const [positionTitle, setPositionTitle] = useState(initialPositionTitle);
  const [usedIds, setUsedIds] = useState<Set<string>>(() => new Set());
  const bank = useMemo(() => buildQuestionBank(positionTitle), [positionTitle]);
  const questions = bank.filter((question) => question.stage === stage);

  useEffect(() => {
    setStage(initialStage);
    setPositionTitle(initialPositionTitle);
  }, [initialStage, initialPositionTitle]);

  useEffect(() => {
    function syncContext(event: Event) {
      const detail = (event as CustomEvent<InterviewBuilderContextDetail>).detail;
      if (!detail) return;
      if (detail.stage) setStage(detail.stage);
      if (detail.positionTitle) setPositionTitle(detail.positionTitle);
    }
    function syncUsed(event: Event) {
      const detail = (event as CustomEvent<InterviewBankUsedDetail>).detail;
      setUsedIds(new Set(detail?.sourceIds || []));
    }
    window.addEventListener(INTERVIEW_BUILDER_CONTEXT_EVENT, syncContext);
    window.addEventListener(INTERVIEW_BANK_USED_EVENT, syncUsed);
    return () => {
      window.removeEventListener(INTERVIEW_BUILDER_CONTEXT_EVENT, syncContext);
      window.removeEventListener(INTERVIEW_BANK_USED_EVENT, syncUsed);
    };
  }, []);

  function add(question: (typeof questions)[number]) {
    if (usedIds.has(question.id)) return;
    window.dispatchEvent(new CustomEvent(INTERVIEW_BANK_ADD_EVENT, { detail: { question } }));
  }

  function addCustomQuestion() {
    const question: BankQuestion = {
      id: customQuestionId(stage),
      stage,
      text: '',
      areas: []
    };
    window.dispatchEvent(new CustomEvent(INTERVIEW_BANK_ADD_EVENT, { detail: { question } }));
  }

  function startDrag(event: DragEvent<HTMLDivElement>, question: (typeof questions)[number]) {
    if (usedIds.has(question.id)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(INTERVIEW_BANK_DRAG_MIME, JSON.stringify(question));
    event.dataTransfer.setData('text/plain', question.text);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.eyebrow}>Generated questions</span>
        <h2>Question Bank</h2>
        <p>Built automatically from the requisition JD + Hiring Criteria.</p>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Question bank stages">
        {INTERVIEW_STAGES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={stage === item.id}
            className={stage === item.id ? styles.activeTab : ''}
            onClick={() => setStage(item.id)}
          >
            {item.shortLabel}
          </button>
        ))}
      </div>

      <div className={styles.list}>
        <div className={`${styles.question} ${styles.wildcard}`}>
          <div className={styles.questionTop}>
            <span className={styles.wildcardIcon} aria-hidden="true">＋</span>
            <div>
              <p>Blank Question</p>
              <span className={styles.wildcardCopy}>Write your own question and choose or create its Areas of Evaluation.</span>
            </div>
          </div>
          <button type="button" onClick={addCustomQuestion}>+ Add Blank Question</button>
        </div>

        {questions.map((question) => {
          const used = usedIds.has(question.id);
          return (
            <div
              key={question.id}
              className={`${styles.question} ${used ? styles.used : ''}`}
              draggable={!used}
              onDragStart={(event) => startDrag(event, question)}
            >
              <div className={styles.questionTop}>
                <span className={styles.drag} aria-hidden="true">⠿</span>
                <p>{question.text}</p>
              </div>
              <div className={styles.chips}>
                {question.areas.map((area) => <span key={area}>{area}</span>)}
              </div>
              <button type="button" disabled={used} onClick={() => add(question)}>
                {used ? 'Added' : '+ Add'}
              </button>
            </div>
          );
        })}
      </div>

      <div className={styles.footer}>Add a blank question, drag a generated question into the interview, or use + Add.</div>
    </div>
  );
}
