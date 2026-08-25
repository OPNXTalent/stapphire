'use client';

import { useMemo, useState } from 'react';
import { buildQuestionBank, INTERVIEW_STAGES } from '@/lib/interviewQuestionBank';
import { StapphireBrand } from '@/components/StapphireBrand';
import styles from './ParticipantInterviewPreview.module.css';

type InterviewRecommendation = '' | 'Proceed' | 'Decline' | 'Undecided - Need more information';
type FormQuestion = { id: string; text: string; areas: string[] };

export function ParticipantInterviewPreview({
  stage,
  interviewTitle,
  candidateName,
  positionTitle,
  candidateId,
  questions,
  invitationToken,
  participantName = '',
  shareEnabled = true
}: {
  stage: string;
  interviewTitle?: string;
  candidateName: string;
  positionTitle: string;
  candidateId?: string;
  questions?: FormQuestion[];
  invitationToken?: string;
  participantName?: string;
  shareEnabled?: boolean;
}) {
  const formQuestions = useMemo<FormQuestion[]>(() => {
    if (questions) return questions;
    return buildQuestionBank(positionTitle)
      .filter((question) => question.stage === stage)
      .map((question) => ({ id: question.id, text: question.text, areas: question.areas }));
  }, [positionTitle, questions, stage]);

  const stageLabel = interviewTitle || INTERVIEW_STAGES.find((item) => item.id === stage)?.label || 'Interview';
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState('');
  const [recommendation, setRecommendation] = useState<InterviewRecommendation>('');
  const [shareStatus, setShareStatus] = useState('');
  const [participantNameValue, setParticipantNameValue] = useState(participantName);
  const [identityStatus, setIdentityStatus] = useState('');
  const [submitStatus, setSubmitStatus] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(formQuestions[0]?.id ?? null);

  const ratingCount = formQuestions.reduce((sum, question) => sum + question.areas.length, 0);
  const completedCount = Object.keys(ratings).length;
  const assessmentComplete = participantNameValue.trim().length > 0 && comments.trim().length > 0 && recommendation !== '';
  const assessmentReady = completedCount === ratingCount && assessmentComplete;

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
    if (!candidateId) {
      setShareStatus('Unable to share');
      return;
    }

    try {
      setShareStatus('Creating link…');
      const response = await fetch(`/api/candidates/${candidateId}/interview-invitations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.invitation?.url) throw new Error(payload?.error || 'Unable to create invitation.');

      const url = payload.invitation.url as string;
      const title = `${stageLabel} — ${positionTitle}`;
      const text = `You're invited to participate in the ${stageLabel} interview evaluation for ${candidateName} for the ${positionTitle} position. Please use the link below to complete your ratings, comments, and recommendation. Your feedback will be recorded with the candidate's interview results.`;
      const shareText = `${text}\n\n${url}`;

      if (navigator.share) {
        await navigator.share({ title, text: shareText });
        setShareStatus('Shared');
      } else {
        await navigator.clipboard.writeText(shareText);
        setShareStatus('Message + link copied');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setShareStatus(error instanceof Error ? error.message : 'Unable to share');
    }

    window.setTimeout(() => setShareStatus(''), 2600);
  }

  async function saveParticipantName() {
    if (!invitationToken) return;
    const nextName = participantNameValue.trim();
    if (!nextName) {
      setIdentityStatus('Name required');
      return;
    }

    try {
      setIdentityStatus('Saving…');
      const response = await fetch(`/api/interview-invitations/${invitationToken}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ participantName: nextName })
      });
      if (!response.ok) throw new Error();
      setIdentityStatus('Saved');
      window.setTimeout(() => setIdentityStatus(''), 1800);
    } catch {
      setIdentityStatus('Unable to save');
    }
  }

  async function submitInterview() {
    if (!invitationToken || !assessmentReady || submitted) return;

    try {
      setSubmitStatus('Submitting…');
      const response = await fetch(`/api/interview-invitations/${invitationToken}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          submit: true,
          participantName: participantNameValue.trim(),
          ratings,
          comments: comments.trim(),
          recommendation
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Unable to submit interview.');
      setSubmitted(true);
      setSubmitStatus('Interview submitted');
    } catch (error) {
      setSubmitStatus(error instanceof Error ? error.message : 'Unable to submit interview');
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.brand}><StapphireBrand decorative /></div>
          {shareEnabled && (
            <div className={styles.shareWrap}>
              <button type="button" className={styles.shareButton} onClick={shareInterview} aria-label="Share interview invitation">
                <span aria-hidden="true">↗</span>
                Share
              </button>
              {shareStatus && <span className={styles.shareStatus} role="status">{shareStatus}</span>}
            </div>
          )}
        </div>
        <span className={styles.preview}>PRE-PRODUCTION PARTICIPANT FORM</span>
        <h1>{stageLabel} — {positionTitle}</h1>
        <div className={styles.context}>
          <span><strong>Candidate</strong>{candidateName}</span>
          <span><strong>Progress</strong>{completedCount} of {ratingCount} ratings</span>
        </div>
      </header>

      <main className={styles.form}>
        {invitationToken && (
          <section className={styles.identity} aria-label="Interview participant identity">
            <label htmlFor="participant-name">Your name</label>
            <div className={styles.identityRow}>
              <input
                id="participant-name"
                value={participantNameValue}
                onChange={(event) => setParticipantNameValue(event.target.value)}
                onBlur={saveParticipantName}
                placeholder="Enter your name"
                autoComplete="name"
                required
              />
              {identityStatus && <span role="status">{identityStatus}</span>}
            </div>
          </section>
        )}

        {formQuestions.map((question, index) => {
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
                <span className={styles.questionMeta}>{progress.label}</span>
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

        <section className={styles.assessment} aria-labelledby="interview-assessment-heading">
          <div className={styles.assessmentHeader}>
            <h2 id="interview-assessment-heading">Interview Assessment</h2>
            <span>Required</span>
          </div>

          <div className={styles.assessmentField}>
            <label htmlFor="overall-comments">Overall Comments</label>
            <textarea
              id="overall-comments"
              required
              value={comments}
              onChange={(event) => setComments(event.target.value)}
              placeholder="Add your overall observations about the candidate…"
            />
          </div>

          <div className={styles.assessmentField}>
            <label htmlFor="recommendation">Recommendation</label>
            <select
              id="recommendation"
              required
              value={recommendation}
              onChange={(event) => setRecommendation(event.target.value as InterviewRecommendation)}
            >
              <option value="">Select recommendation</option>
              <option value="Proceed">Proceed</option>
              <option value="Decline">Decline</option>
              <option value="Undecided - Need more information">Undecided - Need more information</option>
            </select>
          </div>
        </section>

        <div className={styles.submitRow}>
          <span>{submitStatus || (assessmentReady ? 'Interview assessment complete — ready to submit' : 'Complete all ratings, your name, comments, and recommendation')}</span>
          <button type="button" disabled={!invitationToken || !assessmentReady || submitted} onClick={submitInterview}>
            {submitted ? 'Submitted' : 'Submit Interview'}
          </button>
        </div>
      </main>
    </div>
  );
}
