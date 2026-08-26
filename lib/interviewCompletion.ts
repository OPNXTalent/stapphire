export type YesNoResponse = 'yes' | 'no';

export type InterviewResponseQuestion = {
  id: string;
  areas?: string[];
  commentBox?: boolean;
  yesNo?: boolean;
};

export type InterviewResponses = {
  ratings?: Record<string, unknown>;
  questionComments?: Record<string, unknown>;
  yesNoResponses?: Record<string, unknown>;
};

export function interviewRatingKey(questionId: string, area: string) {
  return `${questionId}:${area}`;
}

export function isValidRating(value: unknown) {
  const rating = Number(value);
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

export function isYesNoResponse(value: unknown): value is YesNoResponse {
  return value === 'yes' || value === 'no';
}

export function isQuestionComplete(question: InterviewResponseQuestion, responses: InterviewResponses) {
  const areas = question.areas ?? [];
  const ratingsComplete = areas.every((area) => isValidRating(responses.ratings?.[interviewRatingKey(question.id, area)]));
  const yesNoComplete = !question.yesNo || isYesNoResponse(responses.yesNoResponses?.[question.id]);
  const hasPrimaryControl = areas.length > 0 || Boolean(question.yesNo);
  const commentComplete = !question.commentBox || hasPrimaryControl || String(responses.questionComments?.[question.id] ?? '').trim().length > 0;
  return ratingsComplete && yesNoComplete && commentComplete;
}

export function interviewProgress(questions: InterviewResponseQuestion[], responses: InterviewResponses) {
  const ratingCount = questions.reduce((total, question) => total + (question.areas?.length ?? 0), 0);
  const completedRatingCount = questions.reduce((total, question) => total + (question.areas ?? []).filter((area) =>
    isValidRating(responses.ratings?.[interviewRatingKey(question.id, area)])
  ).length, 0);
  const completedQuestionCount = questions.filter((question) => isQuestionComplete(question, responses)).length;
  return {
    ratingCount,
    completedRatingCount,
    questionCount: questions.length,
    completedQuestionCount,
    complete: completedQuestionCount === questions.length
  };
}
