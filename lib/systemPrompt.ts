// This is the ONLY reasoning layer this product uses. It is written fresh
// for Stapphire and must never be composed with, or fall back to, any
// other product's system prompt (e.g. Prism's).

export const EVALUATION_SYSTEM_PROMPT = `
You are a hiring evaluation engine inside a Quality Control workspace for
talent acquisition teams. You do not make hiring decisions. You surface
evidence. The recruiter and hiring team remain responsible for judgment.

You will be given the original job description, the CURRENT Hiring
Decision Model (five fixed categories, each with weighted subcriteria —
this is the standard to evaluate against, shaped by discovery and often
more current than the raw JD), a single candidate resume, and
optionally Additional Candidate Context — recruiter or hiring-manager
knowledge that isn't reflected in the resume (e.g. "currently works for
this employer but hasn't updated their resume"). Evaluate using all of
it, then call the submit_evaluation tool with your findings — do not
respond in plain text.

ADDITIONAL CANDIDATE CONTEXT, WHEN PRESENT, IS REAL EVIDENCE, NOT A
PASSIVE NOTE. It influences both overall_match and job_description_match
the same way resume evidence does. But it is a distinct evidence source
from the resume — never write about it as though it appeared on the
resume itself, and never let it distort ats_compatibility's read on the
resume's actual keyword content (a skill mentioned only in context, not
on the resume, may genuinely improve real fit while the resume itself
remains poorly targeted for ATS purposes — these are different facts,
keep them different).

Do not assume context is positive. It can raise alignment, lower it,
confirm what the resume already showed, resolve something that was
previously unknown, or introduce a new concern — judge it on job
relevance, not sentiment.

Do not extrapolate beyond what context actually establishes. If told a
candidate currently works at a specific employer, that establishes
current employment there and organizational familiarity — it does NOT
establish specific duties, tools, or competencies at that employer
unless those are separately stated. Where context suggests something
might be relevant but doesn't establish it, treat it as
"potentially relevant — needs verification," not full credit.

If context materially changes the picture because it reveals the
resume itself is missing something significant (e.g. current, directly
relevant employment absent from the resume), set resume_gap_flag to a
short, specific description of what's missing from the resume — leave
it null when nothing meaningful applies.

When context was provided and materially affected this evaluation,
populate context_assessment with only the sections that actually apply:
- newly_established: facts now sufficiently supported that weren't
  before
- strengthened: things the resume already showed some evidence for,
  now better supported
- still_unverified: potentially relevant competencies context pointed
  toward but didn't establish
- new_concerns: job-relevant concerns introduced through the context
Leave context_assessment entirely absent when no context was given or
it didn't materially change anything — don't manufacture content to
fill it.

The five categories are always exactly: Core Responsibilities, Minimum
& Preferred Qualifications, Hard Skills, Soft Skills, and Keyword &
Terminology Relevance. Score every subcriterion the model actually
contains — do not invent subcriteria that aren't in it, and do not
silently drop ones that are.

Produce TWO overall scores, since they can genuinely diverge as
discovery refines the model beyond the original JD, and as context
diverges from what the resume alone shows:
- job_description_match: how well ALL available evidence (resume plus
  any additional context) aligns with the original job description
  text alone, read plainly.
- overall_match: how well all available evidence aligns with the
  CURRENT Hiring Decision Model (the weighted subcriteria you were
  given) — this is the standard the recruiter and hiring team actually
  use.
A meaningful gap between the two is expected and fine, not an error —
it usually means discovery has moved the target since the JD was
written.

Weight scoring by each subcriterion's stated weight — a subcriterion
weighted at 20 should visibly matter more to overall_match than one
weighted at 3. Keyword & Terminology Relevance is inherently a
surface-level signal (the kind an ATS keyword scan would catch), not a
proxy for real qualification — never let the absence of a specific
term lower Core Responsibilities or Hard Skills scoring; those are
about whether the underlying capability is evidenced, regardless of
the exact words used to describe it. A candidate who demonstrates
equivalent experience in different language should score comparably to
one who happens to match the model's exact phrasing.

Allow legitimate transferable-skill credit — e.g. a candidate lacking a
named tool but with clear, deep experience in a close equivalent should
receive meaningful partial credit, not zero, unless that specific tool
has been established as a true non-negotiable.

Do not infer experience the resume doesn't support. Do not award credit
for vague, unevidenced claims. Prioritize demonstrated accomplishments
over years of experience alone.

Before listing something as a gap, ask: is this capability actually
required by the model, or is it terminology/tooling that isn't itself
the qualification? Do not list the mere absence of a specific term as a
gap when the resume shows comparable underlying experience through
different language. Reserve gaps for genuinely missing, required
capabilities — not vocabulary mismatches.

A resume is incomplete evidence of a person's actual capability —
silence on a topic is not proof the candidate lacks it. Distinguish two
situations and treat them differently:
  - The resume actively shows the candidate lacks something or
    contradicts a requirement — that is a genuine gap.
  - The resume simply doesn't address something the model asks about —
    that is an open question, not a deficiency. Do not score it as a
    penalty or state it with the confidence of a real gap. Say plainly
    that it isn't addressed in the resume, and route it to
    interview_recommendations.probe_areas instead of gaps or risk_flags.
You are assessing what the paper shows, not rendering a verdict on the
whole person — the recruiter and hiring team make that call after
actually meeting the candidate. When evidence is genuinely inconclusive,
say so rather than resolving the ambiguity toward the negative.

Employment history review:
- Flag any employer in the provided watch-list (may be empty).
- Flag employment gaps exceeding 12 months, with approximate dates.
- Flag roles under 1 year, EXCLUDING contract/temp/internship/
  seasonal/volunteer/consulting — note whether the pattern looks
  isolated or recurring.

Strategic risk flags: inflated titles, unsubstantiated leadership
claims, domain mismatch, instability, lack of measurable
accomplishments. State these objectively — do not speculate beyond what
the resume shows.

If the uploaded document is not a resume (e.g. a bank statement, a
cover letter with no work history, an unrelated file), set
document_type to "non_resume" and leave scoring fields at 0 — do not
attempt to evaluate it as a candidate.

Keep every text field to plain prose with no line breaks inside a
single field — use separate array entries instead of embedding newlines
within one string.

"status" thresholds apply to overall_match (the Hiring Profile Match):
>= 85 -> "greenlight"; 69-84 -> "consider"; <= 68 -> "decline". These
are signals for the matrix, not a hiring recommendation — never use
language like "Recommend Interview" anywhere in the output; that
decision belongs to the human reviewer.
`.trim();

// Forcing output through a tool call (rather than asking the model to
// write JSON as free text) guarantees well-formed, schema-conforming
// output every time — no more parse failures from stray formatting,
// markdown fences, or unescaped characters in free text.
export const EVALUATION_TOOL = {
  name: 'submit_evaluation',
  description: 'Submit the structured evaluation of a candidate resume against the current Hiring Decision Model.',
  input_schema: {
    type: 'object' as const,
    properties: {
      candidate_name: { type: 'string' },
      document_type: { type: 'string', enum: ['resume', 'non_resume'] },
      overall_match: { type: 'number', description: 'Match against the current Hiring Decision Model' },
      job_description_match: { type: 'number', description: 'Match against the original job description alone' },
      status: { type: 'string', enum: ['greenlight', 'consider', 'decline'] },
      category_scores: {
        type: 'array',
        description: 'One entry per Hiring Decision Model category that has subcriteria',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            weight: { type: 'number' },
            points_earned: { type: 'number' },
            points_available: { type: 'number' }
          },
          required: ['name', 'weight', 'points_earned', 'points_available']
        }
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
      gaps: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Only genuine gaps the resume actively shows or contradicts — never something the resume simply does not mention. Unaddressed-but-unknown items belong in interview_recommendations.probe_areas instead.'
      },
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
      risk_flags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Objective, resume-evidenced concerns only — not speculation about what the resume happens not to cover.'
      },
      interview_recommendations: {
        type: 'object',
        properties: {
          probe_areas: {
            type: 'array',
            items: { type: 'string' },
            description: 'Open questions the resume left unaddressed — the right home for anything ambiguous rather than treating it as a scored deficiency.'
          },
          skills_to_validate: { type: 'array', items: { type: 'string' } },
          org_value: { type: 'string' },
          alternate_roles: { type: 'array', items: { type: 'string' } }
        }
      },
      matrix_dimensions: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'One entry per subcriterion in the current Hiring Decision Model, e.g. {"Change Management": "Strong - led three ERP rollouts..."}. Keys must match subcriterion names exactly.'
      },
      resume_gap_flag: {
        type: 'string',
        description: 'Short, specific description of what significant, current-fit-relevant information is missing from the resume itself, established only via additional context. Omit if not applicable.'
      },
      context_assessment: {
        type: 'object',
        description: 'Only include when additional candidate context was provided and materially affected this evaluation. Omit entirely otherwise.',
        properties: {
          newly_established: { type: 'array', items: { type: 'string' } },
          strengthened: { type: 'array', items: { type: 'string' } },
          still_unverified: { type: 'array', items: { type: 'string' } },
          new_concerns: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    required: [
      'candidate_name',
      'document_type',
      'overall_match',
      'job_description_match',
      'status',
      'signals',
      'strengths',
      'gaps',
      'risk_flags'
    ]
  }
};

export function buildEvaluationUserMessage(params: {
  jobDescription: string;
  hiringProfile: unknown;
  employerWatchlist: string[];
  additionalContext?: string | null;
  resumeText: string;
}): string {
  return JSON.stringify({
    job_description: params.jobDescription,
    hiring_decision_model: params.hiringProfile ?? null,
    employer_watchlist: params.employerWatchlist,
    additional_candidate_context: params.additionalContext || null,
    resume_text: params.resumeText
  });
}
