import { AREAS_OF_EVALUATION } from '@/lib/interviewQuestionBank';
import styles from './InterviewEvaluationSummaryPreview.module.css';

type AreaSummary = { usedInForm: number; timesRated: number; average: number | null };

const SAMPLE: Record<string, AreaSummary> = {
  Adaptability: { usedInForm: 2, timesRated: 4, average: 4.25 },
  Communication: { usedInForm: 3, timesRated: 6, average: 4.33 },
  'Computer Skills': { usedInForm: 1, timesRated: 2, average: 4.0 },
  'Customer Service': { usedInForm: 1, timesRated: 2, average: 4.5 },
  'Decision Making': { usedInForm: 1, timesRated: 2, average: 4.0 },
  Dependability: { usedInForm: 1, timesRated: 2, average: 4.5 },
  'Employee Development': { usedInForm: 1, timesRated: 2, average: 4.0 },
  'Employee Management': { usedInForm: 1, timesRated: 2, average: 4.0 },
  Ethics: { usedInForm: 1, timesRated: 2, average: 4.5 },
  'Interpersonal Skills': { usedInForm: 2, timesRated: 4, average: 4.25 },
  'Job Knowledge': { usedInForm: 3, timesRated: 6, average: 4.17 },
  Leadership: { usedInForm: 2, timesRated: 4, average: 4.0 },
  'Organizational Skills': { usedInForm: 2, timesRated: 4, average: 4.25 },
  Productivity: { usedInForm: 1, timesRated: 2, average: 4.0 },
  Quality: { usedInForm: 2, timesRated: 4, average: 4.5 },
  'Results Driven': { usedInForm: 1, timesRated: 2, average: 4.25 },
  'Sense of Urgency': { usedInForm: 1, timesRated: 2, average: 4.0 },
  Teamwork: { usedInForm: 2, timesRated: 4, average: 4.5 },
  'Technical Skills': { usedInForm: 2, timesRated: 4, average: 4.25 }
};

function stars(value: number | null) {
  if (value === null) return <span className={styles.empty}>—</span>;
  const rounded = Math.round(value);
  return <span className={styles.stars} aria-label={`${value.toFixed(2)} out of 5 stars`}>{[1,2,3,4,5].map((star) => <span key={star}>{star <= rounded ? '★' : '☆'}</span>)}</span>;
}

export function InterviewEvaluationSummaryPreview({ candidateName }: { candidateName: string }) {
  const rows = AREAS_OF_EVALUATION.map((area) => ({ area, ...(SAMPLE[area] || { usedInForm: 0, timesRated: 0, average: null }) }));
  const rated = rows.filter((row) => row.average !== null && row.timesRated > 0);
  const totalRatings = rated.reduce((sum, row) => sum + row.timesRated, 0);
  const weightedTotal = rated.reduce((sum, row) => sum + (row.average || 0) * row.timesRated, 0);
  const overall = totalRatings ? weightedTotal / totalRatings : null;

  return (
    <section className={styles.summary} aria-label="Interview evaluation summary preview">
      <div className={styles.header}>
        <div>
          <span className="eyebrow">Interview evaluation summary</span>
          <h2>{candidateName}</h2>
          <p>Aggregate of all submitted participant scorecards for the interview round.</p>
        </div>
        <div className={styles.overall}>
          <span>Overall Interview Average</span>
          <strong>{overall === null ? '—' : overall.toFixed(2)}</strong>
          {stars(overall)}
        </div>
      </div>

      <div className={styles.previewFlag}>PRE-PRODUCTION SAMPLE · 2 OF 3 PARTICIPANTS SUBMITTED</div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Area of Evaluation</th>
              <th>Used in Form</th>
              <th>Times Rated</th>
              <th>Aggregate Average</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.area} className={row.usedInForm === 0 ? styles.unused : ''}>
                <td>{row.area}</td>
                <td>{row.usedInForm}</td>
                <td>{row.timesRated}</td>
                <td className={styles.aggregateCell}>
                  <span>{row.average === null ? '—' : row.average.toFixed(2)}</span>
                  {stars(row.average)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>The production version will calculate these values from submitted participant ratings. This preview is intentionally sample data until interview persistence is wired.</p>
    </section>
  );
}
