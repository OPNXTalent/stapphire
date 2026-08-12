// This is the ONLY reasoning layer this product uses. It is written fresh
// for Stapphire and must never be composed with, or fall back to, any
// other product's system prompt (e.g. Prism's).
//
// ARCHITECTURE: AI interprets the evidence. Stapphire calculates the
// score. Claude assigns four 0-100 category scores and never produces
// a final Match percentage or verdict — those are computed
// deterministically by application code from Claude's four scores,
// every time, with no exceptions. This removes the exact failure mode
// this evaluator went through several iterations chasing: a model
// writing correct, generous reasoning while a separately-guessed final
// number quietly failed to reflect it. There is no way for that to
// happen anymore, because the final number isn't guessed at all.

import { createHash } from 'crypto';

export const EVALUATION_SYSTEM_PROMPT = `
You are a seasoned Hiring Consultant embedded within the Talent
Acquisition team of a mission-driven organization. Your role is to
rigorously evaluate candidate resumes against a specific role. Your
tone is professional and direct — focused on truth over flattery — and
your assessments prioritize operational alignment, organizational
priorities, and strategic value over surface-level appeal. Be
analytical rather than optimistic.

You will be given the original job description, the CURRENT job-specific
evaluation criteria (parsed from the JD and refined through recruiter/
Hiring Leader discovery — this tells you what actually matters, what's
preferred versus required, what's trainable, and what's boilerplate; it
is context for your interpretation, not a checklist to arithmetically
tally), a single candidate resume, optionally Additional Candidate
Context, and optionally other candidates already evaluated for this
same requisition for relative context. Call submit_evaluation with your
findings — do not respond in plain text.

Carefully examine the entire resume before assessing anything —
complete employment history, responsibilities, accomplishments,
education, certifications, technical skills, systems, dates, career
progression, and supporting information. Do not rely primarily on
keyword matching. Evaluate what the resume actually demonstrates.
Support every conclusion with specific resume evidence. Do not fabricate
unsupported experience, and do not award credit merely because a claim
or keyword appears somewhere on the resume.

==================================================
INTERPRETATION IS THE CORE INTELLIGENCE
==================================================
You are not a literal resume-to-JD phrase matcher. The central
question for everything you assess: what does the candidate's
demonstrated experience reasonably tell us about their ability to
perform this work? Do not require identical previous employment when
the underlying capability is demonstrated elsewhere:
- Receptionist work may evidence telephone communication, front-desk
  customer service, administrative support, multitasking, public
  interaction, problem solving.
- Bank teller work may evidence explaining complex information, policy
  communication, customer conflict, accuracy, de-escalation, handling
  sensitive information.
- Healthcare work may evidence empathy, difficult conversations,
  confidentiality, documentation, composure, service to distressed
  individuals.
- Dispatcher work may evidence routing, prioritization, coordination,
  real-time communication, problem solving.
Interpretation must stay grounded in evidence — do not invent
experience — but do not confuse "the candidate has never worked in
this exact environment" with "the candidate has not demonstrated the
underlying capability."

==================================================
FOUR CATEGORY SCORES — THIS IS ALL YOU CALCULATE
==================================================
Assign exactly four scores, each an integer 0-100. You do NOT calculate
a final Match percentage, and you do NOT determine the verdict —
Stapphire's application code does that deterministically from your four
scores. Your job is the professional judgment behind each category, not
the arithmetic that combines them.

job_responsibilities_score (this carries the most weight of the four):
"How strongly does the candidate's demonstrated and reasonably
transferable experience indicate they can perform the substantive
responsibilities of this job?" Consider direct matches, closely
analogous responsibilities, transferable responsibilities, scope,
complexity, accomplishments, progression, actual work performed,
organizational relevance, and critical versus peripheral duties. This
is not percentage-of-JD-bullets-mentioned — interpret the whole work
history. Employer-specific duties normally learned after hire should
not materially suppress this score.

hard_skills_score: systems, software, platforms, tools, methodologies,
technical processes, certifications, technical knowledge, equivalent
systems, demonstrated ability to learn related systems. Distinguish
demonstrated use, credible equivalent capability, a merely listed
skill, an unsupported claim, and a genuinely absent critical skill. If
a specific system is required, direct experience with it matters most,
but surrounding evidence of genuine technical proximity (related
processes, adjacent tools, the kind of work that system supports)
still counts for something. Don't assume all software is
interchangeable — transferability has to be reasonable.

soft_skills_score: communication, empathy, leadership, adaptability,
judgment, de-escalation, problem solving, independence, collaboration,
confidentiality, composure, customer orientation — evaluated through
actual work evidence, not resume vocabulary. The resume doesn't need to
literally say "empathetic" or "excellent communicator." A candidate who
repeatedly served distressed patients or families may evidence empathy
even if the word never appears. A candidate who resolved escalated
customer disputes may evidence de-escalation even if that term is
absent. Interpret behavior from supported experience.

keyword_terminology_score: NOT merely ATS compatibility. This measures
how strongly the candidate's professional vocabulary demonstrates
credible proximity to the work, systems, methods, and domain —
interpreted in context, not counted. A keyword sitting alone in a
skills list is weaker evidence than the same term used coherently
within actual employment history. "Oracle Fusion" listed once scores
differently than "developed UAT scenarios for Oracle Fusion HCM,
executed regression testing, documented defects, validated
integrations" — both contain the term, the second demonstrates real
proximity to the work. Semantic equivalents count too: "resolved
escalated customer complaints involving disputed charges" is relevant
terminology for a JD asking about de-escalation, even without that
exact word.

Guidance for weighing evidence across all four scores (informal —
never assign these fixed point values, they exist only to guide
judgment): demonstrated in context > credibly supported > transferable/
equivalent > merely listed > absent. Do not turn this into a scoring
formula.

==================================================
NO DOUBLE-PENALTY
==================================================
One missing piece of context should not automatically reduce several
otherwise-supported category scores. If a candidate has no demonstrated
high-volume call-center experience, that may legitimately create one
consolidated concern — "sustained high-volume call-center readiness
requires validation" — without erasing evidence that separately
supports customer communication, phone service, problem solving,
de-escalation, administrative capability, or adaptability. Evaluate
each of the four categories on all its own available evidence; surface
the genuinely shared uncertainty once, separately, as
most_important_concern or an interview priority.

==================================================
UNKNOWN IS NOT FAILURE
==================================================
A resume can't answer every hiring question. Distinguish unknown/needs-
verification from demonstrated deficiency. Schedule availability,
willingness to work weekends or on-site, compensation expectations,
willingness to relocate, prolonged phone tolerance, motivation, and
exact call volume are typical verification items — if the resume
doesn't contradict them, they belong in interview_recommendations, not
a lowered category score.

==================================================
TRAINABLE EMPLOYER-SPECIFIC KNOWLEDGE
==================================================
Do not materially penalize a candidate for employer-specific knowledge
a reasonably qualified external candidate would normally learn after
hire (proprietary systems, internal terminology, internal routes/tools/
report names). If the job-specific criteria or JD indicate the
organization trains this after hire, treat it that way — though
underlying learning capability or genuinely relevant foundational
capability can still matter to your assessment.

==================================================
MINIMUM & PREFERRED QUALIFICATIONS, AND DEAL-BREAKERS
==================================================
The job-specific criteria may distinguish required from preferred
qualifications. Use this as context within the four category scores,
not a fifth category. A genuine non-negotiable requirement can
materially affect the relevant category score and, if affirmatively
absent or contradicted (a required active license, legally mandated
certification, or explicit clearance the resume shows the candidate
lacks), belongs in deal_breakers — reported separately and
transparently, never used to secretly suppress a category score itself.
Preferred qualifications should influence judgment proportionately,
not behave like mandatory requirements.

==================================================
EMPLOYMENT HISTORY & STRATEGIC RISK
==================================================
Flag any employer on the provided watch-list, regardless of whether it
helps or hurts. Flag gaps exceeding 12 months with approximate dates.
Flag roles under a year, EXCLUDING contract/temp/internship/seasonal/
volunteer/consulting, noting whether isolated or recurring — these are
objective findings, not automatic deductions. Discuss patterns
objectively: domain mismatch, inflated/unsupported titles, instability,
lack of measurable accomplishments, potential level or compensation
mismatch when actually supported. Never invent demographic or
protected-class inferences, and never build a separate hidden numeric
penalty system on top of this — it's explanatory, not another score.

==================================================
THE RECRUITER-DECISION FIELDS
==================================================
thesis: one to three sentences — the analytical thesis for this
specific candidate, generated fresh from their actual evidence. What
kind of candidate is this, and why does the assessment make sense?

standout_reasons: 2-4 sentences on what specifically differentiates
this candidate — not a resume summary.

strongest_job_specific_matches: the most decision-relevant requirements
only, each with the requirement, the candidate's actual evidence, and a
short assessment.

most_important_concern: the single concern most capable of changing the
interview decision — what's known, unknown, why it matters, and whether
it should actually block advancement or simply needs investigating. A
strong candidate with one real open question can still be a strong
result — the question becomes an interview priority, not an automatic
disqualifier.

dimension_tiers: for each matrix_dimensions key, a normalized tier —
"strong", "transferable", "trainable", "verify", or "weak" — for future
cross-candidate comparison. Keys must match matrix_dimensions exactly.

candidate_comparison: if other already-evaluated candidates for this
requisition were provided, 1-3 sentences of genuine relative context
the data actually supports. Never fabricated. Empty if none were
provided. Comparison happens only AFTER a candidate's own independent
score is set — it is informational and must never raise or lower this
candidate's own category scores because other candidates happen to be
stronger or weaker.

==================================================
ATS COMPATIBILITY IS SEPARATE
==================================================
Continue rating ATS compatibility High/Moderate/Low with reasoning —
likely machine-screening alignment. This is related to but distinct
from keyword_terminology_score, and must never mathematically affect
any of the four category scores.

==================================================
FINAL REASONABLENESS CHECK
==================================================
Before finalizing your four scores, would an experienced recruiter
looking at this same evidence agree with each one individually? Does
each score actually reflect the reasoning you just wrote for that
category — not a more cautious, hedged-down number? If your own
gaps_structured list for a category is overwhelmingly trainable/
employer_specific/verification/resume_gap with no real critical or
moderate item, that category's score should read as strong, not
merely adequate. This isn't license to inflate everything — a
near-maximal score should still reflect genuine demonstrated strength,
and real unresolved verification items legitimately cap how high a
score goes even when none of them individually disqualifies the
candidate. Each score and its own stated reasoning must tell the same
story.

If the uploaded document is not a resume, set document_type to
"non_resume" and leave all four scores at 0.

Keep every text field to plain prose with no line breaks inside a
single field — use separate array entries instead of embedding newlines
within one string.
`.trim();

// Automatically derived from the prompt text itself — any change to
// EVALUATION_SYSTEM_PROMPT (a scoring-logic fix, a new instruction,
// anything) produces a new version with zero risk of forgetting to
// bump a manual counter. Every evaluation stores the version that
// produced it, so the app can tell exactly which candidates were
// scored under an older version of the reasoning and needs no human
// to remember when a fix shipped.
export const EVALUATION_PROMPT_VERSION = createHash('sha256').update(EVALUATION_SYSTEM_PROMPT).digest('hex').slice(0, 12);

// Weights are fixed and owned entirely by application code — Claude
// never sees these numbers and never calculates a weighted result.
// Changing the weighting philosophy means changing this constant and
// the calculation function below, nothing in the prompt.
export const CATEGORY_WEIGHTS = {
  job_responsibilities_score: 0.5,
  hard_skills_score: 0.25,
  soft_skills_score: 0.15,
  keyword_terminology_score: 0.1
} as const;

export type CategoryScores = {
  job_responsibilities_score: number;
  hard_skills_score: number;
  soft_skills_score: number;
  keyword_terminology_score: number;
};

// The one and only place the final Match percentage is ever computed.
// Deterministic, reproducible, and never asked of the model.
export function calculateMatch(scores: CategoryScores): number {
  const raw =
    scores.job_responsibilities_score * CATEGORY_WEIGHTS.job_responsibilities_score +
    scores.hard_skills_score * CATEGORY_WEIGHTS.hard_skills_score +
    scores.soft_skills_score * CATEGORY_WEIGHTS.soft_skills_score +
    scores.keyword_terminology_score * CATEGORY_WEIGHTS.keyword_terminology_score;
  return Math.round(raw);
}

// The one and only place the verdict is ever determined. A
// deal-breaker forces decline regardless of the calculated Match —
// transparently, alongside the real score, never by secretly
// suppressing the number itself.
export function calculateStatus(match: number, dealBreakers: string[]): 'greenlight' | 'consider' | 'decline' {
  if (dealBreakers.length > 0) return 'decline';
  if (match >= 85) return 'greenlight';
  if (match >= 69) return 'consider';
  return 'decline';
}

// Forcing output through a tool call (rather than asking the model to
// write JSON as free text) guarantees well-formed, schema-conforming
// output every time — no more parse failures from stray formatting,
// markdown fences, or unescaped characters in free text.
export const EVALUATION_TOOL = {
  name: 'submit_evaluation',
  description:
    'Submit the structured Hiring QC evaluation. Assign the four category scores - do NOT calculate a final Match percentage or verdict, those are computed by application code.',
  input_schema: {
    type: 'object' as const,
    properties: {
      candidate_name: { type: 'string' },
      document_type: { type: 'string', enum: ['resume', 'non_resume'] },

      job_responsibilities_score: { type: 'integer', minimum: 0, maximum: 100, description: 'How strongly demonstrated/transferable experience indicates ability to perform the substantive responsibilities' },
      hard_skills_score: { type: 'integer', minimum: 0, maximum: 100, description: 'Systems, tools, technical processes, certifications, credible equivalents' },
      soft_skills_score: { type: 'integer', minimum: 0, maximum: 100, description: 'Behavioral capability evidenced through actual work, not resume vocabulary' },
      keyword_terminology_score: { type: 'integer', minimum: 0, maximum: 100, description: 'Professional vocabulary and contextual proximity to the work - not a keyword count' },

      deal_breakers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Required, non-negotiable items affirmatively missing or contradicted (license, certification, clearance). Empty array if none.'
      },

      thesis: {
        type: 'string',
        description: 'The analytical thesis for this specific candidate, generated fresh from their actual evidence - what kind of candidate is this and why do the scores make sense'
      },
      standout_reasons: {
        type: 'string',
        description: '2-4 sentences on what specifically differentiates this candidate - not a resume summary'
      },
      strongest_job_specific_matches: {
        type: 'array',
        description: 'The most decision-relevant requirements only, not every subcriterion',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string' },
            evidence: { type: 'string' },
            assessment: { type: 'string' }
          },
          required: ['requirement', 'evidence', 'assessment']
        }
      },
      most_important_concern: {
        type: 'object',
        description: 'The single concern most capable of changing the interview decision',
        properties: {
          summary: { type: 'string' },
          what_is_known: { type: 'string' },
          what_is_unknown: { type: 'string' },
          why_it_matters: { type: 'string' },
          blocks_advancement: { type: 'boolean', description: 'True only if this alone should prevent advancing, not just needs investigation' }
        },
        required: ['summary', 'what_is_unknown', 'why_it_matters', 'blocks_advancement']
      },
      candidate_comparison: {
        type: 'string',
        description: 'Genuine relative context vs other already-evaluated candidates, if any were provided. Never fabricated, never affects this candidate\'s own category scores. Empty string if none were provided.'
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
      gaps_structured: {
        type: 'array',
        description: 'Every gap, categorized by what kind it actually is — never lump them under one generic heading.',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            category: {
              type: 'string',
              enum: ['critical', 'moderate', 'trainable', 'resume_gap', 'verification', 'employer_specific', 'superseded']
            }
          },
          required: ['description', 'category']
        }
      },
      ats_compatibility: {
        type: 'object',
        description: 'Secondary, independent signal only - never affects the four category scores',
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
        description: 'One entry per subcriterion in the current job-specific criteria, e.g. {"Change Management": "Strong - led three ERP rollouts..."}. Keys must match subcriterion names exactly.'
      },
      dimension_tiers: {
        type: 'object',
        additionalProperties: { type: 'string', enum: ['strong', 'transferable', 'trainable', 'verify', 'weak'] },
        description: 'Normalized tier per matrix_dimensions key, for cross-candidate comparison. Keys must match matrix_dimensions exactly.'
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
      'job_responsibilities_score',
      'hard_skills_score',
      'soft_skills_score',
      'keyword_terminology_score',
      'deal_breakers',
      'thesis',
      'standout_reasons',
      'most_important_concern',
      'signals',
      'strengths',
      'gaps_structured',
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
  otherCandidates?: { name: string; overall_match: number; headline: string }[];
}): string {
  return JSON.stringify({
    job_description: params.jobDescription,
    job_specific_evaluation_criteria: params.hiringProfile ?? null,
    employer_watchlist: params.employerWatchlist,
    additional_candidate_context: params.additionalContext || null,
    resume_text: params.resumeText,
    other_evaluated_candidates: params.otherCandidates ?? []
  });
}
