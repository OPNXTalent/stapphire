'use client';

type Evaluation = {
  overall_match: number;
  status: 'greenlight' | 'consider' | 'decline';
  signals: Record<string, string>;
  strengths: string[];
  gaps: string[];
  risk_flags: string[];
};

type Candidate = {
  id: string;
  full_name: string;
  source_filename: string | null;
  original_file_url: string | null;
  evaluations: Evaluation[];
};

export function CandidateCard({
  candidate,
  index,
  onAddNote,
  onShare
}: {
  candidate: Candidate;
  index: number;
  onAddNote: (candidateId: string) => void;
  onShare: (candidateId: string) => void;
}) {
  const evalu = candidate.evaluations?.[0];
  if (!evalu) return null;

  const flagged = evalu.risk_flags && evalu.risk_flags.length > 0;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-num">Candidate {index + 1}</div>
          <div className="card-name">{candidate.full_name}</div>
          <div className="card-source-row">
            <span className="card-source">
              Profile built from {candidate.source_filename ?? 'uploaded resume'}
            </span>
            {candidate.original_file_url && (
              <a className="dl-link" href={candidate.original_file_url} target="_blank" rel="noreferrer">
                Download Original Resume
              </a>
            )}
          </div>
        </div>

        <div className="quick-actions">
          <button className="qa-btn" title="Add note" onClick={() => onAddNote(candidate.id)}>
            ✎
          </button>
          <button className="qa-btn" title="Share with team" onClick={() => onShare(candidate.id)}>
            ⤴
          </button>
        </div>

        <div className="card-score-block">
          <div className="card-score">{evalu.overall_match}%</div>
          <div className="card-rec-pill">
            <span className={`rec-pill ${evalu.status}`}>
              {evalu.status.charAt(0).toUpperCase() + evalu.status.slice(1)}
            </span>
          </div>
        </div>
      </div>

      <div className="card-body">
        <div className="signal-row">
          {Object.entries(evalu.signals ?? {}).map(
            ([key, value]) =>
              value && (
                <div className="signal-chip" key={key}>
                  <span className="signal-label">{key.replace(/_/g, ' ')}</span>
                  <span className="signal-value">{value}</span>
                </div>
              )
          )}
        </div>

        <div className="two-col">
          <div>
            <div className="section-label">Evidence</div>
            <ul className="plain evidence">
              {evalu.strengths?.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="section-label">Gaps</div>
            <ul className="plain gaps">
              {evalu.gaps?.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
        </div>

        {flagged && (
          <div className="risk-note flagged">{evalu.risk_flags[0]}</div>
        )}
      </div>
    </div>
  );
}
