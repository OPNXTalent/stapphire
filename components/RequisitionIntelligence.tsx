type IntelligenceMeasure = {
  label: string;
  basis: 'Observed' | 'Estimated';
  explanation: string;
};

const measures: IntelligenceMeasure[] = [
  {
    label: 'Compensation Alignment',
    basis: 'Observed',
    explanation: 'No advertised comparable roles have been retrieved.'
  },
  {
    label: 'Requirement–Pay Fit',
    basis: 'Estimated',
    explanation: 'Requires structured compensation and observed comparable-role evidence.'
  },
  {
    label: 'Estimated Time to Fill',
    basis: 'Estimated',
    explanation: 'No defensible market inputs are available for a time range.'
  },
  {
    label: 'Hiring Difficulty',
    basis: 'Estimated',
    explanation: 'No supporting market evidence is available for a difficulty assessment.'
  }
];

export function RequisitionIntelligence({ checkedAt }: { checkedAt: Date }) {
  const checkedDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(checkedAt);

  return (
    <section className="requisition-intelligence" aria-labelledby="market-outlook-heading">
      <div className="intelligence-heading">
        <div>
          <span className="eyebrow">Requisition intelligence</span>
          <h2 id="market-outlook-heading">Market Outlook</h2>
        </div>
        <span className="intelligence-date">Availability checked {checkedDate}</span>
      </div>

      <div className="intelligence-notice">
        <strong>Market analysis unavailable</strong>
        <span>Market data connection required. No external compensation or labor-market evidence has been retrieved.</span>
      </div>

      <div className="intelligence-grid">
        {measures.map((measure) => (
          <article className="intelligence-measure" key={measure.label}>
            <span className="intelligence-label">{measure.label}</span>
            <strong>Insufficient Market Evidence</strong>
            <p><span className="intelligence-basis">{measure.basis}</span>{measure.explanation}</p>
          </article>
        ))}
      </div>

      <details className="intelligence-evidence">
        <summary>Market evidence · 0 advertised comps</summary>
        <div className="intelligence-evidence-body">
          <p>No comparable postings, benchmark sources, citations, or source URLs were retrieved.</p>
          <dl>
            <div><dt>Internal</dt><dd>Employer-provided Job Description is available below; compensation and location are not stored as structured requisition fields.</dd></div>
            <div><dt>Observed</dt><dd>No external market evidence retrieved.</dd></div>
            <div><dt>Estimated</dt><dd>Conclusions withheld until defensible observed evidence is available.</dd></div>
          </dl>
        </div>
      </details>
    </section>
  );
}
