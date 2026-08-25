'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { AREAS_OF_EVALUATION, type BankQuestion, type InterviewStageId } from '@/lib/interviewQuestionBank';
import { AOE_PREFERENCES_CHANGED_EVENT, type AoePreferences } from '@/lib/aoePreferences';
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

const UNSAVED_STARTER_USED_IDS = new Set([
  'phone-screen-1','phone-screen-2','phone-screen-3','phone-screen-4','phone-screen-5','phone-screen-6',
  'round-1-1','round-1-2','round-1-3','round-1-4','round-1-5'
]);

function customQuestionId(stage: InterviewStageId) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `custom-${stage}-${suffix}`;
}

function sourceIdsFromPlan(plan: unknown) {
  if (!plan || typeof plan !== 'object') return new Set(UNSAVED_STARTER_USED_IDS);
  const sourceIds = new Set<string>();
  const rounds = Array.isArray((plan as { rounds?: unknown }).rounds) ? (plan as { rounds: unknown[] }).rounds : [];
  for (const round of rounds) {
    const questions = round && typeof round === 'object' && Array.isArray((round as { questions?: unknown }).questions)
      ? (round as { questions: unknown[] }).questions
      : [];
    for (const question of questions) {
      const sourceId = question && typeof question === 'object' ? (question as { sourceId?: unknown }).sourceId : null;
      if (typeof sourceId === 'string' && sourceId) sourceIds.add(sourceId);
    }
  }
  return sourceIds;
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
  const [availableAreas, setAvailableAreas] = useState<string[]>([...AREAS_OF_EVALUATION]);
  const [preferences, setPreferences] = useState<AoePreferences>({ hiddenStandardAreas: [], customAreas: [] });
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  const [managingAreas, setManagingAreas] = useState(false);
  const [newCustomArea, setNewCustomArea] = useState('');
  const [savingAreas, setSavingAreas] = useState(false);
  const [loadingBank, setLoadingBank] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const availableQuestions = useMemo(
    () => [...generatedQuestions, ...starterQuestions].filter((question) => !usedIds.has(question.id)),
    [generatedQuestions, starterQuestions, usedIds]
  );

  async function refreshUsedIds() {
    try {
      const response = await fetch(`/api/requisitions/${requisitionId}/interview-plan`, { cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json();
      setUsedIds(sourceIdsFromPlan(result?.plan));
    } catch {
      // Builder events still keep the visible inventory useful if this refresh fails.
    }
  }

  async function savePreferences(next: AoePreferences) {
    setSavingAreas(true);
    setError('');
    try {
      const response = await fetch('/api/aoe-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Unable to save AOE preferences.');
      const saved: AoePreferences = {
        hiddenStandardAreas: Array.isArray(result.hiddenStandardAreas) ? result.hiddenStandardAreas : [],
        customAreas: Array.isArray(result.customAreas) ? result.customAreas : []
      };
      setPreferences(saved);
      setAvailableAreas(Array.isArray(result.activeAreas) ? result.activeAreas : [...AREAS_OF_EVALUATION]);
      setSelectedAreas((current) => current.filter((area) => result.activeAreas?.includes(area)));
      window.dispatchEvent(new CustomEvent(AOE_PREFERENCES_CHANGED_EVENT, { detail: { ...saved, activeAreas: result.activeAreas } }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save AOE preferences.');
    } finally {
      setSavingAreas(false);
    }
  }

  useEffect(() => {
    setStage(initialStage);
  }, [initialStage]);

  useEffect(() => {
    let cancelled = false;
    setLoadingBank(true);
    setError('');
    Promise.all([
      fetch(`/api/requisitions/${requisitionId}/interview-question-bank`, { cache: 'no-store' }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result?.error || 'Unable to load interview questions.');
        return result;
      }),
      fetch(`/api/requisitions/${requisitionId}/interview-plan`, { cache: 'no-store' }).then(async (response) => response.ok ? response.json() : null)
    ])
      .then(([bankResult, planResult]) => {
        if (cancelled) return;
        setStarterQuestions(Array.isArray(bankResult.starterQuestions) ? bankResult.starterQuestions : []);
        setGeneratedQuestions(Array.isArray(bankResult.generatedQuestions) ? bankResult.generatedQuestions : []);
        setUsedIds(sourceIdsFromPlan(planResult?.plan));
        setPreferences(bankResult.aoePreferences || { hiddenStandardAreas: [], customAreas: [] });
        setAvailableAreas(Array.isArray(bankResult.availableAreas) ? bankResult.availableAreas : [...AREAS_OF_EVALUATION]);
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
    let refreshTimer: number | null = null;
    function syncContext(event: Event) {
      const detail = (event as CustomEvent<InterviewBuilderContextDetail>).detail;
      if (detail?.stage) setStage(detail.stage);
    }
    function syncUsed(event: Event) {
      const detail = (event as CustomEvent<InterviewBankUsedDetail>).detail;
      if (detail?.sourceIds) {
        setUsedIds((current) => {
          const next = new Set(current);
          for (const id of detail.sourceIds) next.add(id);
          return next;
        });
      }
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refreshUsedIds(), 750);
    }
    window.addEventListener(INTERVIEW_BUILDER_CONTEXT_EVENT, syncContext);
    window.addEventListener(INTERVIEW_BANK_USED_EVENT, syncUsed);
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      window.removeEventListener(INTERVIEW_BUILDER_CONTEXT_EVENT, syncContext);
      window.removeEventListener(INTERVIEW_BANK_USED_EVENT, syncUsed);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requisitionId]);

  useEffect(() => {
    if (!areaPickerOpen) return;
    function closeOnPointer(event: PointerEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setAreaPickerOpen(false);
        setManagingAreas(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setAreaPickerOpen(false);
        setManagingAreas(false);
      }
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

  function toggleStandardVisibility(area: string) {
    const hidden = preferences.hiddenStandardAreas.includes(area);
    void savePreferences({
      ...preferences,
      hiddenStandardAreas: hidden
        ? preferences.hiddenStandardAreas.filter((item) => item !== area)
        : [...preferences.hiddenStandardAreas, area]
    });
  }

  function addCustomArea() {
    const value = newCustomArea.trim().replace(/\s+/g, ' ');
    if (!value) return;
    if ([...AREAS_OF_EVALUATION, ...preferences.customAreas].some((area) => area.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setError('That Area of Evaluation already exists.');
      return;
    }
    setNewCustomArea('');
    void savePreferences({ ...preferences, customAreas: [...preferences.customAreas, value] });
  }

  function removeCustomArea(area: string) {
    void savePreferences({ ...preferences, customAreas: preferences.customAreas.filter((item) => item !== area) });
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
      setManagingAreas(false);
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
          <div className={styles.panelHeader}>
            <h3>Question Bank</h3>
            <button
              type="button"
              className={styles.headerManageButton}
              onClick={() => {
                if (managingAreas && areaPickerOpen) {
                  setManagingAreas(false);
                  setAreaPickerOpen(false);
                } else {
                  setAreaPickerOpen(true);
                  setManagingAreas(true);
                }
              }}
              aria-pressed={managingAreas && areaPickerOpen}
            >
              Manage AOE
            </button>
          </div>
          <button type="button" className={styles.areaPickerButton} onClick={() => { setManagingAreas(false); setAreaPickerOpen((open) => !open); }} aria-expanded={areaPickerOpen && !managingAreas}>
            {selectedAreas.length ? `AOE (${selectedAreas.length})` : 'AOE (optional)'} ▾
          </button>
          {areaPickerOpen && (
            <div className={styles.areaMenu}>
              {!managingAreas ? (
                <>
                  {availableAreas.map((area) => (
                    <label key={area} className={styles.areaOption}>
                      <input type="checkbox" checked={selectedAreas.includes(area)} onChange={() => toggleSelectedArea(area)} />
                      <span>{area}</span>
                    </label>
                  ))}
                </>
              ) : (
                <div className={styles.manager}>
                  <div className={styles.managerHeading}>
                    <strong>Manage AOE</strong>
                  </div>
                  <p>Standard AOE can be hidden or restored. Custom AOE can be added or removed.</p>
                  <div className={styles.customAdd}>
                    <input value={newCustomArea} maxLength={80} placeholder="Add custom AOE" onChange={(event) => setNewCustomArea(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomArea(); } }} />
                    <button type="button" onClick={addCustomArea} disabled={savingAreas || !newCustomArea.trim()}>Add</button>
                  </div>
                  {preferences.customAreas.length > 0 && (
                    <div className={styles.managerGroup}>
                      <span className={styles.managerLabel}>Custom</span>
                      {preferences.customAreas.map((area) => (
                        <div className={styles.managerRow} key={area}><span>{area}</span><button type="button" onClick={() => removeCustomArea(area)} disabled={savingAreas}>Remove</button></div>
                      ))}
                    </div>
                  )}
                  <div className={styles.managerGroup}>
                    <span className={styles.managerLabel}>Standard</span>
                    {AREAS_OF_EVALUATION.map((area) => {
                      const hidden = preferences.hiddenStandardAreas.includes(area);
                      return <div className={`${styles.managerRow} ${hidden ? styles.hiddenArea : ''}`} key={area}><span>{area}</span><button type="button" onClick={() => toggleStandardVisibility(area)} disabled={savingAreas}>{hidden ? 'Restore' : 'Hide'}</button></div>;
                    })}
                  </div>
                </div>
              )}
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
          <div key={question.id} className={styles.question} draggable onDragStart={(event) => startDrag(event, question)} onDragEnd={() => window.setTimeout(() => void refreshUsedIds(), 750)}>
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