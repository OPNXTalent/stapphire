export type InterviewRecommendation = 'Proceed' | 'Decline' | 'Undecided - Need more information' | '';
export type SuggestedDecision = 'Advance' | 'Do Not Advance' | 'Discuss';

export type InterviewDecisionSummary = {
  inclined: number;
  notInclined: number;
  notSure: number;
  total: number;
  composition: string;
  decision: SuggestedDecision;
  label: string;
};

export function summarizeInterviewDecision(
  overall: number | null,
  recommendations: InterviewRecommendation[]
): InterviewDecisionSummary {
  const inclined = recommendations.filter((value) => value === 'Proceed').length;
  const notInclined = recommendations.filter((value) => value === 'Decline').length;
  const notSure = recommendations.filter((value) => value === 'Undecided - Need more information').length;
  const total = inclined + notInclined + notSure;
  const composition = [
    inclined > 0 ? `${inclined} Inclined` : '',
    notInclined > 0 ? `${notInclined} Not Inclined` : '',
    notSure > 0 ? `${notSure} Not Sure` : ''
  ].filter(Boolean).join(' · ') || 'No recommendations submitted';

  if (overall === null || total < 2) {
    return { inclined, notInclined, notSure, total, composition, decision: 'Discuss', label: 'Insufficient Panel Signal — Discuss' };
  }

  const lead = Math.abs(inclined - notInclined);
  const clearInclined = inclined > notInclined && inclined > total / 2 && lead >= 2;
  const clearNotInclined = notInclined > inclined && notInclined > total / 2 && lead >= 2;
  const scoreSupportsAdvance = overall >= 3;

  if (clearInclined && scoreSupportsAdvance) {
    return { inclined, notInclined, notSure, total, composition, decision: 'Advance', label: 'Advance' };
  }
  if (clearNotInclined && !scoreSupportsAdvance) {
    return { inclined, notInclined, notSure, total, composition, decision: 'Do Not Advance', label: 'Do Not Advance' };
  }
  if (inclined === notInclined || lead < 2) {
    return { inclined, notInclined, notSure, total, composition, decision: 'Discuss', label: 'Split Decision — Discuss' };
  }
  return { inclined, notInclined, notSure, total, composition, decision: 'Discuss', label: 'Mixed Evidence — Discuss' };
}
