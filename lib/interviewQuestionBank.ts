import { PHONE_SCREEN_ALL_QUESTIONS, type PhoneScreenResponseSpec } from './phoneScreenQuestions.ts';

export const AREAS_OF_EVALUATION = [
  'Adaptability','Budget','Communication','Computer Skills','Conflict Management','Customer Service','Decision Making','Dependability','Employee Development','Employee Management','Ethics','Initiative','Innovation','Interpersonal Skills','Job Knowledge','Leadership','Organizational Skills','Problem Solving','Product Expertise','Productivity','Project Management','Quality','Results Driven','Sales Goals','Sales Skills','Self-Development','Sense of Urgency','Strategic Thought','Teamwork','Technical Skills'
] as const;

export type InterviewStageId = 'phone-screen' | 'round-1' | 'round-2' | 'final';

export type BankQuestion = {
  id: string;
  stage: InterviewStageId;
  text: string;
  areas: string[];
  // Populated only for phone-screen entries, carried through from the
  // one canonical source (lib/phoneScreenQuestions.ts) so any consumer
  // of this adapter can access the intended response semantics too, not
  // just the question text.
  response?: PhoneScreenResponseSpec;
  // The controlled organizational category used to group the Question
  // Bank into collapsible sections - distinct from cardTitle (the
  // compact header shown on the card) and from areas (Structured
  // Interview scoring metadata only, never used for grouping).
  questionType: string;
  cardTitle: string;
};

// tagline is the one-word purpose of each stage in the Selection
// Process (Qualify / Validate / Demonstrate / Differentiate) - shown
// alongside label wherever the four stages are presented as a set (the
// fixed stage tabs in InterviewPlan). label itself stays a standalone
// name (no tagline baked in) since it also renders alone as a fallback
// heading for existing, already-invited interviews
// (ParticipantInterviewPreview) that predate this naming.
export const INTERVIEW_STAGES: { id: InterviewStageId; label: string; shortLabel: string; tagline: string; description: string }[] = [
  { id: 'phone-screen', label: 'Phone Screen', shortLabel: 'Phone Screen', tagline: 'Qualify', description: 'Confirm minimum requirements, practical alignment, and whether the candidate should advance to an interview.' },
  { id: 'round-1', label: '1st Interview', shortLabel: '1st Interview', tagline: 'Validate', description: 'Establish whether the candidate has the relevant experience and foundational capability to perform the role.' },
  { id: 'round-2', label: '2nd Interview', shortLabel: '2nd Interview', tagline: 'Demonstrate', description: 'Explore how the candidate applies their skills when handling complexity, competing priorities, and collaboration.' },
  { id: 'final', label: '3rd Interview', shortLabel: '3rd Interview', tagline: 'Differentiate', description: 'Distinguish qualified finalists through judgment, leadership, strategic thinking, and potential organizational impact.' }
];

export function buildQuestionBank(positionTitle = 'this role'): BankQuestion[] {
  // phone-screen is not defined here - it is adapted from the one
  // canonical source (lib/phoneScreenQuestions.ts) below, preserving
  // that source's own ids so a bank question dragged through this
  // adapter (e.g. by the pre-production InterviewBuilder prototype) and
  // one added directly from InterviewQuestionBankPanel's Phone Screen
  // branch are recognized as the exact same question, not duplicates.
  // Each starter question's questionType is a one-time content-based
  // classification using the app's existing Structured Interview
  // Question Type vocabulary (lib/interviewQuestionTypes.ts) - these
  // fixed starters were never generated, so they carry no type of their
  // own; this assigns one so they group sensibly in the Question Bank
  // alongside AI-generated questions that do carry a selected type.
  const bank: Record<Exclude<InterviewStageId, 'phone-screen'>, Omit<BankQuestion, 'id' | 'stage'>[]> = {
    'round-1': [
      { text: 'Walk us through a recent responsibility that is similar to one of the core duties of this role. What was your personal contribution?', areas: ['Job Knowledge', 'Results Driven'], questionType: 'Background & Experience', cardTitle: 'Background & Experience' },
      { text: 'Tell us about a time you had to learn a new process, system, or body of information quickly.', areas: ['Adaptability', 'Computer Skills', 'Self-Development'], questionType: 'Behavioral', cardTitle: 'Behavioral' },
      { text: 'Describe a situation where you had to work with another team or partner to solve a problem.', areas: ['Teamwork', 'Communication', 'Problem Solving'], questionType: 'Behavioral', cardTitle: 'Behavioral' },
      { text: 'Tell us about a time you noticed a quality or service issue before someone asked you to address it.', areas: ['Initiative', 'Quality', 'Sense of Urgency'], questionType: 'Behavioral', cardTitle: 'Behavioral' },
      { text: 'How do you decide what needs your attention first when several important tasks compete at the same time?', areas: ['Decision Making', 'Organizational Skills', 'Productivity'], questionType: 'Problem-Solving', cardTitle: 'Problem-Solving' },
      { text: 'Describe a time you had to explain a complicated issue to someone who did not have your level of subject knowledge.', areas: ['Communication', 'Interpersonal Skills', 'Job Knowledge'], questionType: 'Behavioral', cardTitle: 'Behavioral' }
    ],
    'round-2': [
      { text: 'Tell us about a decision you made when the available information was incomplete. How did you work through it?', areas: ['Decision Making', 'Problem Solving', 'Strategic Thought'], questionType: 'Behavioral', cardTitle: 'Behavioral' },
      { text: 'Describe a disagreement with a colleague or stakeholder that you had to work through without damaging the relationship.', areas: ['Conflict Management', 'Communication', 'Interpersonal Skills'], questionType: 'Behavioral', cardTitle: 'Behavioral' },
      { text: 'Give us an example of a time you had to balance speed, quality, and competing expectations.', areas: ['Quality', 'Results Driven', 'Sense of Urgency'], questionType: 'Behavioral', cardTitle: 'Behavioral' },
      { text: 'Tell us about a time you guided, supported, or influenced someone even when you were not their formal supervisor.', areas: ['Leadership', 'Employee Development', 'Teamwork'], questionType: 'Leadership', cardTitle: 'Leadership' },
      { text: 'What is an example of a process you improved, and how did you know the change was working?', areas: ['Innovation', 'Project Management', 'Results Driven'], questionType: 'Behavioral', cardTitle: 'Behavioral' },
      { text: 'Describe a situation where the obvious solution was not the best solution. What did you do instead?', areas: ['Problem Solving', 'Decision Making', 'Innovation'], questionType: 'Problem-Solving', cardTitle: 'Problem-Solving' }
    ],
    'final': [
      { text: `What would success in the ${positionTitle} role look like to you after the first six months?`, areas: ['Job Knowledge', 'Results Driven', 'Strategic Thought'], questionType: 'Career Goals', cardTitle: 'Career Goals' },
      { text: 'Tell us about a professional judgment call you would handle differently today and what changed your thinking.', areas: ['Decision Making', 'Self-Development', 'Ethics'], questionType: 'Values & Ethics', cardTitle: 'Values & Ethics' },
      { text: 'Describe the working environment and leadership style that consistently brings out your best work.', areas: ['Interpersonal Skills', 'Dependability', 'Teamwork'], questionType: 'Culture & Work Style', cardTitle: 'Culture & Work Style' },
      { text: 'What responsibility in this role do you expect to be the biggest stretch, and how would you prepare for it?', areas: ['Adaptability', 'Self-Development', 'Job Knowledge'], questionType: 'Career Goals', cardTitle: 'Career Goals' },
      { text: 'If selected, what would you want to understand during your first 30 days before making significant changes?', areas: ['Strategic Thought', 'Job Knowledge', 'Decision Making'], questionType: 'Situational', cardTitle: 'Situational' },
      { text: 'What is one professional standard you will not compromise even when the pressure is high?', areas: ['Ethics', 'Quality', 'Dependability'], questionType: 'Values & Ethics', cardTitle: 'Values & Ethics' }
    ]
  };

  const phoneScreenEntries: BankQuestion[] = PHONE_SCREEN_ALL_QUESTIONS.map((seed) => ({
    id: seed.id,
    stage: 'phone-screen',
    text: seed.text,
    areas: [],
    response: seed.response,
    questionType: seed.questionType,
    cardTitle: seed.cardTitle
  }));

  const structuredEntries: BankQuestion[] = (Object.keys(bank) as Exclude<InterviewStageId, 'phone-screen'>[])
    .flatMap((stageId) => bank[stageId].map((question, index) => ({
      ...question,
      id: `${stageId}-${index + 1}`,
      stage: stageId
    })));

  return [...phoneScreenEntries, ...structuredEntries];
}
