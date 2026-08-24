'use client';

import { useState } from 'react';
import styles from './InterviewScorecardPreview.module.css';

type PreviewQuestion = { id: string; text: string; areas: string[] } | null;

export function InterviewScorecardPreview({ question }: { question: PreviewQuestion }) {
  const [ratings, setRatings] = useState<Record<string, number>>({});

  if (!question) {
    return (
      <section className={styles.card} aria-label="Participant interview form preview">
        <span className="eyebrow">Participant form preview</span>
        <p className={styles.empty}>Add a question to preview the participant scoring experience.</p>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-label="Participant interview form preview">
      <div className={styles.heading}>
        <div>
          <span className="eyebrow">Participant form preview</span>
          <h2>Area-level scoring</h2>
        </div>
        <span className={styles.note}>Each mapped Area of Evaluation receives its own 1–5 star rating.</span>
      </div>

      <div className={styles.formPreview}>
        <div className={styles.questionHeader}>{question.text}</div>
        <div className={styles.columnHeader}>
          <span>Area of Evaluation</span>
          <span>Rating</span>
        </div>
        {question.areas.length ? question.areas.map((area) => {
          const key = `${question.id}:${area}`;
          const value = ratings[key] || 0;
          return (
            <div className={styles.ratingRow} key={area}>
              <span className={styles.area}>{area}</span>
              <div className={styles.ratingControl} aria-label={`${area} rating`}>
                {[1,2,3,4,5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`${styles.star} ${star <= value ? styles.selected : ''}`}
                    aria-label={`Rate ${area} ${star} out of 5`}
                    aria-pressed={star === value}
                    onClick={() => setRatings((current) => ({ ...current, [key]: star }))}
                  >★</button>
                ))}
                <span className={styles.value}>{value ? `${value}/5` : '—'}</span>
              </div>
            </div>
          );
        }) : (
          <div className={styles.noAreas}>Map one or more Areas of Evaluation to this question to create its scoring rows.</div>
        )}
      </div>
    </section>
  );
}
