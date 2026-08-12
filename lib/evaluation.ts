export type Verdict = 'greenlight' | 'consider' | 'decline';

export type StrongMatch = { requirement: string; evidence: string; assessment: string };
export type AtsCompatibility = { level: 'High' | 'Moderate' | 'Low'; reasoning: string };
export type EmploymentHistoryReview = {
  previous_transit_employer: string;
  gaps: string[];
  short_tenure: string[];
  stability: string;
};

export type ModelEvaluation = {
  candidate_name: string;
  job_responsibilities_score: number;
  hard_skills_score: number;
  soft_skills_score: number;
  keyword_terminology_score: number;
  assessment: string;
  standout_reasons: string[];
  strongest_matches: StrongMatch[];
  most_important_concern: string;
  what_to_verify: string[];
  trainable_after_hire: string[];
  ats_compatibility: AtsCompatibility;
  employment_history_review: EmploymentHistoryReview;
  strategic_risk: string;
  interview_priorities: string[];
  final_recommendation_reasoning: string;
  deal_breakers: string[];
};

export function calculateMatch(scores: Pick<ModelEvaluation,
  'job_responsibilities_score' | 'hard_skills_score' | 'soft_skills_score' | 'keyword_terminology_score'>) {
  return Math.round(
    scores.job_responsibilities_score * 0.5 +
    scores.hard_skills_score * 0.25 +
    scores.soft_skills_score * 0.15 +
    scores.keyword_terminology_score * 0.1
  );
}

export function calculateVerdict(match: number): Verdict {
  if (match >= 85) return 'greenlight';
  if (match >= 69) return 'consider';
  return 'decline';
}

export const verdictLabel: Record<Verdict, string> = {
  greenlight: 'Greenlight — Recommend Interview',
  consider: 'Consider — Hold / Clarify',
  decline: 'Decline'
};

