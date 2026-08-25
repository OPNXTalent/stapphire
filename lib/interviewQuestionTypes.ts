export const INTERVIEW_QUESTION_TYPES = [
  'Icebreaker',
  'Background & Experience',
  'Motivational',
  'Behavioral',
  'Situational',
  'Technical',
  'Job Knowledge',
  'Problem-Solving',
  'Leadership',
  'Values & Ethics',
  'Culture & Work Style',
  'Career Goals',
  'Logistics & Availability',
  'Closing'
] as const;

export type InterviewQuestionType = typeof INTERVIEW_QUESTION_TYPES[number];

export const INTERVIEW_QUESTION_TYPE_GUIDANCE: Record<InterviewQuestionType, string> = {
  'Icebreaker': 'Use an accessible opening question that helps the candidate settle in while still producing role-relevant information.',
  'Background & Experience': 'Explore relevant prior responsibilities, accomplishments, environments, tools, or transferable experience.',
  'Motivational': 'Explore why the candidate wants the role, what draws them to the work, or what sustains their effort and interest.',
  'Behavioral': 'Ask for a concrete past example, typically using wording such as “Tell me about a time when…”.',
  'Situational': 'Present a plausible future work scenario and ask what the candidate would do or how they would respond.',
  'Technical': 'Test the ability to perform, explain, diagnose, or apply specialized work relevant to the role.',
  'Job Knowledge': 'Test understanding of the field, regulations, processes, standards, systems, or tools relevant to the role.',
  'Problem-Solving': 'Present a decision, scenario, case, or constraint that requires analysis, judgment, and a reasoned approach.',
  'Leadership': 'Explore how the candidate guides, influences, supports, develops, or makes decisions affecting others; formal management experience is not required unless the role requires it.',
  'Values & Ethics': 'Explore judgment, integrity, accountability, competing obligations, or ethical decision-making in job-relevant situations.',
  'Culture & Work Style': 'Explore working preferences, collaboration, pace, feedback, structure, or environment without screening for personal similarity or protected characteristics.',
  'Career Goals': 'Explore the candidate’s desired growth, direction, learning, or how this role fits their longer-term professional goals.',
  'Logistics & Availability': 'Ask only lawful, job-related questions about schedule, travel, start timing, location, or other genuine role logistics.',
  'Closing': 'Invite final relevant context, clarification, or information the candidate wants the interviewers to consider.'
};

export function isInterviewQuestionType(value: unknown): value is InterviewQuestionType {
  return typeof value === 'string' && (INTERVIEW_QUESTION_TYPES as readonly string[]).includes(value);
}
