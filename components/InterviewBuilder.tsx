'use client';

import { useMemo, useState, type DragEvent } from 'react';
import styles from './InterviewBuilder.module.css';

const AREAS_OF_EVALUATION = [
  'Adaptability','Budget','Communication','Computer Skills','Conflict Management','Customer Service','Decision Making','Dependability','Employee Development','Employee Management','Ethics','Initiative','Innovation','Interpersonal Skills','Job Knowledge','Leadership','Organizational Skills','Problem Solving','Product Expertise','Productivity','Project Management','Quality','Results Driven','Sales Goals','Sales Skills','Self-Development','Sense of Urgency','Strategic Thought','Teamwork','Technical Skills'
] as const;

type StageId = 'phone-screen' | 'round-1' | 'round-2' | 'final';
type Question = { id: string; text: string; areas: string[] };

const STAGES: { id: StageId; label: string; description: string }[] = [
  { id: 'phone-screen', label: 'Phone Screen', description: 'Confirm baseline fit, motivation, communication, availability, and obvious gaps before a formal interview.' },
  { id: 'round-1', label: 'Interview — Round 1', description: 'Explore core duties, job knowledge, transferable experience, and behavioral evidence tied to the requisition.' },
  { id: 'round-2', label: 'Interview — Round 2', description: 'Probe judgment, collaboration, leadership, problem solving, and deeper scenario-based evidence.' },
  { id: 'final', label: 'Final Interview', description: 'Validate readiness, decision quality, role ownership, expectations, and remaining risk before a hiring decision.' }
];

function id() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function suggestedQuestions(stage: StageId, positionTitle: string): Question[] {
  const sets: Record<StageId, Omit<Question, 'id'>[]> = {
    'phone-screen': [
      { text: `What drew your attention to the ${positionTitle} role as a potential next step?`, areas: ['Communication', 'Job Knowledge'] },
      { text: 'Tell me about the experience in your background that feels most relevant to the day-to-day duties of this role.', areas: ['Job Knowledge', 'Communication'] },
      { text: 'How do you typically keep track of important issues, deadlines, or updates during your work?', areas: ['Organizational Skills', 'Dependability'] },
      { text: 'Tell me about a time a customer or coworker came to you with a difficult problem. What did you do?', areas: ['Customer Service', 'Problem Solving', 'Interpersonal Skills'] }
    ],
    'round-1': [
      { text: 'Walk us through a recent responsibility that is similar to one of the core duties of this role. What was your personal contribution?', areas: ['Job Knowledge', 'Results Driven'] },
      { text: 'Tell us about a time you had to learn a new process, system, or body of information quickly.', areas: ['Adaptability', 'Computer Skills', 'Self-Development'] },
      { text: 'Describe a situation where you had to work with another team or partner to solve a problem.', areas: ['Teamwork', 'Communication', 'Problem Solving'] },
      { text: 'Tell us about a time you noticed a quality or service issue before someone asked you to address it.', areas: ['Initiative', 'Quality', 'Sense of Urgency'] },
      { text: 'How do you decide what needs your attention first when several important tasks compete at the same time?', areas: ['Decision Making', 'Organizational Skills', 'Productivity'] }
    ],
    'round-2': [
      { text: 'Tell us about a decision you made when the available information was incomplete. How did you work through it?', areas: ['Decision Making', 'Problem Solving', 'Strategic Thought'] },
      { text: 'Describe a disagreement with a colleague or stakeholder that you had to work through without damaging the relationship.', areas: ['Conflict Management', 'Communication', 'Interpersonal Skills'] },
      { text: 'Give us an example of a time you had to balance speed, quality, and competing expectations.', areas: ['Quality', 'Results Driven', 'Sense of Urgency'] },
      { text: 'Tell us about a time you guided, supported, or influenced someone even when you were not their formal supervisor.', areas: ['Leadership', 'Employee Development', 'Teamwork'] },
      { text: 'What is an example of a process you improved, and how did you know the change was working?', areas: ['Innovation', 'Project Management', 'Results Driven'] }
    ],
    'final': [
      { text: `What would success in the ${positionTitle} role look like to you after the first six months?`, areas: ['Job Knowledge', 'Results Driven', 'Strategic Thought'] },
      { text: 'Tell us about a professional judgment call you would handle differently today and what changed your thinking.', areas: ['Decision Making', 'Self-Development', 'Ethics'] },
      { text: 'Describe the working environment and leadership style that consistently brings out your best work.', areas: ['Interpersonal Skills', 'Dependability', 'Teamwork'] },
      { text: 'What responsibility in this role do you expect to be the biggest stretch, and how would you prepare for it?', areas: ['Adaptability', 'Self-Development', 'Job Knowledge'] }
    ]
  };
  return sets[stage].map((question) => ({ ...question, id: id() }));
}

export function InterviewBuilder({ positionTitle, hasJobDescription }: { positionTitle: string; hasJobDescription: boolean }) {
  const [stage, setStage] = useState<StageId>('phone-screen');
  const [title, setTitle] = useState(`Phone Screen — ${positionTitle}`);
  const [summary, setSummary] = useState('A structured interview round for evaluating candidates consistently against the requisition.');
  const [questions, setQuestions] = useState<Question[]>(() => suggestedQuestions('phone-screen', positionTitle));
  const [openAreaId, setOpenAreaId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(() => null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const stageConfig = STAGES.find((item) => item.id === stage)!;
  const previewQuestion = questions.find((question) => question.id === previewId) || questions[0] || null;
  const coveredAreas = useMemo(() => new Set(questions.flatMap((question) => question.areas)).size, [questions]);

  function changeStage(nextStage: StageId) {
    setStage(nextStage);
    const next = STAGES.find((item) => item.id === nextStage)!;
    setTitle(`${next.label} — ${positionTitle}`);
    setStatus('Stage changed. Generate from JD to refresh the suggested questions for this stage.');
  }

  function generateQuestions() {
    setQuestions(suggestedQuestions(stage, positionTitle));
    setPreviewId(null);
    setOpenAreaId(null);
    setStatus(`Suggested ${stageConfig.label} questions refreshed from the requisition context for this UI preview.`);
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

  function addQuestion() {
    const next: Question = { id: id(), text: 'Add a new interview question…', areas: [] };
    setQuestions((current) => [...current, next]);
    setPreviewId(next.id);
  }

  function removeQuestion(questionId: string) {
    setQuestions((current) => current.filter((question) => question.id !== questionId));
    if (previewId === questionId) setPreviewId(null);
    if (openAreaId === questionId) setOpenAreaId(null);
  }

  function dropQuestion(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    setQuestions((current) => {
      const source = current.find((question) => question.id === draggedId);
      const targetIndex = current.findIndex((question) => question.id === targetId);
      if (!source || targetIndex < 0) return current;
      const next = current.filter((question) => question.id !== draggedId);
      next.splice(targetIndex, 0, source);
      return next;
    });
    setDraggedId(null);
    setDropTargetId(null);
  }

  function dragStart(event: DragEvent<HTMLElement>, questionId: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', questionId);
    setDraggedId(questionId);
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
            <strong>AI question source · Job Description + Hiring Criteria</strong>
            <span>{stageConfig.description}</span>
          </div>
          <button type="button" className={styles.generateButton} onClick={generateQuestions} disabled={!hasJobDescription} title={hasJobDescription ? 'Refresh stage-specific question suggestions' : 'This requisition does not have a job description yet'}>
            Generate from JD
          </button>
        </div>
        {status && <p className={styles.status}>{status}</p>}
      </div>

      <div className={styles.builderGrid}>
        <div className={`card ${styles.questionsCard}`}>
          <div className={styles.questionsHeader}>
            <div>
              <span className="eyebrow">Interview questions</span>
              <h2>Build the instrument</h2>
            </div>
            <div className={styles.metrics} aria-label="Interview metrics">
              <span className={styles.metric}>{questions.length} Questions</span>
              <span className={styles.metric}>{coveredAreas} Areas Evaluated</span>
              <span className={styles.metric}>1–5 Star Rating</span>
            </div>
          </div>

          <div className={styles.questionList}>
            {questions.map((question, index) => {
              const maxed = question.areas.length >= 4;
              return (
                <div
                  key={question.id}
                  className={`${styles.questionCard} ${previewQuestion?.id === question.id ? styles.active : ''} ${dropTargetId === question.id ? styles.dropTarget : ''}`}
                  onClick={() => setPreviewId(question.id)}
                  onDragOver={(event) => {
                    if (!draggedId || draggedId === question.id) return;
                    event.preventDefault();
                    setDropTargetId(question.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropQuestion(question.id);
                  }}
                >
                  <span
                    className={styles.dragHandle}
                    draggable
                    title="Drag to reorder"
                    aria-label={`Drag question ${index + 1} to reorder`}
                    onClick={(event) => event.stopPropagation()}
                    onDragStart={(event) => dragStart(event, question.id)}
                    onDragEnd={() => { setDraggedId(null); setDropTargetId(null); }}
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
                    <div className={styles.areaHint}>AI maps the question to related evaluation areas. Keep or adjust up to four.</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.questionActions}>
            <button type="button" className={styles.addQuestion} onClick={addQuestion}>+ Add Question</button>
          </div>
        </div>

        <aside className={`card ${styles.preview}`} aria-label="Participant scorecard preview">
          <span className="eyebrow">Scorecard preview</span>
          <h2>1–5 stars</h2>
          {previewQuestion ? (
            <>
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
            </>
          ) : <p className={styles.previewEmpty}>Add a question to preview the interviewer scoring experience.</p>}
        </aside>
      </div>

      <div className={styles.footer}>
        <span className={styles.footerNote}>Pre-production UI only. AI generation, persistence, invitations, and scoring storage are intentionally not wired yet.</span>
        <button type="button" className={styles.saveButton} disabled title="Saving will be enabled with interview persistence.">Save Interview</button>
      </div>
    </div>
  );
}
