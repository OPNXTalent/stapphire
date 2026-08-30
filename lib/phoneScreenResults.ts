import type { InterviewRecommendation } from './interviewDecision.ts';

export type PhoneScreenAssessment = {
  recommendation: InterviewRecommendation;
  screenResponses?: Array<{ question: string; response: string; kind: 'yes-no' | 'written' }>;
  questionComments: Array<{ question: string; comment: string }>;
  yesNoResponses: Array<{ question: string; response: 'Yes' | 'No' }>;
};

export type PhoneScreenResponseSummary = {
  question: string;
  yes: number;
  no: number;
  writtenResponses: string[];
};

export function summarizePhoneScreenResponses(assessments: PhoneScreenAssessment[]): PhoneScreenResponseSummary[] {
  const byQuestion = new Map<string, PhoneScreenResponseSummary>();

  function responseFor(question: string) {
    const current = byQuestion.get(question);
    if (current) return current;
    const created = { question, yes: 0, no: 0, writtenResponses: [] };
    byQuestion.set(question, created);
    return created;
  }

  for (const assessment of assessments) {
    if (assessment.screenResponses) {
      for (const item of assessment.screenResponses) {
        const summary = responseFor(item.question);
        if (item.kind === 'yes-no' && item.response === 'Yes') summary.yes += 1;
        if (item.kind === 'yes-no' && item.response === 'No') summary.no += 1;
        if (item.kind === 'written' && item.response.trim()) summary.writtenResponses.push(item.response.trim());
      }
      continue;
    }
    for (const item of assessment.yesNoResponses) {
      const summary = responseFor(item.question);
      if (item.response === 'Yes') summary.yes += 1;
      if (item.response === 'No') summary.no += 1;
    }
    for (const item of assessment.questionComments) {
      const response = item.comment.trim();
      if (response) responseFor(item.question).writtenResponses.push(response);
    }
  }

  return Array.from(byQuestion.values());
}

export function phoneScreenResponseLabel(summary: PhoneScreenResponseSummary): string {
  const binaryCount = summary.yes + summary.no;
  const binary = binaryCount === 1
    ? (summary.yes === 1 ? 'Yes' : 'No')
    : [summary.yes > 0 ? `${summary.yes} Yes` : '', summary.no > 0 ? `${summary.no} No` : ''].filter(Boolean).join(' · ');
  const written = summary.writtenResponses.length === 1
    ? summary.writtenResponses[0]
    : summary.writtenResponses.length > 1 ? `${summary.writtenResponses.length} written responses` : '';
  return [binary, written].filter(Boolean).join(' · ') || 'No response';
}

export function summarizePhoneScreenRecommendation(recommendations: InterviewRecommendation[]) {
  const proceed = recommendations.filter((value) => value === 'Proceed').length;
  const decline = recommendations.filter((value) => value === 'Decline').length;
  const review = recommendations.filter((value) => value === 'Undecided - Need more information').length;
  const total = proceed + decline + review;
  const composition = [
    proceed > 0 ? `${proceed} Proceed` : '',
    decline > 0 ? `${decline} Decline` : '',
    review > 0 ? `${review} Needs Review` : ''
  ].filter(Boolean).join(' · ') || 'No recommendations submitted';

  if (total === 0) return { composition, label: 'Awaiting Recommendation' };
  if (proceed > decline && proceed > total / 2) return { composition, label: 'Advance to 1st Interview' };
  if (decline > proceed && decline > total / 2) return { composition, label: 'Do Not Advance' };
  return { composition, label: 'Review Required' };
}
