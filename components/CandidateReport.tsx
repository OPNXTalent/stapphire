import { StapphirePrintHeader } from '@/components/StapphirePrintHeader';

function List({ items, empty = 'None identified.' }: { items?: string[]; empty?: string }) {
  return items?.length ? (
    <ul className="bullets">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  ) : (
    <p className="muted">{empty}</p>
  );
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
function cleanTransitStatus(value: string): string {
  return value.replace(/^(previous\s+transit\s+employer\s*:\s*)+/i, '').trim();
}
function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function cleanEvaluationSummary(value: string): string {
  return value.replace(/^(?:(?:greenlight)(?:\s*[—-]\s*recommend interview)?|consider(?:\s*[—-]\s*hold\s*\/\s*clarify)?|decline|recommend(?:ed)?|do not recommend)\s*(?:[.:]\s*|$)/i, '').trim();
}

function normalizeAssessment(value: unknown) {
  const source = record(value);
  const ats = record(source.ats_compatibility);
  const employment = record(source.employment_history_review);
  const transitValue = employment.previous_transit_employer;
  const transit = record(transitValue);
  const legacyTransit = cleanTransitStatus(text(transitValue));
  const strongestMatches = Array.isArray(source.strongest_matches)
    ? source.strongest_matches.flatMap((item) => {
        const match = record(item);
        const requirement = text(match.requirement);
        const evidence = text(match.evidence);
        const assessment = text(match.assessment);
        return requirement || evidence || assessment ? [{ requirement, evidence, assessment }] : [];
      })
    : [];
  const weightedCriteria = Array.isArray(source.weighted_criteria) ? source.weighted_criteria.flatMap((item) => {
    const criterion = record(item); const label = text(criterion.label); const evidence = text(criterion.evidence); const assessment = text(criterion.assessment); const weight = number(criterion.applied_weight); const score = number(criterion.score);
    return label && weight !== null && score !== null ? [{ id: text(criterion.criterion_id), label, category: text(criterion.category), weight, score, evidence, assessment }] : [];
  }) : [];
  const knockoutCriteria = Array.isArray(source.knockout_criteria) ? source.knockout_criteria.flatMap((item) => {
    const criterion = record(item); const label = text(criterion.label); const status = text(criterion.status); const evidence = text(criterion.evidence); const assessment = text(criterion.assessment);
    return label && status ? [{ id: text(criterion.criterion_id), label, status, evidence, assessment }] : [];
  }) : [];
  const categoryWeights = record(source.category_weights);
  const categoryRollups = record(source.category_rollups);
  return {
    evaluationFormat: text(source.evaluation_format), weightedCriteria, knockoutCriteria, categoryWeights, categoryRollups,
    assessment: text(source.assessment),
    standoutReasons: texts(source.standout_reasons),
    strongestMatches,
    mostImportantConcern: text(source.most_important_concern),
    dealBreakers: texts(source.deal_breakers),
    whatToVerify: texts(source.what_to_verify),
    trainableAfterHire: texts(source.trainable_after_hire),
    ats: { level: text(ats.level), reasoning: text(ats.reasoning) },
    employment: {
      transit: {
        status: cleanTransitStatus(text(transit.status)) || legacyTransit,
        employer: text(transit.employer),
        position: text(transit.position),
        dates: text(transit.dates)
      },
      gaps: texts(employment.gaps),
      shortTenure: texts(employment.short_tenure),
      stability: text(employment.stability)
    },
    strategicRisk: text(source.strategic_risk),
    interviewPriorities: texts(source.interview_priorities),
    finalRecommendationReasoning: cleanEvaluationSummary(text(source.final_recommendation_reasoning))
  };
}

export function CandidateReport({
  candidateName,
  positionTitle,
  overallMatch,
  responsibilities,
  hardSkills,
  softSkills,
  keywords,
  assessment,
  evaluationDate
}: {
  candidateName: string;
  positionTitle: string;
  overallMatch: number;
  responsibilities: number | null;
  hardSkills: number | null;
  softSkills: number | null;
  keywords: number | null;
  assessment: unknown;
  evaluationDate?: string;
}) {
  const a = normalizeAssessment(assessment);
  const formattedEvaluationDate = evaluationDate ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(evaluationDate)) : '';
  return (
    <article className="evaluation print-document candidate-print-document">
      <StapphirePrintHeader documentTitle="Candidate Evaluation"/>
      <section className="hero">
        <p className="muted">Candidate Evaluation</p>
        <h1>{candidateName}</h1>
        <p>{positionTitle}</p>
        {formattedEvaluationDate&&<p className="evaluation-date">Evaluation date: {formattedEvaluationDate}</p>}
        <div className="match">{overallMatch}% Match</div>
      </section>

      {a.assessment && (
        <>
          <h2>Assessment</h2>
          <div className="prose">{a.assessment}</div>
        </>
      )}

      <h2>Weighted Alignment</h2>
      {a.evaluationFormat === 'criteria_v1' ? <>
        <table className="weighted-alignment-table criteria-category-rollups">
          <thead><tr><th>Category</th><th>Applied Weight</th><th>Score</th></tr></thead>
          <tbody>
            {([['responsibilities','Job Responsibilities'],['hard_skills','Hard Skills'],['soft_skills','Soft Skills'],['keywords','Keywords & Terminology'],['other_requirements','Other Requirements']] as const).map(([key,label])=><tr key={key}><td>{label}</td><td className="numeric">{number(a.categoryWeights[key]) ?? 0}%</td><td className="numeric">{number(a.categoryRollups[key]) === null ? '—' : `${number(a.categoryRollups[key])}%`}</td></tr>)}
            <tr><td><strong>Match</strong></td><td className="numeric"><strong>100%</strong></td><td className="numeric"><strong>{overallMatch}%</strong></td></tr>
          </tbody>
        </table>
        <h3>Weighted Criteria</h3>
        <table className="criteria-results-table">
          <thead><tr><th>Criterion</th><th>Weight</th><th>Score</th><th>Evidence</th></tr></thead>
          <tbody>{a.weightedCriteria.map((criterion)=><tr key={criterion.id}><td><strong>{criterion.label}</strong>{criterion.assessment&&<small>{criterion.assessment}</small>}</td><td className="numeric">{criterion.weight}%</td><td className="numeric">{criterion.score}%</td><td>{criterion.evidence||'No supporting evidence identified.'}</td></tr>)}</tbody>
        </table>
        {a.knockoutCriteria.length>0&&<><h2>Knockouts</h2><table className="knockout-results-table"><thead><tr><th>Requirement</th><th>Status</th><th>Evidence</th></tr></thead><tbody>{a.knockoutCriteria.map((criterion)=><tr key={criterion.id}><td><strong>{criterion.label}</strong>{criterion.assessment&&<small>{criterion.assessment}</small>}</td><td>{criterion.status.replaceAll('_',' ')}</td><td>{criterion.evidence||'Resume evidence was insufficient.'}</td></tr>)}</tbody></table></>}
      </> : <table className="weighted-alignment-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Weight</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Job Responsibilities</td>
            <td className="numeric">50%</td>
            <td className="numeric">{responsibilities}%</td>
          </tr>
          <tr>
            <td>Hard Skills</td>
            <td className="numeric">25%</td>
            <td className="numeric">{hardSkills}%</td>
          </tr>
          <tr>
            <td>Soft Skills</td>
            <td className="numeric">15%</td>
            <td className="numeric">{softSkills}%</td>
          </tr>
          <tr>
            <td>Keywords &amp; Terminology</td>
            <td className="numeric">10%</td>
            <td className="numeric">{keywords}%</td>
          </tr>
          <tr>
            <td>
              <strong>Match</strong>
            </td>
            <td className="numeric">
              <strong>100%</strong>
            </td>
            <td className="numeric">
              <strong>{overallMatch}%</strong>
            </td>
          </tr>
        </tbody>
      </table>}

      {a.standoutReasons.length > 0 && (
        <>
          <h2>Why This Candidate Stands Out</h2>
          <List items={a.standoutReasons} />
        </>
      )}

      {a.strongestMatches.length > 0 && (
        <>
          <h2>Strongest Job-Specific Matches</h2>
          <table className="strong-table">
            <thead>
              <tr>
                <th>Requirement</th>
                <th>Candidate Evidence</th>
                <th>Assessment</th>
              </tr>
            </thead>
            <tbody>
              {a.strongestMatches.map((m, i) => (
                <tr key={i}>
                  <td>{m.requirement}</td>
                  <td>{m.evidence}</td>
                  <td>{m.assessment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {a.mostImportantConcern && (
        <>
          <h2>Most Important Concern</h2>
          <p>{a.mostImportantConcern}</p>
        </>
      )}

      {a.dealBreakers.length > 0 && (
        <>
          <h3>Transparent deal-breakers</h3>
          <List items={a.dealBreakers} />
        </>
      )}

      {a.whatToVerify.length > 0 && (
        <>
          <h2>What to Verify</h2>
          <List items={a.whatToVerify} />
        </>
      )}

      {a.trainableAfterHire.length > 0 && (
        <>
          <h2>Trainable After Hire</h2>
          <List items={a.trainableAfterHire} />
        </>
      )}

      {(a.ats.level || a.ats.reasoning) && (
        <>
          <h2>ATS Compatibility</h2>
          <p>
            {a.ats.level && <strong>{a.ats.level}</strong>}
            {a.ats.level && a.ats.reasoning && ' — '}
            {a.ats.reasoning}
          </p>
        </>
      )}

      {(a.employment.transit.status || a.employment.gaps.length > 0 || a.employment.shortTenure.length > 0 || a.employment.stability) && (
        <>
          <h2>Employment History Review</h2>
          <p>
            <strong>Previous Transit Employer:</strong> {a.employment.transit.status || 'None Identified'}
          </p>
          {a.employment.transit.status === 'Yes' && (
            <div>
              <p>
                <strong>Employer:</strong> {a.employment.transit.employer}
              </p>
              <p>
                <strong>Position:</strong> {a.employment.transit.position}
              </p>
              <p>
                <strong>Dates:</strong> {a.employment.transit.dates}
              </p>
            </div>
          )}
          {a.employment.gaps.length > 0 && (
            <>
              <h3>Gaps</h3>
              <List items={a.employment.gaps} />
            </>
          )}
          {a.employment.shortTenure.length > 0 && (
            <>
              <h3>Short tenure</h3>
              <List items={a.employment.shortTenure} />
            </>
          )}
          {a.employment.stability && (
            <>
              <h3>Stability</h3>
              <p>{a.employment.stability}</p>
            </>
          )}
        </>
      )}

      {a.strategicRisk && (
        <>
          <h2>Strategic Risk Assessment</h2>
          <p>{a.strategicRisk}</p>
        </>
      )}

      {a.interviewPriorities.length > 0 && (
        <>
          <h2>Interview Priorities</h2>
          <List items={a.interviewPriorities} />
        </>
      )}

      {a.finalRecommendationReasoning && (
        <>
          <h2>Evaluation Summary</h2>
          <p>{a.finalRecommendationReasoning}</p>
        </>
      )}
    </article>
  );
}
