import { anthropic, EVALUATION_MODEL } from './anthropic';
import type { ModelEvaluation } from './evaluation';

const SYSTEM_PROMPT = `You are a seasoned Hiring Consultant embedded in Talent Acquisition. Read the entire Job Description and resume before evaluating. Be analytical, direct, evidence-based, and interpret transferable capability rather than performing keyword matching. Do not invent experience. Different context is not lack of capability. Unknown interview questions belong in what_to_verify, not hidden score deductions. Employer-specific learnable knowledge belongs in trainable_after_hire. Do not double-penalize one concern. Preferred qualifications are not mandatory.

Score exactly four categories from 0 to 100: job responsibilities, hard skills, soft skills, and keyword/terminology relevance. Do not calculate or return a final match, verdict, or threshold. ATS compatibility is separate and does not affect scores. Flag unexplained employment gaps over 12 months and meaningful non-contract roles under one year. For transit-employer review, look for GRTC, Greater Richmond Transit Company, We Drive U, or First Transit. A deal-breaker must be an explicitly contradicted non-negotiable requirement, never an unknown.`;

const schema = {
  type: 'object', additionalProperties: false,
  required: ['candidate_name','job_responsibilities_score','hard_skills_score','soft_skills_score','keyword_terminology_score','assessment','standout_reasons','strongest_matches','most_important_concern','what_to_verify','trainable_after_hire','ats_compatibility','employment_history_review','strategic_risk','interview_priorities','final_recommendation_reasoning','deal_breakers'],
  properties: {
    candidate_name: { type: 'string' },
    job_responsibilities_score: { type: 'integer', minimum: 0, maximum: 100 },
    hard_skills_score: { type: 'integer', minimum: 0, maximum: 100 },
    soft_skills_score: { type: 'integer', minimum: 0, maximum: 100 },
    keyword_terminology_score: { type: 'integer', minimum: 0, maximum: 100 },
    assessment: { type: 'string' },
    standout_reasons: { type: 'array', items: { type: 'string' } },
    strongest_matches: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['requirement','evidence','assessment'], properties: { requirement: {type:'string'}, evidence: {type:'string'}, assessment: {type:'string'} } } },
    most_important_concern: { type: 'string' },
    what_to_verify: { type: 'array', items: { type: 'string' } },
    trainable_after_hire: { type: 'array', items: { type: 'string' } },
    ats_compatibility: { type: 'object', additionalProperties: false, required: ['level','reasoning'], properties: { level: {type:'string', enum:['High','Moderate','Low']}, reasoning: {type:'string'} } },
    employment_history_review: { type: 'object', additionalProperties: false, required: ['previous_transit_employer','gaps','short_tenure','stability'], properties: { previous_transit_employer:{type:'string'}, gaps:{type:'array',items:{type:'string'}}, short_tenure:{type:'array',items:{type:'string'}}, stability:{type:'string'} } },
    strategic_risk: { type: 'string' },
    interview_priorities: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    final_recommendation_reasoning: { type: 'string' },
    deal_breakers: { type: 'array', items: { type: 'string' } }
  }
} as const;

export async function evaluateCandidate(jobDescription: string, resumeText: string): Promise<ModelEvaluation> {
  const response = await anthropic.messages.create({
    model: EVALUATION_MODEL,
    max_tokens: 5000,
    system: SYSTEM_PROMPT,
    tools: [{ name: 'submit_candidate_evaluation', description: 'Submit the evidence-based candidate evaluation.', input_schema: schema }],
    tool_choice: { type: 'tool', name: 'submit_candidate_evaluation' },
    messages: [{ role: 'user', content: `JOB DESCRIPTION\n${jobDescription}\n\nCOMPLETE RESUME\n${resumeText}` }]
  });
  const block = response.content.find(item => item.type === 'tool_use');
  if (!block || block.type !== 'tool_use') throw new Error('Claude did not return a structured evaluation.');
  return block.input as ModelEvaluation;
}
