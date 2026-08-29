import 'server-only';
import OpenAI from 'openai';
import type { EvaluationBasis } from './evaluationBasis';
import { generatedQuestionId } from './generationRequestId';
import { INTERVIEW_QUESTION_TYPE_GUIDANCE, INTERVIEW_QUESTION_TYPES, isInterviewQuestionType, type InterviewQuestionType } from './interviewQuestionTypes';
import { PHONE_SCREEN_QUESTION_TYPES, type PhoneScreenQuestionType, type PhoneScreenResponseKind } from './phoneScreenQuestions';

const MODEL = process.env.OPENAI_EVALUATION_MODEL || 'gpt-5.6';

export type GeneratedInterviewQuestion = {
  id: string;
  text: string;
  areas: string[];
  // The model always returns a controlled Question Type - required so a
  // generated question is never categorized by guessing from its
  // wording after the fact, and so it groups correctly and survives
  // reload once placed on the form. Overridden server-side to the
  // recruiter's requested type when one was requested, guaranteeing
  // compliance regardless of the model's own echo.
  questionType: InterviewQuestionType;
};

const REAL_PHONE_SCREEN_TYPES = PHONE_SCREEN_QUESTION_TYPES.filter((type) => type !== 'Custom') as Exclude<PhoneScreenQuestionType, 'Custom'>[];
const RESPONSE_KINDS: PhoneScreenResponseKind[] = ['yes-no', 'yes-no-needs-discussion', 'single-choice', 'numeric', 'short-answer'];

export type GeneratedPhoneScreenQuestion = {
  id: string;
  text: string;
  questionType: Exclude<PhoneScreenQuestionType, 'Custom'>;
  responseKind: PhoneScreenResponseKind;
  responseOptions?: string[];
  responseUnit?: string;
};

function schemaForAreas(allowedAreas: string[]) {
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
          required: ['text', 'areas', 'questionType'],
          properties: {
            text: { type: 'string', minLength: 10, maxLength: 700 },
            areas: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: { type: 'string', enum: allowedAreas }
            },
            questionType: { type: 'string', enum: [...INTERVIEW_QUESTION_TYPES] }
          }
        }
      }
    }
  } as const;
}

function schemaForPhoneScreen() {
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
          required: ['text', 'questionType', 'responseKind', 'responseOptions', 'responseUnit'],
          properties: {
            text: { type: 'string', minLength: 5, maxLength: 300 },
            questionType: { type: 'string', enum: REAL_PHONE_SCREEN_TYPES },
            responseKind: { type: 'string', enum: RESPONSE_KINDS },
            // Structured outputs require every property to be listed,
            // so options/unit are always present but nullable - only
            // meaningful when responseKind is single-choice/numeric.
            responseOptions: { type: ['array', 'null'], items: { type: 'string', minLength: 1, maxLength: 60 }, minItems: 2, maxItems: 6 },
            responseUnit: { type: ['string', 'null'], maxLength: 30 }
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
  questionType,
  existingQuestions,
  availableAreas,
  requestId
}: {
  basis: EvaluationBasis;
  selectedAreas: string[];
  questionType: InterviewQuestionType | null;
  existingQuestions: string[];
  availableAreas: string[];
  requestId: string;
}): Promise<GeneratedInterviewQuestion[]> {
  if (availableAreas.length === 0) throw new Error('No Areas of Evaluation are available.');

  const allowedAreas = selectedAreas.length > 0 ? selectedAreas : availableAreas;
  const requestedAreas = selectedAreas.length > 0
    ? `The recruiter specifically selected these Areas of Evaluation: ${selectedAreas.join(', ')}. Every generated question must assess at least one selected area, and the batch should distribute attention intelligently across them. Tag questions only with the selected Areas of Evaluation.`
    : `The recruiter selected no Areas of Evaluation. Identify meaningful coverage gaps from the role context and existing questions, then choose the most useful Areas of Evaluation for the five new questions.`;

  const requestedType = questionType
    ? `The recruiter selected the Question Type “${questionType}”. All five questions must clearly fit this type. Guidance: ${INTERVIEW_QUESTION_TYPE_GUIDANCE[questionType]}`
    : 'The recruiter selected All Question Types. Choose the most useful mix of question structures for the role, selected Areas of Evaluation, Hiring Criteria, and uncovered interview needs.';

  const response = await client().responses.create({
    model: MODEL,
    instructions: `You design structured employment interview questions for recruiters. Generate exactly five NEW, practical, job-related questions. Respect the requested Question Type when one is supplied. Avoid trivia, generic filler, illegal or protected-class topics, and duplicate or near-duplicate questions. Tag each question with one to four Areas of Evaluation from the supplied allowed list. Do not repeat the same Area of Evaluation within a single question. Do not assign an area unless the question can actually produce evidence for it. Custom Areas of Evaluation are organization-defined and should be treated as first-class assessment categories when relevant.`,
    input: `JOB DESCRIPTION\n${basis.jobDescriptionSnapshot}\n\nHIRING CRITERIA\n${criteriaText(basis)}\n\nAVAILABLE AREAS OF EVALUATION\n${availableAreas.join(', ')}\n\nALLOWED AREAS FOR THIS BATCH\n${allowedAreas.join(', ')}\n\nAREA OF EVALUATION REQUEST\n${requestedAreas}\n\nQUESTION TYPE REQUEST\n${requestedType}\n\nQUESTIONS ALREADY AVAILABLE OR IN USE\n${existingQuestions.length ? existingQuestions.map((question, index) => `${index + 1}. ${question}`).join('\n') : 'None'}`,
    max_output_tokens: 4000,
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'interview_questions',
        strict: true,
        schema: schemaForAreas(allowedAreas)
      }
    }
  });

  const outputText = response.output_text?.trim();
  if (response.status !== 'completed' || response.incomplete_details || !outputText) {
    const reason = response.incomplete_details?.reason || response.status || 'empty_output';
    throw new Error(`Interview question generation was incomplete (${reason}).`);
  }

  let parsed: { questions?: Array<{ text?: string; areas?: string[]; questionType?: string }> };
  try {
    parsed = JSON.parse(outputText) as { questions?: Array<{ text?: string; areas?: string[]; questionType?: string }> };
  } catch {
    throw new Error('Interview question generation returned malformed structured output.');
  }
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== 5) throw new Error('AI did not return five interview questions.');

  const allowedAreaSet = new Set(allowedAreas);
  const selectedAreaSet = new Set(selectedAreas);
  // Server-side validation and normalization of the model's output - a
  // question is never classified by guessing from its wording after the
  // fact. When the recruiter requested a specific type, every question
  // is forced to that type regardless of what the model echoed, so
  // compliance never depends on the model's fidelity; for mixed
  // generation the model's own (schema-constrained, so always one of
  // the controlled vocabulary) choice is kept as-is.
  const questions: GeneratedInterviewQuestion[] = parsed.questions.map((question, index) => {
    if (!isInterviewQuestionType(question.questionType)) throw new Error('Interview question generation returned an invalid Question Type.');
    return {
      id: generatedQuestionId(requestId, index),
      text: String(question.text || '').trim(),
      areas: Array.isArray(question.areas) ? question.areas : [],
      questionType: questionType ?? question.questionType
    };
  });
  if (questions.some((question) => !question.text || question.areas.length === 0 || question.areas.some((area) => !allowedAreaSet.has(area)))) {
    throw new Error('Interview question generation returned incomplete or invalid question data.');
  }
  if (questions.some((question) => new Set(question.areas).size !== question.areas.length)) {
    throw new Error('Interview question generation returned duplicate Area of Evaluation tags.');
  }
  if (selectedAreas.length > 0 && questions.some((question) => !question.areas.some((area) => selectedAreaSet.has(area)))) {
    throw new Error('Interview question generation did not honor the selected Areas of Evaluation.');
  }
  return questions;
}

export async function generatePhoneScreenQuestions({
  basis,
  questionType,
  existingQuestions,
  requestId
}: {
  basis: EvaluationBasis;
  questionType: Exclude<PhoneScreenQuestionType, 'Custom'> | null;
  existingQuestions: string[];
  requestId: string;
}): Promise<GeneratedPhoneScreenQuestion[]> {
  const requestedType = questionType
    ? `The recruiter selected the Phone Screen Question Type "${questionType}". All five questions must be about that exact subject and carry that exact questionType.`
    : `The recruiter selected no specific Question Type. Choose the most useful mix of Phone Screen qualification subjects from the controlled list for this role.`;

  const response = await client().responses.create({
    model: MODEL,
    instructions: `You design short, closed-form Phone Screen qualification questions for recruiters - not open narrative interview questions. Generate exactly five NEW, practical, job-related questions, each one a quick qualifying check (location, compensation, experience, education, work authorization, availability, and similar logistics), never illegal or protected-class topics, never duplicates of existing questions. Every question must declare a controlled Question Type (the subject of the question, e.g. Location or Compensation - never a technical label like "Single choice" or "Numeric") and the response format needed to capture the answer (yes-no, yes-no-needs-discussion, single-choice with 2-6 concrete options, numeric with an optional unit, or short-answer). Only set responseOptions for single-choice and responseUnit for numeric; otherwise set them to null.`,
    input: `JOB DESCRIPTION\n${basis.jobDescriptionSnapshot}\n\nHIRING CRITERIA\n${criteriaText(basis)}\n\nQUESTION TYPE REQUEST\n${requestedType}\n\nQUESTIONS ALREADY AVAILABLE OR IN USE\n${existingQuestions.length ? existingQuestions.map((question, index) => `${index + 1}. ${question}`).join('\n') : 'None'}`,
    max_output_tokens: 3000,
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'phone_screen_questions',
        strict: true,
        schema: schemaForPhoneScreen()
      }
    }
  });

  const outputText = response.output_text?.trim();
  if (response.status !== 'completed' || response.incomplete_details || !outputText) {
    const reason = response.incomplete_details?.reason || response.status || 'empty_output';
    throw new Error(`Phone Screen question generation was incomplete (${reason}).`);
  }

  let parsed: { questions?: Array<{ text?: string; questionType?: string; responseKind?: string; responseOptions?: string[] | null; responseUnit?: string | null }> };
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error('Phone Screen question generation returned malformed structured output.');
  }
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== 5) throw new Error('AI did not return five Phone Screen questions.');

  const realTypeSet = new Set<string>(REAL_PHONE_SCREEN_TYPES);
  const kindSet = new Set<string>(RESPONSE_KINDS);
  const questions: GeneratedPhoneScreenQuestion[] = parsed.questions.map((question, index) => {
    if (typeof question.questionType !== 'string' || !realTypeSet.has(question.questionType)) throw new Error('Phone Screen question generation returned an invalid Question Type.');
    if (typeof question.responseKind !== 'string' || !kindSet.has(question.responseKind)) throw new Error('Phone Screen question generation returned an invalid response format.');
    const text = String(question.text || '').trim();
    if (!text) throw new Error('Phone Screen question generation returned an empty question.');
    const resolvedType = (questionType ?? question.questionType) as Exclude<PhoneScreenQuestionType, 'Custom'>;
    const resolvedKind = question.responseKind as PhoneScreenResponseKind;
    return {
      id: generatedQuestionId(requestId, index),
      text,
      questionType: resolvedType,
      responseKind: resolvedKind,
      ...(resolvedKind === 'single-choice' && Array.isArray(question.responseOptions) && question.responseOptions.length >= 2
        ? { responseOptions: question.responseOptions.map((option) => String(option).trim()).filter(Boolean) }
        : {}),
      ...(resolvedKind === 'numeric' && typeof question.responseUnit === 'string' && question.responseUnit.trim()
        ? { responseUnit: question.responseUnit.trim() }
        : {})
    };
  });
  if (questions.some((question) => question.responseKind === 'single-choice' && (!question.responseOptions || question.responseOptions.length < 2))) {
    throw new Error('Phone Screen question generation returned a single-choice question without valid options.');
  }
  return questions;
}
