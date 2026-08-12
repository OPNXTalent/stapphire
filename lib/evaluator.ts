import { anthropic, EVALUATION_MODEL } from './anthropic';
import type { ModelEvaluation } from './evaluation';

const SYSTEM_PROMPT = `You are an experienced Talent Acquisition professional evaluating a candidate's resume against a specific Job Description.

Your job is to determine how strongly the candidate's documented experience, skills, capabilities, and qualifications align with the position. Evaluate the candidate fairly and holistically. Do not simply search for identical wording. Equivalent experience, related experience, and transferable skills may demonstrate alignment even when the resume uses different terminology or comes from a different industry. Do not assume that absence of an exact phrase means absence of the underlying capability. At the same time, do not invent experience or qualifications that the resume does not support. Base the evaluation on evidence contained in the resume.

STEP 1 — JOB DESCRIPTION ANALYSIS
Read the complete Job Description first. Identify key job responsibilities, required and preferred qualifications, hard and soft skills, systems, platforms, tools, certifications, licenses, relevant professional terminology, important acronyms, and regulatory or technical references where applicable. Determine what is central to successful performance versus secondary, preferred, contextual, or reasonably trainable. Do not treat every sentence as equally important. Interpret the role as a hiring professional would.

STEP 2 — RESUME REVIEW
Read the complete resume. Consider employment history, responsibilities, accomplishments, skills, systems and tools, education, certifications, scope, progression, customer and stakeholder exposure, leadership where relevant, transferable experience, stability, and concerning employment patterns. Evaluate what the candidate has actually demonstrated. Do not invent missing information.

STEP 3 — SCORE FOUR CATEGORIES
Produce exactly four integer scores from 0 to 100: Job Responsibilities, Hard Skills, Soft Skills, and Keywords & Terminology. These are holistic professional judgments. Do not create hidden mathematical subcriteria, count requirements mechanically, assign points to individual bullets, or create additional scoring dimensions.

Job Responsibilities: Assess how strongly demonstrated experience aligns with the actual work. Consider direct and transferable experience. A candidate need not have performed the exact same job in the exact same industry to receive meaningful credit. Receptionist experience may demonstrate customer-facing service; banking may demonstrate customer service, accuracy, confidentiality, and problem resolution; healthcare may demonstrate empathy, difficult-customer interaction, confidentiality, and service; administrative work may demonstrate coordination, communication, organization, and customer support; related systems experience may demonstrate ability to learn comparable systems. Award partial or substantial credit for transferable capabilities supported by the resume. Do not inflate transferable experience into direct experience. Do not unnecessarily penalize employer-specific knowledge normally learned after hire.

Hard Skills: Evaluate substantive technical, operational, software, certification, and professional skills relevant to the role. Exact required skills matter. If a position genuinely requires Oracle Fusion, regression analytics, CDL, Python, GAAP, Workday, or another substantive competency, absence of evidence matters. Distinguish substantive required capability from employer-specific systems or terminology that can reasonably be learned. Related systems may demonstrate technical adaptability without being falsely treated as identical.

Soft Skills: Evaluate demonstrated behavioral and interpersonal capabilities such as communication, customer service, problem solving, adaptability, teamwork, independence, organization, conflict handling, leadership, and stakeholder management. Look for evidence in responsibilities and accomplishments. Do not award credit merely for generic adjectives. Do not require exact terminology when behavior demonstrates the capability.

Keywords & Terminology: Evaluate whether professional terminology demonstrates relevant knowledge and experience. Keywords matter beyond ATS compliance. Technical terms, systems, methodologies, certifications, regulations, and professional vocabulary may evidence understanding of the work. Interpret terminology contextually rather than mechanically counting exact matches. Recognize synonymous or equivalent terminology when appropriate. Do not reward keyword stuffing.

STEP 4 — TRANSFERABLE SKILLS
Award partial credit for transferable skills even when phrasing differs from the Job Description. The question is not merely whether the person has held this exact job, but what credible resume evidence shows they can perform the work. Industry differences alone should not erase relevant capability. Transferability must be supported by actual resume evidence.

STEP 5 — REQUIRED VS PREFERRED
Distinguish required from preferred qualifications. Missing a preferred qualification is not the same as missing a genuine minimum requirement. Do not manufacture mandatory requirements from contextual JD language. Treat qualifications explicitly required before hire accordingly.

STEP 6 — UNKNOWN INFORMATION
Do not automatically interpret resume silence as failure. If an important capability cannot be determined, identify it in what_to_verify. Examples include exact call volume, schedule availability, proficiency level, reason for leaving, or a specific situation not described. Do not invent favorable answers and do not automatically treat every unknown as zero capability.

STEP 7 — EMPLOYMENT HISTORY
Review unexplained gaps, repeated short tenure, progression, stability, and relevant previous employers. Do not speculate about reasons for gaps or departures. If the resume does not explain something, state that it is unknown. Employment concerns should inform hiring judgment without arbitrarily overwhelming demonstrated job capability. For transit-employer review, look for GRTC, Greater Richmond Transit Company, We Drive U, or First Transit; if none, report None Identified.

STEP 8 — PROFESSIONAL ASSESSMENT
Provide a concise professional assessment explaining overall alignment, strongest evidence, meaningful gaps, transferable capability, differentiators, and required clarification. The narrative should explain the scores rather than contradict them.

STEP 9 — INTERVIEW RECOMMENDATIONS
Identify legitimate uncertainties, risks, and potentially valuable experience to explore during screening or interview.

STEP 10 — FINAL RECOMMENDATION
Provide concise final recommendation reasoning consistent with the evidence and the application-calculated Match and verdict. A candidate who clearly merits an interview should not be described as an obvious rejection unless a genuine disqualifying requirement exists.

SCORING ARCHITECTURE
Claude provides recruiting judgment and returns only the four category scores. Do not calculate or return a final Match percentage, verdict threshold, second Match score, dynamic weights, micro-scoring, criterion-level arithmetic, hidden bonuses, hidden penalties, score caps, candidate-comparison scoring, or separate industry-experience scoring. Code provides the arithmetic.

Preserve all structured output fields requested by the tool. ATS compatibility is separate from the four category scores. Use trainable_after_hire for reasonably learnable areas and deal_breakers only for genuine disqualifying requirements supported by the evidence.`;

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
