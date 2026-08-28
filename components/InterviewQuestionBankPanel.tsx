'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { AREAS_OF_EVALUATION, type BankQuestion, type InterviewStageId } from '@/lib/interviewQuestionBank';
import { PHONE_SCREEN_BANK_QUESTIONS, PHONE_SCREEN_QUESTION_TYPES, type PhoneScreenResponseKind, type PhoneScreenResponseSpec } from '@/lib/phoneScreenQuestions';
import { AOE_PREFERENCES_CHANGED_EVENT, type AoePreferences } from '@/lib/aoePreferences';
import { INTERVIEW_QUESTION_TYPES, type InterviewQuestionType } from '@/lib/interviewQuestionTypes';
import {
  INTERVIEW_BANK_DRAG_MIME,
  INTERVIEW_BANK_USED_EVENT,
  INTERVIEW_BUILDER_CONTEXT_EVENT,
  type InterviewBankUsedDetail,
  type InterviewBuilderContextDetail
} from '@/lib/interviewQuestionBankEvents';
import styles from './InterviewQuestionBankPanel.module.css';

type AvailableQuestion = { id: string; text: string; areas: string[]; questionType: string; cardTitle: string; response?: PhoneScreenResponseSpec };
type JsonRecord = Record<string, unknown>;
type QuestionGroup<T> = { type: string; questions: T[] };

// Short badge copy for each response kind, shown on Phone Screen bank
// items so a recruiter can see the intended response format before
// dragging a question onto the form.
const RESPONSE_KIND_LABELS: Record<PhoneScreenResponseKind, string> = {
  'yes-no': 'Yes / No',
  'yes-no-needs-discussion': 'Yes / No / Needs discussion',
  'single-choice': 'Single choice',
  numeric: 'Numeric',
  'short-answer': 'Short answer'
};

// The canonical section order for the Structured Interview side of the
// Question Bank: the app's existing generated Question Type vocabulary,
// then Custom, then General (the fallback bucket for a reloaded
// generated question whose original type wasn't persisted - see
// loadPersistedQuestions in the interview-question-bank route).
const STRUCTURED_QUESTION_TYPE_ORDER: readonly string[] = [...INTERVIEW_QUESTION_TYPES, 'Custom', 'General'];

// Groups questions into Question-Type sections in a stable, canonical
// order (not first-seen order, so sections don't reshuffle as
// questions are used/returned) - any type absent from `order` (should
// not normally happen) still surfaces, appended at the end, rather than
// silently dropping questions from the bank.
function groupByType<T extends { questionType: string }>(questions: T[], order: readonly string[]): QuestionGroup<T>[] {
  const byType = new Map<string, T[]>();
  for (const question of questions) {
    const list = byType.get(question.questionType) ?? [];
    list.push(question);
    byType.set(question.questionType, list);
  }
  const groups: QuestionGroup<T>[] = [];
  for (const type of order) {
    const list = byType.get(type);
    if (list && list.length > 0) groups.push({ type, questions: list });
  }
  for (const [type, list] of byType) {
    if (!order.includes(type) && list.length > 0) groups.push({ type, questions: list });
  }
  return groups;
}

function typeSectionLabel(type: string) {
  return type === 'Custom' ? 'Custom Questions' : type;
}

const UNSAVED_STARTER_USED_IDS = new Set([
  'phone-screen-default-1','phone-screen-default-2','phone-screen-default-3','phone-screen-default-4','phone-screen-default-5','phone-screen-default-6',
  'round-1-1','round-1-2','round-1-3','round-1-4','round-1-5'
]);

async function readJson(response: Response, fallbackMessage: string): Promise<JsonRecord> {
  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error(response.ok ? fallbackMessage : `${fallbackMessage} Please try again.`);
  }
  try {
    return JSON.parse(raw) as JsonRecord;
  } catch {
    throw new Error(fallbackMessage);
  }
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
  const [selectedQuestionType, setSelectedQuestionType] = useState<InterviewQuestionType | ''>('');
  const [availableAreas, setAvailableAreas] = useState<string[]>([...AREAS_OF_EVALUATION]);
  const [preferences, setPreferences] = useState<AoePreferences>({ hiddenStandardAreas: [], customAreas: [] });
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  const [managingAreas, setManagingAreas] = useState(false);
  const [newCustomArea, setNewCustomArea] = useState('');
  const [savingAreas, setSavingAreas] = useState(false);
  const [loadingBank, setLoadingBank] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  // Collapsed Question Type sections, by section label - starts empty
  // (every section expanded). This groups the Question Bank only; the
  // selected form's own question order is never regrouped.
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(() => new Set());
  const pickerRef = useRef<HTMLDivElement | null>(null);

  function toggleTypeCollapsed(type: string) {
    setCollapsedTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  const availableQuestions = useMemo(
    () => [...generatedQuestions, ...starterQuestions].filter((question) => !usedIds.has(question.id)),
    [generatedQuestions, starterQuestions, usedIds]
  );
  // Phone Screen's bank is a fixed, curated list of screening questions
  // (not AI-generated, no Areas of Evaluation) - it reuses the exact
  // same usedIds tracking as the Structured Interview bank above, just
  // sourced from a different, stage-specific list instead of the
  // generator's fetched/generated pools.
  const isPhoneScreen = stage === 'phone-screen';
  // The stage's own name and canonical explainer are now shown in the
  // full-width stage bar (InterviewPlan.tsx) instead of being repeated
  // here - this panel is reserved for Question Bank functionality and
  // begins directly with its own heading below.
  const availablePhoneScreenQuestions = useMemo<AvailableQuestion[]>(
    () => PHONE_SCREEN_BANK_QUESTIONS
      .filter((question) => !usedIds.has(question.id))
      .map((question) => ({ id: question.id, text: question.text, areas: [], response: question.response, questionType: question.questionType, cardTitle: question.cardTitle })),
    [usedIds]
  );
  const phoneScreenGroups = useMemo(
    () => groupByType(availablePhoneScreenQuestions, PHONE_SCREEN_QUESTION_TYPES),
    [availablePhoneScreenQuestions]
  );
  const structuredGroups = useMemo(
    () => groupByType(availableQuestions, STRUCTURED_QUESTION_TYPE_ORDER),
    [availableQuestions]
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
      const result = await readJson(response, 'Unable to save AOE preferences.');
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Unable to save AOE preferences.');
      const activeAreas = Array.isArray(result.activeAreas) ? result.activeAreas.map(String) : [...AREAS_OF_EVALUATION];
      const saved: AoePreferences = {
        hiddenStandardAreas: Array.isArray(result.hiddenStandardAreas) ? result.hiddenStandardAreas.map(String) : [],
        customAreas: Array.isArray(result.customAreas) ? result.customAreas.map(String) : []
      };
      setPreferences(saved);
      setAvailableAreas(activeAreas);
      setSelectedAreas((current) => current.filter((area) => activeAreas.includes(area)));
      window.dispatchEvent(new CustomEvent(AOE_PREFERENCES_CHANGED_EVENT, { detail: { ...saved, activeAreas } }));
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
        const result = await readJson(response, 'Unable to load interview questions.');
        if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Unable to load interview questions.');
        return result;
      }),
      fetch(`/api/requisitions/${requisitionId}/interview-plan`, { cache: 'no-store' }).then(async (response) => response.ok ? response.json() : null)
    ])
      .then(([bankResult, planResult]) => {
        if (cancelled) return;
        setStarterQuestions(Array.isArray(bankResult.starterQuestions) ? bankResult.starterQuestions as AvailableQuestion[] : []);
        setGeneratedQuestions(Array.isArray(bankResult.generatedQuestions) ? bankResult.generatedQuestions as AvailableQuestion[] : []);
        setUsedIds(sourceIdsFromPlan(planResult?.plan));
        setPreferences(bankResult.aoePreferences && typeof bankResult.aoePreferences === 'object' ? bankResult.aoePreferences as AoePreferences : { hiddenStandardAreas: [], customAreas: [] });
        setAvailableAreas(Array.isArray(bankResult.availableAreas) ? bankResult.availableAreas.map(String) : [...AREAS_OF_EVALUATION]);
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

  function writeDragData(event: DragEvent<HTMLDivElement>, question: BankQuestion) {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(INTERVIEW_BANK_DRAG_MIME, JSON.stringify(question));
    event.dataTransfer.setData('text/plain', question.text);
  }

  function startDrag(event: DragEvent<HTMLDivElement>, question: AvailableQuestion) {
    writeDragData(event, asBankQuestion(question));
  }

  function startBlankDrag(event: DragEvent<HTMLDivElement>) {
    const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
    writeDragData(event, {
      id: `custom-${stage}-${suffix}`,
      stage,
      text: '',
      areas: [],
      questionType: 'Custom',
      cardTitle: 'Custom Question',
      ...(isPhoneScreen ? { response: { kind: 'short-answer' } as PhoneScreenResponseSpec } : {})
    });
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
        body: JSON.stringify({ selectedAreas, questionType: selectedQuestionType || null })
      });
      const result = await readJson(response, 'Unable to generate interview questions.');
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Unable to generate interview questions.');
      const rawQuestions = Array.isArray(result.questions) ? result.questions as Array<{ id: string; text: string; areas: string[] }> : [];
      if (rawQuestions.length !== 5) throw new Error('Unable to generate five interview questions. No QC was used.');
      // The generator itself only returns text/areas per question - the
      // recruiter's selected Question Type for this batch is attached
      // here, client-side, at the moment of generation. It is not sent
      // to or stored by the question-bank RPC (no migration this pass),
      // so it only survives for the remainder of this session; a
      // reloaded generated question falls back to "General" (see
      // loadPersistedQuestions in the interview-question-bank route).
      const batchType = selectedQuestionType || 'General';
      const questions: AvailableQuestion[] = rawQuestions.map((question) => ({ ...question, questionType: batchType, cardTitle: batchType }));
      setGeneratedQuestions((current) => [...questions, ...current]);
      setSelectedAreas([]);
      setSelectedQuestionType('');
      setAreaPickerOpen(false);
      setManagingAreas(false);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Unable to generate interview questions.');
    } finally {
      setGenerating(false);
    }
  }

  if (isPhoneScreen) {
    return (
      <div className={styles.panel}>
        <div className={styles.generator}>
          <div className={styles.panelHeader}>
            <h3>Question Bank <span className={styles.bankCount}>{availablePhoneScreenQuestions.length}</span></h3>
          </div>
          <p className={styles.workflowHint}>Curated screening questions for Phone Screen — no Areas of Evaluation or generation needed. Drag a question onto the form, or write your own.</p>
        </div>

        <div className={styles.list}>
          <div className={`${styles.question} ${styles.wildcard}`} draggable onDragStart={startBlankDrag}>
            <div className={styles.questionTop}>
              <span className={styles.drag} aria-hidden="true">⠿</span>
              <div>
                <p>Create Your Own Question</p>
                <span className={styles.wildcardCopy}>Drag this onto the Phone Screen, then write your question and choose its response type.</span>
              </div>
            </div>
          </div>

          {phoneScreenGroups.map((group) => {
            const collapsed = collapsedTypes.has(group.type);
            return (
              <div className={styles.typeSection} key={group.type}>
                <button type="button" className={styles.typeSectionHeader} onClick={() => toggleTypeCollapsed(group.type)} aria-expanded={!collapsed}>
                  <span className={styles.typeSectionName}>{typeSectionLabel(group.type)} <span className={styles.bankCount}>{group.questions.length}</span></span>
                  <span className={styles.typeSectionChevron} aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                </button>
                {!collapsed && group.questions.map((question) => (
                  <div key={question.id} className={styles.question} draggable onDragStart={(event) => startDrag(event, question)} onDragEnd={() => window.setTimeout(() => void refreshUsedIds(), 750)}>
                    <div className={styles.questionTop}>
                      <span className={styles.drag} aria-hidden="true">⠿</span>
                      <div className={styles.questionBody}>
                        <p className={styles.cardTitle}>{question.cardTitle}</p>
                        <p>{question.text}</p>
                      </div>
                    </div>
                    {question.response && (
                      <div className={styles.chips}>
                        <span>{RESPONSE_KIND_LABELS[question.response.kind]}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          {availablePhoneScreenQuestions.length === 0 && <p className={styles.empty}>All screening questions are currently on the form.</p>}
        </div>

        <div className={styles.footer}>Drag questions onto the Phone Screen. Used questions disappear from the bank and return if removed.</div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.generator}>
        <div className={styles.areaPicker} ref={pickerRef}>
          <div className={styles.panelHeader}>
            <h3>Question Bank <span className={styles.bankCount}>{availableQuestions.length}</span></h3>
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
          <p className={styles.workflowHint}>Choose a type or Area of Evaluation to generate targeted questions, then add the questions you want to the interview.</p>

          <div className={styles.selectWrap}>
            <select
              className={styles.questionTypeSelect}
              value={selectedQuestionType}
              onChange={(event) => setSelectedQuestionType(event.target.value as InterviewQuestionType | '')}
              aria-label="Question Type"
            >
              <option value="">Choose a question type</option>
              {INTERVIEW_QUESTION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <span className={styles.dropdownChevron} aria-hidden="true">▾</span>
          </div>

          <button type="button" className={styles.areaPickerButton} onClick={() => { setManagingAreas(false); setAreaPickerOpen((open) => !open); }} aria-expanded={areaPickerOpen && !managingAreas}>
            <span>{selectedAreas.length ? `AOE (${selectedAreas.length})` : 'Choose an Area of Evaluation (optional)'}</span>
            <span className={styles.dropdownChevron} aria-hidden="true">▾</span>
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

        {selectedAreas.length > 0 && (
          <div className={styles.chips}>
            {selectedAreas.map((area) => <span key={area}>{area}</span>)}
          </div>
        )}
        <button type="button" className={styles.generateButton} onClick={generateMore} disabled={generating}>
          {generating ? 'Generating…' : 'Generate 5 Questions · Uses 1 QC'}
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>

      <div className={styles.list}>
        <div className={`${styles.question} ${styles.wildcard}`} draggable onDragStart={startBlankDrag}>
          <div className={styles.questionTop}>
            <span className={styles.drag} aria-hidden="true">⠿</span>
            <div>
              <p>Create Your Own Question</p>
              <span className={styles.wildcardCopy}>Drag this into the interview, then add your question and select its Areas of Evaluation.</span>
            </div>
          </div>
        </div>

        {loadingBank && <p className={styles.empty}>Loading questions…</p>}
        {!loadingBank && structuredGroups.map((group) => {
          const collapsed = collapsedTypes.has(group.type);
          return (
            <div className={styles.typeSection} key={group.type}>
              <button type="button" className={styles.typeSectionHeader} onClick={() => toggleTypeCollapsed(group.type)} aria-expanded={!collapsed}>
                <span className={styles.typeSectionName}>{typeSectionLabel(group.type)} <span className={styles.bankCount}>{group.questions.length}</span></span>
                <span className={styles.typeSectionChevron} aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
              </button>
              {!collapsed && group.questions.map((question) => (
                <div key={question.id} className={styles.question} draggable onDragStart={(event) => startDrag(event, question)} onDragEnd={() => window.setTimeout(() => void refreshUsedIds(), 750)}>
                  <div className={styles.questionTop}>
                    <span className={styles.drag} aria-hidden="true">⠿</span>
                    <div className={styles.questionBody}>
                      <p className={styles.cardTitle}>{question.cardTitle}</p>
                      <p>{question.text}</p>
                    </div>
                  </div>
                  <div className={styles.chips}>
                    {question.areas.map((area) => <span key={area}>{area}</span>)}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        {!loadingBank && availableQuestions.length === 0 && <p className={styles.empty}>All available questions are currently in use.</p>}
      </div>

      <div className={styles.footer}>Drag questions into an interview. Used questions disappear from the bank and return if removed.</div>
    </div>
  );
}
