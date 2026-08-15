import type {
  CompensationUnit,
  RequisitionIntelligenceAnalysis
} from '@/lib/requisitionIntelligence';

type DisplayMeasure = { label: string; value: string; basis: 'Observed' | 'Estimated'; explanation: string };

const noAnalysisMeasures: DisplayMeasure[] = [
  { label: 'Compensation Alignment', value: 'Insufficient Market Evidence', basis: 'Observed', explanation: 'No advertised comparable roles have been retrieved.' },
  { label: 'Requirement–Pay Fit', value: 'Insufficient Market Evidence', basis: 'Estimated', explanation: 'Requires structured compensation and observed comparable-role evidence.' },
  { label: 'Estimated Time to Fill', value: 'Insufficient Market Evidence', basis: 'Estimated', explanation: 'No defensible market inputs are available for a time range.' },
  { label: 'Hiring Difficulty', value: 'Insufficient Market Evidence', basis: 'Estimated', explanation: 'No supporting market evidence is available for a difficulty assessment.' }
];

const compensationLabels = { below_market: 'Below Market', competitive: 'Competitive', above_market: 'Above Market', insufficient_evidence: 'Insufficient Market Evidence' } as const;
const requirementPayLabels = { aligned: 'Aligned', some_tension: 'Some Tension', misaligned: 'Misaligned', insufficient_evidence: 'Insufficient Market Evidence' } as const;
const difficultyLabels = { low: 'Low', moderate: 'Moderate', high: 'High', very_high: 'Very High', insufficient_evidence: 'Insufficient Market Evidence' } as const;

function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function formatCompensation(minimum: number | null, maximum: number | null, currency: string | null, unit: CompensationUnit): string {
  if (minimum === null && maximum === null) return 'Compensation not disclosed';
  const normalizedCurrency = currency && /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: normalizedCurrency, maximumFractionDigits: 0 });
  const range = minimum !== null && maximum !== null
    ? `${formatter.format(minimum)}–${formatter.format(maximum)}`
    : formatter.format((minimum ?? maximum) as number);
  return unit === 'unknown' ? range : `${range}/${unit}`;
}

function measuresFor(analysis: RequisitionIntelligenceAnalysis): DisplayMeasure[] {
  const intelligence = analysis.estimatedIntelligence;
  if (!intelligence) return noAnalysisMeasures;
  const timeToFill = intelligence.estimatedTimeToFill;
  return [
    {
      label: 'Compensation Alignment',
      value: compensationLabels[intelligence.compensationAlignment.state],
      basis: 'Estimated',
      explanation: intelligence.compensationAlignment.explanation
    },
    {
      label: 'Requirement–Pay Fit',
      value: requirementPayLabels[intelligence.requirementPayFit.state],
      basis: 'Estimated',
      explanation: intelligence.requirementPayFit.explanation
    },
    {
      label: 'Estimated Time to Fill',
      value: timeToFill.state === 'estimated' && timeToFill.minimumDays !== null && timeToFill.maximumDays !== null
        ? `${timeToFill.minimumDays}–${timeToFill.maximumDays} days`
        : 'Insufficient Market Evidence',
      basis: 'Estimated',
      explanation: timeToFill.rationale
    },
    {
      label: 'Hiring Difficulty',
      value: difficultyLabels[intelligence.hiringDifficulty.state],
      basis: 'Estimated',
      explanation: intelligence.hiringDifficulty.rationale
    }
  ];
}

export function RequisitionIntelligence({ analysis, checkedAt, sourceIsStale = false }: { analysis: RequisitionIntelligenceAnalysis | null; checkedAt: Date; sourceIsStale?: boolean }) {
  const measures = analysis ? measuresFor(analysis) : noAnalysisMeasures;
  const analysisDate = analysis?.analysisGeneratedAt || analysis?.createdAt;
  const comparableCount = analysis?.observedEvidence.usableComparableCount ?? 0;
  const notice = !analysis
    ? { title: 'Market analysis unavailable', detail: 'Market data connection required. No external compensation or labor-market evidence has been retrieved.' }
    : analysis.status === 'pending'
      ? { title: 'Market analysis pending', detail: 'No market conclusions are available yet.' }
      : analysis.status === 'failed'
        ? { title: 'Market analysis unavailable', detail: analysis.failureReason || 'The analysis could not be completed.' }
        : analysis.status === 'insufficient_evidence'
          ? { title: 'Insufficient market evidence', detail: analysis.observedEvidence.evidenceQualityDescriptor || 'Not enough defensible comparable evidence was retrieved.' }
          : { title: 'Market analysis complete', detail: analysis.observedEvidence.evidenceQualityDescriptor || `${comparableCount} advertised comparables analyzed.` };

  return (
    <section className="requisition-intelligence" aria-labelledby="market-analysis-heading">
      <div className="intelligence-heading">
        <div><span className="eyebrow">Requisition intelligence</span><h2 id="market-analysis-heading">Market Analysis</h2></div>
        <span className="intelligence-date">{analysisDate ? `Analysis generated ${formatDate(analysisDate)}` : `Availability checked ${formatDate(checkedAt)}`}</span>
      </div>

      {sourceIsStale&&<div className="source-stale-notice">Job Description has changed since this Market Analysis was generated.</div>}

      <div className="intelligence-notice"><strong>{notice.title}</strong><span>{notice.detail}</span></div>
      <div className="intelligence-grid">
        {measures.map((measure) => (
          <article className="intelligence-measure" key={measure.label}>
            <span className="intelligence-label">{measure.label}</span>
            <strong>{measure.value}</strong>
            <p><span className="intelligence-basis">{measure.basis}</span>{measure.explanation || 'No analytical explanation available.'}</p>
          </article>
        ))}
      </div>

      <details className="intelligence-evidence">
        <summary>Market evidence · {comparableCount} advertised {comparableCount === 1 ? 'comp' : 'comps'}</summary>
        <div className="intelligence-evidence-body">
          {analysis?.comparables.length ? (
            <div className="intelligence-comparables">
              {analysis.comparables.map((comparable) => (
                <article key={comparable.id}>
                  <div><strong>{comparable.comparableTitle}</strong><span>{comparable.employer}</span></div>
                  <div><span>{comparable.location || 'Location not disclosed'}</span><span>{formatCompensation(comparable.advertisedCompensationMinimum, comparable.advertisedCompensationMaximum, comparable.currency, comparable.compensationUnit)}</span></div>
                  <a href={comparable.sourceUrl} target="_blank" rel="noreferrer">{comparable.sourceName} ↗</a>
                </article>
              ))}
            </div>
          ) : <p>No comparable postings, benchmark sources, citations, or source URLs were retrieved.</p>}
          <dl>
            <div><dt>Internal</dt><dd>{analysis?.internalEvidence ? 'Structured employer/JD inputs are preserved with this analysis.' : 'Employer-provided Job Description is available below; structured compensation and location have not been extracted.'}</dd></div>
            <div><dt>Observed</dt><dd>{analysis ? `${comparableCount} usable comparable source records preserved.` : 'No external market evidence retrieved.'}</dd></div>
            <div><dt>Estimated</dt><dd>{analysis ? 'Conclusions are stored separately from internal inputs and observed source records.' : 'Conclusions withheld until defensible observed evidence is available.'}</dd></div>
          </dl>
        </div>
      </details>
    </section>
  );
}
