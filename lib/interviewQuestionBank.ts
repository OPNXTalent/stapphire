export const AREAS_OF_EVALUATION = [
  'Adaptability','Budget','Communication','Computer Skills','Conflict Management','Customer Service','Decision Making','Dependability','Employee Development','Employee Management','Ethics','Initiative','Innovation','Interpersonal Skills','Job Knowledge','Leadership','Organizational Skills','Problem Solving','Product Expertise','Productivity','Project Management','Quality','Results Driven','Sales Goals','Sales Skills','Self-Development','Sense of Urgency','Strategic Thought','Teamwork','Technical Skills'
] as const;

export type InterviewStageId = 'phone-screen' | 'round-1' | 'round-2' | 'final';

export type BankQuestion = {
  id: string;
  stage: InterviewStageId;
  text: string;
  areas: string[];
};

export const INTERVIEW_STAGES: { id: InterviewStageId; label: string; shortLabel: string; description: string }[] = [
  { id: 'phone-screen', label: 'Phone Screen', shortLabel: 'Phone Screen', description: 'Confirm baseline fit, motivation, communication, and obvious gaps before a formal interview.' },
  { id: 'round-1', label: 'Interview — Round 1', shortLabel: 'Round 1', description: 'Explore core duties, job knowledge, transferable experience, and behavioral evidence tied to the requisition.' },
  { id: 'round-2', label: 'Interview — Round 2', shortLabel: 'Round 2', description: 'Probe judgment, collaboration, leadership, problem solving, and deeper scenario-based evidence.' },
  { id: 'final', label: 'Final Interview', shortLabel: 'Final', description: 'Validate readiness, decision quality, role ownership, expectations, and remaining risk before a hiring decision.' }
];

export function buildQuestionBank(positionTitle = 'this role'): BankQuestion[] {
  const bank: Record<InterviewStageId, Omit<BankQuestion, 'id' | 'stage'>[]> = {
    'phone-screen': [
      { text: `What drew your attention to the ${positionTitle} role as a potential next step?`, areas: ['Communication', 'Job Knowledge'] },
      { text: 'Tell me about the experience in your background that feels most relevant to the day-to-day duties of this role.', areas: ['Job Knowledge', 'Communication'] },
      { text: 'How do you typically keep track of important issues, deadlines, or updates during your work?', areas: ['Organizational Skills', 'Dependability'] },
      { text: 'Tell me about a time a customer or coworker came to you with a difficult problem. What did you do?', areas: ['Customer Service', 'Problem Solving', 'Interpersonal Skills'] },
      { text: 'What systems, tools, or processes have you used to keep work moving accurately and on time?', areas: ['Computer Skills', 'Productivity', 'Quality'] },
      { text: 'What would you want us to understand about your background that may not be obvious from your resume?', areas: ['Communication', 'Job Knowledge', 'Self-Development'] }
    ],
    'round-1': [
      { text: 'Walk us through a recent responsibility that is similar to one of the core duties of this role. What was your personal contribution?', areas: ['Job Knowledge', 'Results Driven'] },
      { text: 'Tell us about a time you had to learn a new process, system, or body of information quickly.', areas: ['Adaptability', 'Computer Skills', 'Self-Development'] },
      { text: 'Describe a situation where you had to work with another team or partner to solve a problem.', areas: ['Teamwork', 'Communication', 'Problem Solving'] },
      { text: 'Tell us about a time you noticed a quality or service issue before someone asked you to address it.', areas: ['Initiative', 'Quality', 'Sense of Urgency'] },
      { text: 'How do you decide what needs your attention first when several important tasks compete at the same time?', areas: ['Decision Making', 'Organizational Skills', 'Productivity'] },
      { text: 'Describe a time you had to explain a complicated issue to someone who did not have your level of subject knowledge.', areas: ['Communication', 'Interpersonal Skills', 'Job Knowledge'] }
    ],
    'round-2': [
      { text: 'Tell us about a decision you made when the available information was incomplete. How did you work through it?', areas: ['Decision Making', 'Problem Solving', 'Strategic Thought'] },
      { text: 'Describe a disagreement with a colleague or stakeholder that you had to work through without damaging the relationship.', areas: ['Conflict Management', 'Communication', 'Interpersonal Skills'] },
      { text: 'Give us an example of a time you had to balance speed, quality, and competing expectations.', areas: ['Quality', 'Results Driven', 'Sense of Urgency'] },
      { text: 'Tell us about a time you guided, supported, or influenced someone even when you were not their formal supervisor.', areas: ['Leadership', 'Employee Development', 'Teamwork'] },
      { text: 'What is an example of a process you improved, and how did you know the change was working?', areas: ['Innovation', 'Project Management', 'Results Driven'] },
      { text: 'Describe a situation where the obvious solution was not the best solution. What did you do instead?', areas: ['Problem Solving', 'Decision Making', 'Innovation'] }
    ],
    'final': [
      { text: `What would success in the ${positionTitle} role look like to you after the first six months?`, areas: ['Job Knowledge', 'Results Driven', 'Strategic Thought'] },
      { text: 'Tell us about a professional judgment call you would handle differently today and what changed your thinking.', areas: ['Decision Making', 'Self-Development', 'Ethics'] },
      { text: 'Describe the working environment and leadership style that consistently brings out your best work.', areas: ['Interpersonal Skills', 'Dependability', 'Teamwork'] },
      { text: 'What responsibility in this role do you expect to be the biggest stretch, and how would you prepare for it?', areas: ['Adaptability', 'Self-Development', 'Job Knowledge'] },
      { text: 'If selected, what would you want to understand during your first 30 days before making significant changes?', areas: ['Strategic Thought', 'Job Knowledge', 'Decision Making'] },
      { text: 'What is one professional standard you will not compromise even when the pressure is high?', areas: ['Ethics', 'Quality', 'Dependability'] }
    ]
  };

  return INTERVIEW_STAGES.flatMap((stage) => bank[stage.id].map((question, index) => ({
    ...question,
    id: `${stage.id}-${index + 1}`,
    stage: stage.id
  })));
}
