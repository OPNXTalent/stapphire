'use client';

import { useMemo, useState, type DragEvent } from 'react';
import styles from './InterviewBuilder.module.css';

const AREAS_OF_EVALUATION = [
  'Adaptability','Budget','Communication','Computer Skills','Conflict Management','Customer Service','Decision Making','Dependability','Employee Development','Employee Management','Ethics','Initiative','Innovation','Interpersonal Skills','Job Knowledge','Leadership','Organizational Skills','Problem Solving','Product Expertise','Productivity','Project Management','Quality','Results Driven','Sales Goals','Sales Skills','Self-Development','Sense of Urgency','Strategic Thought','Teamwork','Technical Skills'
] as const;

type StageId = 'phone-screen' | 'round-1' | 'round-2' | 'final';
type Question = { id: string; sourceId?: string; text: string; areas: string[] };
type BankQuestion = { id: string; stage: StageId; text: string; areas: string[] };
type DragSource = { type: 'interview' | 'bank'; id: string } | null;

const STAGES: { id: StageId; label: string; shortLabel: string; description: string }[] = [
  { id: 'phone-screen', label: 'Phone Screen', shortLabel: 'Phone Screen', description: 'Confirm baseline fit, motivation, communication, and obvious gaps before a formal interview.' },
  { id: 'round-1', label: 'Interview — Round 1', shortLabel: 'Round 1', description: 'Explore core duties, job knowledge, transferable experience, and behavioral evidence tied to the requisition.' },
  { id: 'round-2', label: 'Interview — Round 2', shortLabel: 'Round 2', description: 'Probe judgment, collaboration, leadership, problem solving, and deeper scenario-based evidence.' },
  { id: 'final', label: 'Final Interview', shortLabel: 'Final', description: 'Validate readiness, decision quality, role ownership, expectations, and remaining risk before a hiring decision.' }
];

function id() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function buildQuestionBank(positionTitle: string): BankQuestion[] {
  const bank: Record<StageId, Omit<BankQuestion, 'id' | 'stage'>[]> = {
    'phone-screen': [
      { text: `What drew your attention to the ${positionTitle} role as a potential next step?`, areas: ['Communication', 'Job Knowledge'] },
      { text: 'Tell me about the experience in your background that feels most relevant to the day-to-day duties of this role.', areas: ['Job Knowledge', 'Communication'] },
      { text: 'How do you typically keep track of important issues, deadlines, or updates during your work?', areas: ['Organizational Skills', 'Dependability'] },
      { text: 'Tell me about a time a customer or coworker came to you with a difficult problem. What did you do?', areas: ['Customer Service', 'Problem Solving', 'Interpersonal Skills'] },
      { text: 'What systems, tools, or processes have you used to keep work moving accurately and on time?', areas: ['Computer Skills', 'Productivity', 'Quality'] },
      { text: 'What would you want us to understand about your background that may not be obvious from your resume?', areas: ['Communication', 'Job Knowledge', 'Self-Development'] }
    ],
    'round-1': [
      { text: 'Walk us through a recent responsibility that is similar to one of the core duties of this role. What was your personal contribution?', areas: ['Job Knowledge', 'Results Driven'] },
      { text: 'Tell us about a time you had to learn a new process, system, or body of information quickly.', areas: ['Adaptability', 'Computer Skills', 'Self-Development'] },
      { text: 'Describe a situation where you had to work with another team or partner to solve a problem.', areas: ['Teamwork', 'Communication', 'Problem Solving'] },
      { text: 'Tell us about a time you noticed a quality or service issue before someone asked you to address it.', areas: ['Initiative', 'Quality', 'Sense of Urgency'] },
      { text: 'How do you decide what needs your attention first when several important tasks compete at the same time?', areas: ['Decision Making', 'Organizational Skills', 'Productivity'] },
      { text: 'Describe a time you had to explain a complicated issue to someone who did not have your level of subject knowledge.', areas: ['Communication', 'Interpersonal Skills', 'Job Knowledge'] }
    ],
    'round-2': [
      { text: 'Tell us about a decision you made when the available information was incomplete. How did you work through it?', areas: ['Decision Making', 'Problem Solving', 'Strategic Thought'] },
      { text: 'Describe a disagreement with a colleague or stakeholder that you had to work through without damaging the relationship.', areas: ['Conflict Management', 'Communication', 'Interpersonal Skills'] },
      { text: 'Give us an example of a time you had to balance speed, quality, and competing expectations.', areas: ['Quality', 'Results Driven', 'Sense of Urgency'] },
      { text: 'Tell us about a time you guided, supported, or influenced someone even when you were not their formal supervisor.', areas: ['Leadership', 'Employee Development', 'Teamwork'] },
      { text: 'What is an example of a process you improved, and how did you know the change was working?', areas: ['Innovation', 'Project Management', 'Results Driven'] },
      { text: 'Describe a situation where the obvious solution was not the best solution. What did you do instead?', areas: ['Problem Solving', 'Decision Making', 'Innovation'] }
    ],
    'final': [
      { text: `What would success in the ${positionTitle} role look like to you after the first six months?`, areas: ['Job Knowledge', 'Results Driven', 'Strategic Thought'] },
      { text: 'Tell us about a professional judgment call you would handle differently today and what changed your thinking.', areas: ['Decision Making', 'Self-Development', 'Ethics'] },
      { text: 'Describe the working environment and leadership style that consistently brings out your best work.', areas: ['Interpersonal Skills', 'Dependability', 'Teamwork'] },
      { text: 'What responsibility in this role do you expect to be the biggest stretch, and how would you prepare for it?', areas: ['Adaptability', 'Self-Development', 'Job Knowledge'] },
      { text: 'If selected, what would you want to understand during your first 30 days before making significant changes?', areas: ['Strategic Thought', 'Job Knowledge', 'Decision Making'] },
      { text: 'What is one professional standard you will not compromise even when the pressure is high?', areas: ['Ethics', 'Quality', 'Dependability'] }
    ]
  };

  return STAGES.flatMap((stage) => bank[stage.id].map((question, index) => ({
    ...question,
    id: `${stage.id}-${index + 1}`,
    stage: stage.id
  })));
}

function cloneFromBank(question: BankQuestion): Question {
  return { id: id(), sourceId: question.id, text: question.text, areas: [...question.areas] };
}

export function InterviewBuilder({ positionTitle, hasJobDescription }: { positionTitle: string; hasJobDescription: boolean }) {
  const questionBank = useMemo(() => buildQuestionBank(positionTitle), [positionTitle]);
  const initialBank = questionBank.filter((question) => question.stage === 'phone-screen');
  const [stage, setStage] = useState<StageId>('phone-screen');
  const [bankStage, setBankStage] = useState<StageId>('phone-screen');
  const [title, setTitle] = useState(`Phone Screen — ${positionTitle}`);
  const [summary, setSummary] = useState('A structured interview round for evaluating candidates consistently against the requisition.');
  const [questions, setQuestions] = useState<Question[]>(() => initialBank.slice(0, 3).map(cloneFromBank));
  const [openAreaId, setOpenAreaId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(() => null);
  const [dragSource, setDragSource] = useState<DragSource>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const stageConfig = STAGES.find((item) => item.id === stage)!;
  const bankQuestions = questionBank.filter((question) => question.stage === bankStage);
  const previewQuestion = questions.find((question) => question.id === previewId) || questions[0] || null;
  const coveredAreas = useMemo(() => new Set(questions.flatMap((question) => question.areas)).size, [questions]);
  const usedSourceIds = useMemo(() => new Set(questions.map((question) => question.sourceId).filter(Boolean)), [questions]);

  function changeStage(nextStage: StageId) {
    setStage(nextStage);
    setBankStage(nextStage);
    const next = STAGES.find((item) => item.id === nextStage)!;
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
    if (usedSourceIds.has(source.id)) return;
    const next = cloneFromBank(source);
    setQuestions((current) => {
      if (!targetId) return [...current, next];
      const targetIndex = current.findIndex((question) => question.id === targetId);
      if (targetIndex < 0) return [...current, next];
      const result = [...current];
      result.splice(targetIndex, 0, next);
      return result;
    });
    setPreviewId(next.id);
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

  function dropOnQuestion(targetId: string) {
    if (!dragSource) return;
    if (dragSource.type === 'interview') reorderQuestion(dragSource.id, targetId);
    if (dragSource.type === 'bank') {
      const source = questionBank.find((question) => question.id === dragSource.id);
      if (source) addBankQuestion(source, targetId);
    }
    setDragSource(null);
    setDropTargetId(null);
  }

  function dropAtEnd() {
    if (!dragSource || dragSource.type !== 'bank') return;
    const source = questionBank.find((question) => question.id === dragSource.id);
    if (source) addBankQuestion(source);
    setDragSource(null);
    setDropTargetId(null);
  }

  function startDrag(event: DragEvent<HTMLElement>, source: NonNullable<DragSource>) {
    event.dataTransfer.effectAllowed = source.type === 'bank' ? 'copy' : 'move';
    event.dataTransfer.setData('text/plain', source.id);
    setDragSource(source);
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
            <select id="interview-stage" value={stage} onChange={(event) => changeStage(event.target.value as StageId)}>
              {STAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
        </div>

        <div className={styles.field} style={{ marginTop: 14 }}>
          <label htmlFor="interview-summary">Interview plan summary</label>
          <textarea id="interview-summary" rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} />
        </div>

        <div className={styles.sourceNote}>
          <div className={styles.sourceCopy}>
            <strong>Question Bank · generated from this requisition</strong>
            <span>{hasJobDescription ? 'Stapphire generates the bank when the JD is uploaded or replaced, using the JD + Hiring Criteria. Questions arrive with suggested Areas of Evaluation.' : 'Add a Job Description to this requisition to generate its Question Bank.'}</span>
          </div>
          <span className={`${styles.bankState} ${hasJobDescription ? styles.ready : ''}`}>{hasJobDescription ? 'BANK READY' : 'JD REQUIRED'}</span>
        </div>
      </div>

      <div className={styles.builderGrid}>
        <div className={styles.mainColumn}>
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

            <div
              className={`${styles.questionList} ${dragSource?.type === 'bank' ? styles.bankDragActive : ''}`}
              onDragOver={(event) => { if (dragSource?.type === 'bank') event.preventDefault(); }}
              onDrop={(event) => { event.preventDefault(); dropAtEnd(); }}
            >
              {questions.map((question, index) => {
                const maxed = question.areas.length >= 4;
                return (
                  <div
                    key={question.id}
                    className={`${styles.questionCard} ${previewQuestion?.id === question.id ? styles.active : ''} ${dropTargetId === question.id ? styles.dropTarget : ''}`}
                    onClick={() => setPreviewId(question.id)}
                    onDragOver={(event) => {
                      if (!dragSource || (dragSource.type === 'interview' && dragSource.id === question.id)) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setDropTargetId(question.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      dropOnQuestion(question.id);
                    }}
                  >
                    <span
                      className={styles.dragHandle}
                      draggable
                      title="Drag to reorder"
                      aria-label={`Drag question ${index + 1} to reorder`}
                      onClick={(event) => event.stopPropagation()}
                      onDragStart={(event) => startDrag(event, { type: 'interview', id: question.id })}
                      onDragEnd={() => { setDragSource(null); setDropTargetId(null); }}
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
                      <div className={styles.areaHint}>Suggested by Stapphire from the question. Keep or adjust up to four.</div>
                    </div>
                  </div>
                );
              })}
              {dragSource?.type === 'bank' && <div className={styles.dropEnd}>Drop here to add to the interview</div>}
            </div>

            <div className={styles.questionActions}>
              <button type="button" className={styles.addQuestion} onClick={addManualQuestion}>+ Add Manual Question</button>
              <span>Drag Question Bank items into the interview to add them.</span>
            </div>
          </div>

          <div className={`card ${styles.preview}`} aria-label="Participant scorecard preview">
            <div className={styles.previewHeader}>
              <div><span className="eyebrow">Scorecard preview</span><h2>1–5 stars</h2></div>
              <span className={styles.previewHint}>Interviewers rate the mapped Areas, not the question itself.</span>
            </div>
            {previewQuestion ? (
              <div className={styles.previewGrid}>
                <div className={styles.previewQuestion}>{previewQuestion.text}</div>
                {previewQuestion.areas.length ? (
                  <div className={styles.ratingList}>
                    {previewQuestion.areas.map((area) => (
                      <div className={styles.ratingRow} key={area}>
                        <span className={styles.ratingArea}>{area}</span>
                        <div className={styles.stars} aria-label={`${area}: five-star rating scale`}>
                          {[1,2,3,4,5].map((star) => <button key={star} type="button" className={styles.star} tabIndex={-1} aria-hidden="true">☆</button>)}
                        </div>
                        <div className={styles.scale}><span>1 · Low</span><span>5 · High</span></div>
                      </div>
                    ))}
                  </div>
                ) : <p className={styles.previewEmpty}>Choose one or more Areas of Evaluation to define what the interviewer will rate.</p>}
              </div>
            ) : <p className={styles.previewEmpty}>Add a question to preview the interviewer scoring experience.</p>}
          </div>
        </div>

        <aside className={`card ${styles.questionBank}`} aria-label="Question Bank">
          <div className={styles.bankHeader}>
            <span className="eyebrow">Question Bank</span>
            <h2>JD-generated questions</h2>
            <p>Generated automatically when the JD is uploaded. Each question carries Stapphire's suggested Areas of Evaluation.</p>
          </div>

          <div className={styles.bankTabs} role="tablist" aria-label="Question Bank stage">
            {STAGES.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={bankStage === item.id} className={bankStage === item.id ? styles.bankTabActive : ''} onClick={() => setBankStage(item.id)}>{item.shortLabel}</button>
            ))}
          </div>

          <div className={styles.bankList}>
            {hasJobDescription ? bankQuestions.map((question) => {
              const added = usedSourceIds.has(question.id);
              return (
                <div
                  key={question.id}
                  className={`${styles.bankQuestion} ${added ? styles.bankQuestionAdded : ''}`}
                  draggable={!added}
                  onDragStart={(event) => startDrag(event, { type: 'bank', id: question.id })}
                  onDragEnd={() => { setDragSource(null); setDropTargetId(null); }}
                >
                  <div className={styles.bankQuestionText}>{question.text}</div>
                  <div className={styles.bankAreas}>{question.areas.map((area) => <span key={area}>{area}</span>)}</div>
                  <div className={styles.bankQuestionFooter}>
                    <span>{added ? 'In this interview' : 'Drag into interview'}</span>
                    <button type="button" disabled={added} onClick={() => addBankQuestion(question)}>{added ? 'Added' : '+ Add'}</button>
                  </div>
                </div>
              );
            }) : <p className={styles.bankEmpty}>This requisition needs a Job Description before a Question Bank can be generated.</p>}
          </div>
        </aside>
      </div>

      <div className={styles.footer}>
        <span className={styles.footerNote}>Pre-production UI only. Question Bank generation is represented as already completed at JD upload; persistence, invitations, and scoring storage are not wired yet.</span>
        <button type="button" className={styles.saveButton} disabled title="Saving will be enabled with interview persistence.">Save Interview</button>
      </div>
    </div>
  );
}
