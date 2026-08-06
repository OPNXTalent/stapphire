// This is the ONLY reasoning layer this product uses. It is written fresh
// for Stapphire and must never be composed with, or fall back to, any
// other product's system prompt (e.g. Prism's).

export const EVALUATION_SYSTEM_PROMPT = `
You are a hiring evaluation engine inside a Quality Control workspace for
talent acquisition teams. You do not make hiring decisions. You surface
evidence. The recruiter and hiring team remain responsible for judgment.

You will be given a job description (already parsed into evaluation
pillars) and a single candidate resume. Evaluate the resume against the
job description using the following process, then call the
submit_evaluation tool with your findings — do not respond in plain text.

1. Weighted scoring (do not disclose these weights as a decision — they
   produce evidence, not a verdict):
   - Job Responsibilities Match: 50%
   - Hard Skills Alignment: 25%
   - Soft Skills Alignment: 15%
   - Keyword / Terminology Relevance: 10%

   Keyword/Terminology Relevance is intentionally the smallest weight —
   it reflects surface-level term overlap only (the kind an ATS keyword
   scan would catch), not actual qualification. Never let the absence
   of a specific industry term lower the Job Responsibilities Match or
   Hard Skills Alignment score — those two are about whether the
   underlying capability is evidenced, regardless of the words used to
   describe it. A candidate who demonstrates equivalent experience in
   different language should score comparably to one who happens to
   use the job description's exact phrasing.

2. Do not infer experience the resume doesn't support. Do not award
   credit for vague, unevidenced claims. Prioritize demonstrated
   accomplishments over years of experience alone.

2b. Before listing something as a gap, ask: is this capability actually
    REQUIRED by the job description, or is it industry-specific
    terminology/tooling that isn't itself the qualification? Do not
    list the mere absence of a specific term, tool name, or phrase as a
    gap when the resume shows comparable underlying experience through
    different language. Reserve gaps for genuinely missing, explicitly
    required capabilities — not vocabulary mismatches.

3. Employment history review:
   - Flag any employer in the provided watch-list (may be empty).
   - Flag employment gaps exceeding 12 months, with approximate dates.
   - Flag roles under 1 year, EXCLUDING contract/temp/internship/
     seasonal/volunteer/consulting — note whether the pattern looks
     isolated or recurring.

4. Strategic risk flags: inflated titles, unsubstantiated leadership
   claims, domain mismatch, instability, lack of measurable
   accomplishments. State these objectively — do not speculate beyond
   what the resume shows.

5. If the uploaded document is not a resume (e.g. a bank statement, a
   cover letter with no work history, an unrelated file), set
   document_type to "non_resume" and leave scoring fields at 0 — do not
   attempt to evaluate it as a candidate.

Keep every text field to plain prose with no line breaks inside a single
field — use separate array entries instead of embedding newlines within
one string.

"status" thresholds: overall_match >= 85 -> "greenlight";
69-84 -> "consider"; <= 68 -> "decline". These are signals for the
matrix, not a hiring recommendation — never use language like "Recommend
Interview" anywhere in the output; that decision belongs to the human
reviewer.
`.trim();

// Forcing output through a tool call (rather than asking the model to
// write JSON as free text) guarantees well-formed, schema-conforming
// output every time — no more parse failures from stray formatting,
// markdown fences, or unescaped characters in free text.
export const EVALUATION_TOOL = {
  name: 'submit_evaluation',
  description: 'Submit the structured evaluation of a candidate resume against a job description.',
  input_schema: {
    type: 'object' as const,
    properties: {
      candidate_name: { type: 'string' },
      document_type: { type: 'string', enum: ['resume', 'non_resume'] },
      overall_match: { type: 'number' },
      status: { type: 'string', enum: ['greenlight', 'consider', 'decline'] },
      scores: {
        type: 'object',
        properties: {
          job_responsibilities_match: { type: 'number' },
          hard_skills_alignment: { type: 'number' },
          soft_skills_alignment: { type: 'number' },
          keyword_relevance: { type: 'number' }
        },
        required: ['job_responsibilities_match', 'hard_skills_alignment', 'soft_skills_alignment', 'keyword_relevance']
      },
      signals: {
        type: 'object',
        properties: {
          resume_confidence: { type: 'string', enum: ['High', 'Moderate', 'Limited'] },
          evidence_quality: { type: 'string', enum: ['Strong', 'Moderate', 'Limited'] },
          location_fit: { type: 'string' },
          relocation_consideration: { type: 'string' },
          employment_status: { type: 'string' },
          timeline_review: { type: 'string' },
          required_certifications: { type: 'string' }
        }
      },
      strengths: { type: 'array', items: { type: 'string' } },
      gaps: { type: 'array', items: { type: 'string' } },
      ats_compatibility: {
        type: 'object',
        properties: {
          rating: { type: 'string', enum: ['High', 'Moderate', 'Low'] },
          reasoning: { type: 'string' }
        }
      },
      employment_history: {
        type: 'object',
        properties: {
          watchlist_employer_match: {
            type: 'object',
            properties: {
              found: { type: 'boolean' },
              entries: { type: 'array', items: { type: 'string' } }
            }
          },
          gaps: { type: 'array', items: { type: 'string' } },
          short_tenure_roles: { type: 'array', items: { type: 'string' } }
        }
      },
      risk_flags: { type: 'array', items: { type: 'string' } },
      interview_recommendations: {
        type: 'object',
        properties: {
          probe_areas: { type: 'array', items: { type: 'string' } },
          skills_to_validate: { type: 'array', items: { type: 'string' } },
          org_value: { type: 'string' },
          alternate_roles: { type: 'array', items: { type: 'string' } }
        }
      },
      matrix_dimensions: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'JD-specific comparison columns, e.g. {"Call Center Experience": "Excellent"}'
      }
    },
    required: ['candidate_name', 'document_type', 'overall_match', 'status', 'scores', 'signals', 'strengths', 'gaps', 'risk_flags']
  }
};

export function buildEvaluationUserMessage(params: {
  jobDescription: string;
  evaluationPillars: unknown;
  employerWatchlist: string[];
  resumeText: string;
}): string {
  return JSON.stringify({
    job_description: params.jobDescription,
    evaluation_pillars: params.evaluationPillars ?? null,
    employer_watchlist: params.employerWatchlist,
    resume_text: params.resumeText
  });
}
