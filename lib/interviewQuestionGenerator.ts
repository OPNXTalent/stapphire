import 'server-only';
import OpenAI from 'openai';
import type { EvaluationBasis } from './evaluationBasis';

const MODEL = process.env.OPENAI_EVALUATION_MODEL || 'gpt-5.6';

export type GeneratedInterviewQuestion = {
  id: string;
  text: string;
  areas: string[];
};

function schemaForAreas(availableAreas: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        minItems: 5,
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'areas'],
          properties: {
            text: { type: 'string', minLength: 10, maxLength: 700 },
            areas: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              uniqueItems: true,
              items: { type: 'string', enum: availableAreas }
            }
          }
        }
      }
    }
  } as const;
}

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  return new OpenAI({ apiKey });
}

function criteriaText(basis: EvaluationBasis) {
  if (basis.basisType !== 'hiring_criteria') return 'No applied Hiring Criteria snapshot is available. Use the Job Description as the authoritative role context.';
  return basis.criteria.map((criterion) => `${criterion.label} (${criterion.category}, ${criterion.appliedWeight}%${criterion.isKnockout ? ', knockout' : ''})`).join('\n');
}

export async function generateInterviewQuestions({
  basis,
  selectedAreas,
  existingQuestions,
  availableAreas
}: {
  basis: EvaluationBasis;
  selectedAreas: string[];
  existingQuestions: string[];
  availableAreas: string[];
}): Promise<GeneratedInterviewQuestion[]> {
  if (availableAreas.length === 0) throw new Error('No Areas of Evaluation are available.');

  const requestedAreas = selectedAreas.length > 0
    ? `The recruiter specifically selected these Areas of Evaluation: ${selectedAreas.join(', ')}. Every generated question must assess at least one selected area, and the batch should distribute attention intelligently across them.`
    : `The recruiter selected no Areas of Evaluation. Identify meaningful coverage gaps from the role context and existing questions, then choose the most useful Areas of Evaluation for the five new questions.`;

  const response = await client().responses.create({
    model: MODEL,
    instructions: `You design structured employment interview questions for recruiters. Generate exactly five NEW, practical, job-related questions. Use behavioral or situational wording when useful. Avoid trivia, generic filler, illegal or protected-class topics, and duplicate or near-duplicate questions. Tag each question with one to four Areas of Evaluation from the supplied available list. Do not assign an area unless the question can actually produce evidence for it. Custom Areas of Evaluation are organization-defined and should be treated as first-class assessment categories when relevant.`,
    input: `JOB DESCRIPTION\n${basis.jobDescriptionSnapshot}\n\nHIRING CRITERIA\n${criteriaText(basis)}\n\nAVAILABLE AREAS OF EVALUATION\n${availableAreas.join(', ')}\n\nREQUEST\n${requestedAreas}\n\nQUESTIONS ALREADY AVAILABLE OR IN USE\n${existingQuestions.length ? existingQuestions.map((question, index) => `${index + 1}. ${question}`).join('\n') : 'None'}`,
    max_output_tokens: 4000,
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'interview_questions',
        strict: true,
        schema: schemaForAreas(availableAreas)
      }
    }
  });

  const outputText = response.output_text?.trim();
  if (response.status !== 'completed' || response.incomplete_details || !outputText) {
    const reason = response.incomplete_details?.reason || response.status || 'empty_output';
    throw new Error(`Interview question generation was incomplete (${reason}).`);
  }

  let parsed: { questions?: Array<{ text?: string; areas?: string[] }> };
  try {
    parsed = JSON.parse(outputText) as { questions?: Array<{ text?: string; areas?: string[] }> };
  } catch {
    throw new Error('Interview question generation returned malformed structured output.');
  }
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== 5) throw new Error('AI did not return five interview questions.');

  const questions = parsed.questions.map((question) => ({
    id: `ai-${crypto.randomUUID()}`,
    text: String(question.text || '').trim(),
    areas: Array.isArray(question.areas) ? question.areas : []
  }));
  if (questions.some((question) => !question.text || question.areas.length === 0)) {
    throw new Error('Interview question generation returned incomplete question data.');
  }
  return questions;
}
