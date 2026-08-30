'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { buildQuestionBank, INTERVIEW_STAGES } from '@/lib/interviewQuestionBank';
import { StapphireBrand } from '@/components/StapphireBrand';
import styles from './ParticipantInterviewPreview.module.css';
import overrides from './ParticipantInterviewPreviewOverrides.module.css';
import { interviewProgress, isQuestionComplete, type YesNoResponse } from '@/lib/interviewCompletion';
import { readableHeaderText } from '@/lib/colorContrast';

type InterviewRecommendation = '' | 'Proceed' | 'Decline' | 'Undecided - Need more information';
type FormQuestion = { id: string; text: string; areas: string[]; commentBox?: boolean; yesNo?: boolean };
type FormBranding = { paletteName?: string; primary?: string; accent?: string; logoUrl?: string; logoName?: string };

export function ParticipantInterviewPreview({
  stage,
  interviewTitle,
  candidateName,
  positionTitle,
  candidateId,
  questions,
  branding,
  invitationToken,
  participantName = '',
  initiallySubmitted = false,
  shareEnabled = true
}: {
  stage: string;
  interviewTitle?: string;
  candidateName: string;
  positionTitle: string;
  candidateId?: string;
  questions?: FormQuestion[];
  branding?: FormBranding;
  invitationToken?: string;
  participantName?: string;
  initiallySubmitted?: boolean;
  shareEnabled?: boolean;
}) {
  const formQuestions = useMemo<FormQuestion[]>(() => {
    if (questions) return questions;
    return buildQuestionBank(positionTitle)
      .filter((question) => question.stage === stage)
      .map((question) => ({ id: question.id, text: question.text, areas: question.areas, commentBox: true }));
  }, [positionTitle, questions, stage]);

  const stageLabel = interviewTitle || INTERVIEW_STAGES.find((item) => item.id === stage)?.label || 'Interview';
  const primary = branding?.primary || '#030d26';
  const accent = branding?.accent || '#1e4fd8';
  const brandedStyle = {
    '--form-primary': primary,
    '--form-accent': accent,
    '--form-primary-text': readableHeaderText(primary),
    '--navy': primary,
    '--sapphire': accent,
    '--sapphire-2': accent
  } as CSSProperties;

  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [questionComments, setQuestionComments] = useState<Record<string, string>>({});
  const [yesNoResponses, setYesNoResponses] = useState<Record<string, YesNoResponse>>({});
  const [comments, setComments] = useState('');
  const [recommendation, setRecommendation] = useState<InterviewRecommendation>('');
  const [shareStatus, setShareStatus] = useState('');
  const [participantNameValue, setParticipantNameValue] = useState(participantName);
  const [identityStatus, setIdentityStatus] = useState('');
  const [submitStatus, setSubmitStatus] = useState('');
  const [submitted, setSubmitted] = useState(initiallySubmitted);
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(formQuestions[0]?.id ?? null);

  const progress = interviewProgress(formQuestions, { ratings, questionComments, yesNoResponses });
  const internalSubmission = !invitationToken && Boolean(candidateId);
  const assessmentComplete = (internalSubmission || participantNameValue.trim().length > 0) && comments.trim().length > 0 && recommendation !== '';
  const assessmentReady = progress.complete && assessmentComplete;

  function setRating(questionId: string, area: string, value: number) {
    setRatings((current) => ({ ...current, [`${questionId}:${area}`]: value }));
  }

  function questionProgress(question: FormQuestion) {
    if (isQuestionComplete(question, { ratings, questionComments, yesNoResponses })) return 'Complete';
    const touched = question.areas.some((area) => ratings[`${question.id}:${area}`]) || Boolean(questionComments[question.id]?.trim()) || Boolean(yesNoResponses[question.id]);
    return touched ? 'In Progress' : 'Not Complete';
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
    if (!assessmentReady || submitted || (!invitationToken && !candidateId)) return;

    try {
      setSubmitStatus('Submitting…');
      let submissionToken = invitationToken;

      if (!submissionToken && candidateId) {
        const invitationResponse = await fetch(`/api/candidates/${candidateId}/interview-invitations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ stage })
        });
        const invitationPayload = await invitationResponse.json();
        const invitationUrl = invitationPayload?.invitation?.url as string | undefined;
        if (!invitationResponse.ok || !invitationUrl) {
          throw new Error(invitationPayload?.error || 'Unable to prepare interview submission.');
        }
        submissionToken = invitationUrl.split('/').filter(Boolean).pop();
        if (!submissionToken) throw new Error('Unable to prepare interview submission.');
      }

      if (!submissionToken) throw new Error('Unable to prepare interview submission.');

      const response = await fetch(`/api/interview-invitations/${submissionToken}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          submit: true,
          participantName: participantNameValue.trim() || 'Stapphire reviewer',
          ratings,
          yesNoResponses,
          questionComments: Object.fromEntries(
            Object.entries(questionComments)
              .map(([questionId, value]) => [questionId, value.trim()])
              .filter(([, value]) => value.length > 0)
          ),
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

  if (submitted) {
    return (
      <div className={styles.page} style={brandedStyle}>
        <section className={`${styles.submitted} ${overrides.submittedConfirmation}`} role="status" aria-live="polite">
          <div className={overrides.submittedBrand}>
            {branding?.logoUrl
              ? <img src={branding.logoUrl} alt={branding.logoName || 'Company logo'} />
              : <StapphireBrand decorative />}
          </div>
          <span className={styles.preview}>SUBMISSION RECEIVED</span>
          <h1>Thank you</h1>
          <p>Your {stage === 'phone-screen' ? 'Phone Screen' : 'interview'} assessment for {candidateName} has been submitted successfully.</p>
          <small>You may close this window.</small>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page} style={brandedStyle}>
      <header className={`${styles.header} ${overrides.headerAdaptive}`}>
        <div className={styles.headerTop}>
          <div className={styles.brand}>
            {branding?.logoUrl
              ? <img src={branding.logoUrl} alt={branding.logoName || 'Company logo'} style={{ display: 'block', maxWidth: '180px', maxHeight: '48px', objectFit: 'contain' }} />
              : <StapphireBrand decorative />}
          </div>
          {shareEnabled && (
            <div className={styles.shareWrap}>
              <button type="button" className={`${styles.shareButton} ${overrides.shareAdaptive}`} onClick={shareInterview} aria-label="Share interview invitation">
                <span aria-hidden="true">↗</span>
                Share
              </button>
              {shareStatus && <span className={`${styles.shareStatus} ${overrides.headerMuted}`} role="status">{shareStatus}</span>}
            </div>
          )}
        </div>
        <span className={`${styles.preview} ${overrides.headerMuted}`}>{stage === 'phone-screen' ? 'PHONE SCREEN ASSESSMENT' : 'INTERVIEW EVALUATION'}</span>
        <h1>{stageLabel} — {positionTitle}</h1>
        <div className={`${styles.context} ${overrides.headerText} ${overrides.headerBorder}`}>
          <span><strong>Candidate</strong>{candidateName}</span>
          <span><strong>Progress</strong>{progress.completedQuestionCount} of {progress.questionCount} questions</span>
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
          const questionStatus = questionProgress(question);
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
                <span className={styles.questionMeta}>{questionStatus}</span>
              </button>

              {isExpanded && (
                <div className={styles.questionBody} id={`question-${question.id}`}>
                  {question.areas.length > 0 && <div className={styles.ratingTable}>
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
                  </div>}
                  {question.yesNo && (
                    <fieldset className={overrides.yesNoField}>
                      <legend>Response</legend>
                      {(['yes', 'no'] as const).map((value) => (
                        <label key={value}>
                          <input type="radio" name={`yes-no-${question.id}`} checked={yesNoResponses[question.id] === value} onChange={() => setYesNoResponses((current) => ({ ...current, [question.id]: value }))} />
                          {value === 'yes' ? 'Yes' : 'No'}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {question.commentBox && (
                    <div className={styles.questionComment}>
                      <label htmlFor={`participant-question-comment-${question.id}`}>Comments</label>
                      <textarea
                        id={`participant-question-comment-${question.id}`}
                        value={questionComments[question.id] ?? ''}
                        onChange={(event) => setQuestionComments((current) => ({ ...current, [question.id]: event.target.value }))}
                        placeholder="Add comments…"
                      />
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}

        <section className={styles.assessment} aria-labelledby="interview-assessment-heading">
          <div className={styles.assessmentHeader}>
            <h2 id="interview-assessment-heading">{stage === 'phone-screen' ? 'Phone Screen Summary' : 'Interview Assessment'}</h2>
            <span>Required</span>
          </div>

          <div className={styles.assessmentField}>
            <label htmlFor="overall-comments">{stage === 'phone-screen' ? 'Screening Notes' : 'Overall Comments'}</label>
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
          <span>{submitStatus || (assessmentReady ? 'Interview assessment complete — ready to submit' : internalSubmission ? 'Complete all required responses, comments, and recommendation' : 'Complete all required responses, your name, comments, and recommendation')}</span>
          <button type="button" disabled={(!invitationToken && !candidateId) || !assessmentReady || submitted} onClick={submitInterview}>
            {stage === 'phone-screen' ? 'Submit Phone Screen' : 'Submit Interview'}
          </button>
        </div>
      </main>
    </div>
  );
}
