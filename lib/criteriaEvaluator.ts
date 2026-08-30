import OpenAI from 'openai';
import type { ModelEvaluation } from './evaluation';
import { candidateEvaluationSchema } from './evaluator';
import {
  buildNeutralCriterionFindingArraySchema,
  validateNeutralCriterionFindings,
  type AppliedCriterion,
} from './criteriaEvaluation';
import { type CriterionFinding } from './criterionProjection';

const EVALUATION_MODEL = process.env.OPENAI_EVALUATION_MODEL || 'gpt-5.6';
const MAX_OUTPUT_TOKENS = 16000;
export const CRITERIA_EVALUATION_PROMPT_SCHEMA_VERSION = 'criteria_evaluation_neutral_findings_v1';

type NarrativeEvaluation = Omit<ModelEvaluation, 'job_responsibilities_score' | 'hard_skills_score' | 'soft_skills_score' | 'keyword_terminology_score'>;
export type CriteriaAwareModelEvaluation = NarrativeEvaluation & {
  criterionFindings: CriterionFinding[];
};
export type CriteriaAwareModelResult = {
  evaluation: CriteriaAwareModelEvaluation;
  modelIdentifier: string;
};

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  return new OpenAI({ apiKey });
}

const { job_responsibilities_score: _responsibilities, hard_skills_score: _hardSkills, soft_skills_score: _softSkills, keyword_terminology_score: _keywords, ...narrativeProperties } = candidateEvaluationSchema.properties;
const narrativeRequired = candidateEvaluationSchema.required.filter((field) => !['job_responsibilities_score', 'hard_skills_score', 'soft_skills_score', 'keyword_terminology_score'].includes(field));

export function buildCriteriaEvaluationSchema(criteria: AppliedCriterion[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...narrativeRequired, 'criterionFindings'],
    properties: {
      ...narrativeProperties,
      criterionFindings: buildNeutralCriterionFindingArraySchema(criteria)
    }
  } as const;
}

const SYSTEM_PROMPT = `You are Stapphire's evidence-based candidate evaluator. Evaluate the complete resume against the exact immutable Hiring Criteria supplied by the application.

For every supplied criterion, return exactly one treatment-neutral finding. Populate both alignmentScore and satisfactionStatus regardless of the criterion's current treatment.

Use only this alignmentScore scale:
100 = strongly and directly demonstrated
75 = substantially demonstrated
50 = partially or transferably demonstrated
25 = limited supporting evidence
0 = no supporting evidence or conflicting evidence

Evaluate zero-weight non-knockout criteria too. Do not calculate Match, category totals, weights, or category rollups. Do not change criterion IDs, labels, categories, or weights.

Use exactly one satisfactionStatus for every criterion:
MET when the resume explicitly demonstrates it;
NOT_MET only when the resume explicitly contradicts it or clearly establishes it is not satisfied;
UNABLE_TO_DETERMINE when the resume is silent, ambiguous, outdated, or insufficient.
Absence of evidence is not NOT_MET. Knockouts are separate from Match.

Use only resume evidence. Treat grounded transferable evidence meaningfully, identify unknowns as items to verify, and do not invent experience. Return every supplied criterion exactly once and preserve the existing evidence-based narrative fields required by the schema. Do not make an employment disposition or hiring decision.`;

export async function evaluateCandidateAgainstCriteria(jobDescription: string, criteria: AppliedCriterion[], resumeText: string, evaluationBasisId: string): Promise<CriteriaAwareModelResult> {
  const openai = getOpenAIClient();
  const response = await openai.responses.create({
    model: EVALUATION_MODEL,
    instructions: SYSTEM_PROMPT,
    input: `CURRENT JOB DESCRIPTION SNAPSHOT\n${jobDescription}\n\nIMMUTABLE APPLIED HIRING CRITERIA\n${JSON.stringify(criteria)}\n\nCOMPLETE RESUME\n${resumeText}`,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
    text: { format: { type: 'json_schema', name: 'criteria_candidate_evaluation', strict: true, schema: buildCriteriaEvaluationSchema(criteria) } }
  });
  if (response.status !== 'completed' || response.incomplete_details) {
    const reason = response.incomplete_details?.reason || response.status || 'unknown';
    throw new Error(`OpenAI criteria evaluation was incomplete (${reason}). Please try again.`);
  }
  if (!response.output_text) throw new Error('OpenAI did not return a structured criteria evaluation.');
  let evaluation: CriteriaAwareModelEvaluation;
  try {
    evaluation = JSON.parse(response.output_text) as CriteriaAwareModelEvaluation;
  } catch {
    throw new Error('OpenAI returned an invalid structured criteria evaluation. Please try again.');
  }
  try {
    validateNeutralCriterionFindings(criteria, evaluation.criterionFindings);
  } catch (error) {
    console.error('Criteria evaluation validation failed', {
      failureType: error instanceof Error ? error.message : 'Unknown criteria validation failure.',
      evaluationBasisId,
      expectedCriterionIds: criteria.map((criterion) => criterion.id),
      returnedCriterionIds: Array.isArray(evaluation.criterionFindings) ? evaluation.criterionFindings.map((criterion) => criterion?.criterionId).filter((id): id is string => typeof id === 'string') : []
    });
    throw error;
  }
  return { evaluation, modelIdentifier: response.model };
}
