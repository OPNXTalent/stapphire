'use client';

import { useMemo, useState } from 'react';
import { buildQuestionBank, INTERVIEW_STAGES, type InterviewStageId } from '@/lib/interviewQuestionBank';
import { StapphireBrand } from '@/components/StapphireBrand';
import styles from './ParticipantInterviewPreview.module.css';

export function ParticipantInterviewPreview({
  stage,
  candidateName,
  positionTitle
}: {
  stage: InterviewStageId;
  candidateName: string;
  positionTitle: string;
}) {
  const questions = useMemo(() => buildQuestionBank(positionTitle).filter((question) => question.stage === stage), [positionTitle, stage]);
  const stageLabel = INTERVIEW_STAGES.find((item) => item.id === stage)?.label || 'Interview';
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [shareStatus, setShareStatus] = useState('');
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(questions[0]?.id ?? null);

  const ratingCount = questions.reduce((sum, question) => sum + question.areas.length, 0);
  const completedCount = Object.keys(ratings).length;

  function setRating(questionId: string, area: string, value: number) {
    setRatings((current) => ({ ...current, [`${questionId}:${area}`]: value }));
  }

  function questionProgress(questionId: string, areas: string[]) {
    const rated = areas.filter((area) => ratings[`${questionId}:${area}`]).length;
    if (rated === 0) return { rated, label: 'Not Rated' };
    if (rated === areas.length) return { rated, label: 'Complete' };
    return { rated, label: 'In Progress' };
  }

  async function shareInterview() {
    const url = window.location.href;
    const title = `${stageLabel} — ${positionTitle}`;
    const text = `You're invited to participate in the ${stageLabel} for ${candidateName}.`;

    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        setShareStatus('Shared');
      } else {
        await navigator.clipboard.writeText(url);
        setShareStatus('Link copied');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(url);
        setShareStatus('Link copied');
      } catch {
        setShareStatus('Unable to share');
      }
    }

    window.setTimeout(() => setShareStatus(''), 2200);
  }

  if (submitted) {
    return (
      <div className={styles.page}>
        <div className={styles.brand}><StapphireBrand decorative /></div>
        <section className={styles.submitted}>
          <span className={styles.eyebrow}>Interview submitted</span>
          <h1>Thank you.</h1>
          <p>Your pre-production interview form has been completed. In the wired version, this submission will contribute to the candidate's aggregate interview result.</p>
          <span className={styles.preview}>PRE-PRODUCTION PREVIEW · NOTHING WAS SAVED</span>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.brand}><StapphireBrand decorative /></div>
          <div className={styles.shareWrap}>
            <button type="button" className={styles.shareButton} onClick={shareInterview} aria-label="Share interview invitation">
              <span aria-hidden="true">↗</span>
              Share
            </button>
            {shareStatus && <span className={styles.shareStatus} role="status">{shareStatus}</span>}
          </div>
        </div>
        <span className={styles.preview}>PRE-PRODUCTION PARTICIPANT FORM</span>
        <h1>{stageLabel} — {positionTitle}</h1>
        <div className={styles.context}>
          <span><strong>Candidate</strong>{candidateName}</span>
          <span><strong>Progress</strong>{completedCount} of {ratingCount} ratings</span>
        </div>
      </header>

      <main className={styles.form}>
        {questions.map((question, index) => {
          const isExpanded = expandedQuestionId === question.id;
          const progress = questionProgress(question.id, question.areas);
          return (
            <section className={`${styles.question} ${isExpanded ? styles.questionExpanded : ''}`} key={question.id}>
              <button
                type="button"
                className={styles.questionToggle}
                aria-expanded={isExpanded}
                aria-controls={`question-${question.id}`}
                onClick={() => setExpandedQuestionId(isExpanded ? null : question.id)}
              >
                <span className={styles.questionNumber}>Q{index + 1}</span>
                <span className={styles.questionText}>{question.text}</span>
                <span className={styles.questionMeta}>{question.areas.length} Area{question.areas.length === 1 ? '' : 's'} · {progress.label}</span>
                <span className={styles.chevron} aria-hidden="true">⌄</span>
              </button>

              {isExpanded && (
                <div className={styles.questionBody} id={`question-${question.id}`}>
                  <div className={styles.ratingTable}>
                    <div className={`${styles.ratingRow} ${styles.tableHead}`}>
                      <span>Area of Evaluation</span>
                      <span>Rating</span>
                    </div>
                    {question.areas.map((area) => {
                      const key = `${question.id}:${area}`;
                      const selected = ratings[key] || 0;
                      return (
                        <div className={styles.ratingRow} key={area}>
                          <span>{area}</span>
                          <span className={styles.stars} role="radiogroup" aria-label={`${area} rating`}>
                            {[1,2,3,4,5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                role="radio"
                                aria-checked={selected === star}
                                aria-label={`${star} star${star === 1 ? '' : 's'}`}
                                onClick={() => setRating(question.id, area, star)}
                              >
                                {star <= selected ? '★' : '☆'}
                              </button>
                            ))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          );
        })}

        <section className={styles.comments}>
          <label htmlFor="overall-comments">Overall comments <span>Optional</span></label>
          <textarea id="overall-comments" value={comments} onChange={(event) => setComments(event.target.value)} placeholder="Add any final observations about the candidate…" />
        </section>

        <div className={styles.submitRow}>
          <span>{completedCount} of {ratingCount} ratings completed</span>
          <button type="button" disabled={completedCount !== ratingCount} onClick={() => setSubmitted(true)}>Submit Interview</button>
        </div>
      </main>
    </div>
  );
}
