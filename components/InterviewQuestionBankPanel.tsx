'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { AREAS_OF_EVALUATION, type BankQuestion, type InterviewStageId } from '@/lib/interviewQuestionBank';
import {
  INTERVIEW_BANK_ADD_EVENT,
  INTERVIEW_BANK_DRAG_MIME,
  INTERVIEW_BANK_USED_EVENT,
  INTERVIEW_BUILDER_CONTEXT_EVENT,
  type InterviewBankUsedDetail,
  type InterviewBuilderContextDetail
} from '@/lib/interviewQuestionBankEvents';
import styles from './InterviewQuestionBankPanel.module.css';

type AvailableQuestion = { id: string; text: string; areas: string[] };

function customQuestionId(stage: InterviewStageId) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `custom-${stage}-${suffix}`;
}

export function InterviewQuestionBankPanel({
  requisitionId,
  initialStage = 'round-1'
}: {
  requisitionId: string;
  initialStage?: InterviewStageId;
  initialPositionTitle?: string;
}) {
  const [stage, setStage] = useState<InterviewStageId>(initialStage);
  const [starterQuestions, setStarterQuestions] = useState<AvailableQuestion[]>([]);
  const [generatedQuestions, setGeneratedQuestions] = useState<AvailableQuestion[]>([]);
  const [usedIds, setUsedIds] = useState<Set<string>>(() => new Set());
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  const [loadingBank, setLoadingBank] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const availableQuestions = useMemo(
    () => [...generatedQuestions, ...starterQuestions].filter((question) => !usedIds.has(question.id)),
    [generatedQuestions, starterQuestions, usedIds]
  );

  useEffect(() => {
    setStage(initialStage);
  }, [initialStage]);

  useEffect(() => {
    let cancelled = false;
    setLoadingBank(true);
    setError('');
    fetch(`/api/requisitions/${requisitionId}/interview-question-bank`, { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result?.error || 'Unable to load interview questions.');
        if (cancelled) return;
        setStarterQuestions(Array.isArray(result.starterQuestions) ? result.starterQuestions : []);
        setGeneratedQuestions(Array.isArray(result.generatedQuestions) ? result.generatedQuestions : []);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load interview questions.');
      })
      .finally(() => {
        if (!cancelled) setLoadingBank(false);
      });
    return () => { cancelled = true; };
  }, [requisitionId]);

  useEffect(() => {
    function syncContext(event: Event) {
      const detail = (event as CustomEvent<InterviewBuilderContextDetail>).detail;
      if (detail?.stage) setStage(detail.stage);
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

  useEffect(() => {
    if (!areaPickerOpen) return;
    function closeOnPointer(event: PointerEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setAreaPickerOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setAreaPickerOpen(false);
    }
    document.addEventListener('pointerdown', closeOnPointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [areaPickerOpen]);

  function asBankQuestion(question: AvailableQuestion): BankQuestion {
    return { ...question, stage };
  }

  function add(question: AvailableQuestion) {
    window.dispatchEvent(new CustomEvent(INTERVIEW_BANK_ADD_EVENT, { detail: { question: asBankQuestion(question) } }));
  }

  function addCustomQuestion() {
    const question: BankQuestion = { id: customQuestionId(stage), stage, text: '', areas: [] };
    window.dispatchEvent(new CustomEvent(INTERVIEW_BANK_ADD_EVENT, { detail: { question } }));
  }

  function startDrag(event: DragEvent<HTMLDivElement>, question: AvailableQuestion) {
    const bankQuestion = asBankQuestion(question);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(INTERVIEW_BANK_DRAG_MIME, JSON.stringify(bankQuestion));
    event.dataTransfer.setData('text/plain', question.text);
  }

  function toggleSelectedArea(area: string) {
    setSelectedAreas((current) => current.includes(area) ? current.filter((item) => item !== area) : [...current, area]);
  }

  async function generateMore() {
    if (generating) return;
    setGenerating(true);
    setError('');
    try {
      const response = await fetch(`/api/requisitions/${requisitionId}/interview-question-bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedAreas })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Unable to generate interview questions.');
      const questions = Array.isArray(result.questions) ? result.questions as AvailableQuestion[] : [];
      setGeneratedQuestions((current) => [...questions, ...current]);
      setSelectedAreas([]);
      setAreaPickerOpen(false);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Unable to generate interview questions.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.generator}>
        <div className={styles.areaPicker} ref={pickerRef}>
          <button type="button" className={styles.areaPickerButton} onClick={() => setAreaPickerOpen((open) => !open)} aria-expanded={areaPickerOpen}>
            {selectedAreas.length ? `Areas of Evaluation (${selectedAreas.length})` : 'Areas of Evaluation (optional)'} ▾
          </button>
          {areaPickerOpen && (
            <div className={styles.areaMenu}>
              {AREAS_OF_EVALUATION.map((area) => (
                <label key={area} className={styles.areaOption}>
                  <input type="checkbox" checked={selectedAreas.includes(area)} onChange={() => toggleSelectedArea(area)} />
                  <span>{area}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <button type="button" className={styles.generateButton} onClick={generateMore} disabled={generating}>
          {generating ? 'Generating…' : 'Generate 5 Questions · 1 QC'}
        </button>
        <p className={styles.generatorHint}>
          {selectedAreas.length ? `Targeting ${selectedAreas.join(', ')}.` : 'No AOE selected — Stapphire will target useful coverage gaps.'}
        </p>
        {error && <p className={styles.error}>{error}</p>}
      </div>

      <div className={styles.list}>
        <div className={`${styles.question} ${styles.wildcard}`}>
          <div className={styles.questionTop}>
            <span className={styles.wildcardIcon} aria-hidden="true">＋</span>
            <div>
              <p>Blank Question</p>
              <span className={styles.wildcardCopy}>Write your own question and choose its Areas of Evaluation.</span>
            </div>
          </div>
          <button type="button" onClick={addCustomQuestion}>+ Add Blank Question</button>
        </div>

        {loadingBank && <p className={styles.empty}>Loading questions…</p>}
        {!loadingBank && availableQuestions.map((question) => (
          <div key={question.id} className={styles.question} draggable onDragStart={(event) => startDrag(event, question)}>
            <div className={styles.questionTop}>
              <span className={styles.drag} aria-hidden="true">⠿</span>
              <p>{question.text}</p>
            </div>
            <div className={styles.chips}>
              {question.areas.map((area) => <span key={area}>{area}</span>)}
            </div>
            <button type="button" onClick={() => add(question)}>+ Add</button>
          </div>
        ))}
        {!loadingBank && availableQuestions.length === 0 && <p className={styles.empty}>All available questions are currently in use.</p>}
      </div>

      <div className={styles.footer}>Questions disappear from the bank when used and return if removed from an interview.</div>
    </div>
  );
}
