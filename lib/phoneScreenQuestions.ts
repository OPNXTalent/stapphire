// The single canonical source of Phone Screen question content and its
// intended response semantics. Consumed directly by the Selection
// Process builder (InterviewPlan.tsx) and its Question Bank
// (InterviewQuestionBankPanel.tsx); consumed indirectly, through the
// adapter in lib/interviewQuestionBank.ts's buildQuestionBank(), by
// ParticipantInterviewPreview's generic fallback, the
// /interview/preview/[stage] route's fallback, and the pre-production
// InterviewBuilder prototype. No other module defines Phone Screen
// question text or response metadata.

// A Phone Screen question's response is one of five semantic kinds.
// This is a UI/view-model concept only - it is intentionally NOT the
// same thing as phase1_interview_questions' two persisted booleans
// (comment_box, yes_no). Only 'yes-no' and 'short-answer' have an
// exact, honest mapping onto those two flags today (see
// responseSpecToWireFlags below); the other three kinds are real
// semantic requirements that current persistence cannot faithfully
// represent, so they persist as neither flag set rather than being
// falsely narrowed into whichever flag is closest. Recovering them on
// reload works only for bank/default questions (looked up by id
// against this file - see cloneBankQuestion in InterviewPlan.tsx);
// a custom question's exact chosen kind is not yet round-trip safe,
// which is the deliberate, disclosed boundary of this UI-first pass.
export type PhoneScreenResponseSpec =
  | { kind: 'yes-no' }
  | { kind: 'yes-no-needs-discussion' }
  // qualifying: which options count as meeting the requirement (e.g.
  // Location's "Within commuting distance"/"Willing to relocate" qualify,
  // "Neither" does not). Optional persistable qualification-rule
  // metadata - only populated where a real qualify/disqualify split
  // applies; absent for a plain informational choice.
  | { kind: 'single-choice'; options: string[]; qualifying?: string[] }
  | { kind: 'numeric'; unit?: string }
  | { kind: 'short-answer' };

export type PhoneScreenResponseKind = PhoneScreenResponseSpec['kind'];

// The controlled organizational category used to group the Phone
// Screen Question Bank into collapsible sections. Distinct from
// cardTitle (the compact header shown on the card - for a built-in
// question the two happen to match, but they are never the same
// field) and distinct from Areas of Evaluation, which remain
// Structured-Interview-only scoring metadata and are never used for
// this grouping.
export const PHONE_SCREEN_QUESTION_TYPES = [
  'Location', 'Compensation', 'Experience', 'Education', 'Work Authorization', 'Sponsorship',
  'Availability', 'Schedule', 'Work Arrangement', 'Employment Type', 'Credentials', 'Travel',
  'Essential Functions', 'Security Clearance', 'Language', 'Work Sample', 'Training', 'Custom'
] as const;

export type PhoneScreenQuestionType = typeof PHONE_SCREEN_QUESTION_TYPES[number];

export type PhoneScreenQuestionSeed = {
  id: string;
  text: string;
  response: PhoneScreenResponseSpec;
  // Every canonical seed carries a real (non-Custom) type; 'Custom' is
  // reserved for recruiter-created questions, assigned in InterviewPlan.tsx.
  questionType: Exclude<PhoneScreenQuestionType, 'Custom'>;
  cardTitle: string;
};

const DEGREE_OPTIONS = ['High school diploma / GED', 'Associate degree', "Bachelor's degree", "Master's degree", 'Doctorate / professional degree'];

// Pre-loaded onto every new Phone Screen by default. Recruiters can
// edit, remove, and reorder each one - they are plain editable
// questions once placed, not bank-linked, so removing one does not
// return it anywhere; it is simply gone from the form (matching how a
// manually-typed question already behaves elsewhere in this builder).
export const PHONE_SCREEN_DEFAULT_QUESTIONS: PhoneScreenQuestionSeed[] = [
  {
    id: 'phone-screen-default-1',
    text: 'Are you within commuting distance of the work location, or prepared to relocate?',
    response: { kind: 'single-choice', options: ['Within commuting distance', 'Willing to relocate', 'Neither'], qualifying: ['Within commuting distance', 'Willing to relocate'] },
    questionType: 'Location',
    cardTitle: 'Location'
  },
  {
    id: 'phone-screen-default-2',
    text: 'Is the stated compensation range acceptable?',
    response: { kind: 'yes-no' },
    questionType: 'Compensation',
    cardTitle: 'Compensation'
  },
  {
    id: 'phone-screen-default-3',
    text: 'How many years of applicable experience do you have?',
    response: { kind: 'numeric', unit: 'years' },
    questionType: 'Experience',
    cardTitle: 'Experience'
  },
  {
    id: 'phone-screen-default-4',
    text: 'What is the highest degree you have completed?',
    response: { kind: 'single-choice', options: DEGREE_OPTIONS },
    questionType: 'Education',
    cardTitle: 'Education'
  },
  {
    id: 'phone-screen-default-5',
    text: 'Are you currently authorized to work in the United States?',
    response: { kind: 'yes-no' },
    questionType: 'Work Authorization',
    cardTitle: 'Work Authorization'
  },
  {
    id: 'phone-screen-default-6',
    text: 'Will you now or in the future require employer sponsorship to work in the United States?',
    response: { kind: 'yes-no' },
    questionType: 'Sponsorship',
    cardTitle: 'Sponsorship'
  }
];

// The remaining suggested screening questions, offered from the
// Question Bank rather than pre-loaded. Dragged (or added) onto the
// Phone Screen the same way a Structured Interview bank question is -
// and, removed, they return here the same way too.
export const PHONE_SCREEN_BANK_QUESTIONS: PhoneScreenQuestionSeed[] = [
  { id: 'phone-screen-bank-1', text: 'Required schedule availability', response: { kind: 'short-answer' }, questionType: 'Schedule', cardTitle: 'Schedule' },
  { id: 'phone-screen-bank-2', text: 'Onsite, hybrid, or remote arrangement', response: { kind: 'single-choice', options: ['Onsite', 'Hybrid', 'Remote'] }, questionType: 'Work Arrangement', cardTitle: 'Work Arrangement' },
  { id: 'phone-screen-bank-3', text: 'Earliest start date', response: { kind: 'short-answer' }, questionType: 'Availability', cardTitle: 'Availability' },
  { id: 'phone-screen-bank-4', text: 'Employment-type acceptance', response: { kind: 'yes-no' }, questionType: 'Employment Type', cardTitle: 'Employment Type' },
  { id: 'phone-screen-bank-5', text: 'Travel requirements', response: { kind: 'yes-no' }, questionType: 'Travel', cardTitle: 'Travel' },
  { id: 'phone-screen-bank-6', text: 'Required licenses or certifications', response: { kind: 'yes-no' }, questionType: 'Credentials', cardTitle: 'Credentials' },
  { id: 'phone-screen-bank-7', text: 'Essential job functions', response: { kind: 'yes-no' }, questionType: 'Essential Functions', cardTitle: 'Essential Functions' },
  { id: 'phone-screen-bank-8', text: 'Highest level of education', response: { kind: 'single-choice', options: DEGREE_OPTIONS }, questionType: 'Education', cardTitle: 'Education' },
  { id: 'phone-screen-bank-9', text: 'Evening, weekend, holiday, overtime, split-shift, or on-call availability', response: { kind: 'yes-no' }, questionType: 'Availability', cardTitle: 'Availability' },
  { id: 'phone-screen-bank-10', text: 'Time-zone or coverage-hour requirements', response: { kind: 'short-answer' }, questionType: 'Schedule', cardTitle: 'Schedule' },
  { id: 'phone-screen-bank-11', text: 'Security-clearance requirements', response: { kind: 'yes-no' }, questionType: 'Security Clearance', cardTitle: 'Security Clearance' },
  { id: 'phone-screen-bank-12', text: 'Language proficiency', response: { kind: 'short-answer' }, questionType: 'Language', cardTitle: 'Language' },
  { id: 'phone-screen-bank-13', text: 'Portfolio or work sample', response: { kind: 'yes-no' }, questionType: 'Work Sample', cardTitle: 'Work Sample' },
  { id: 'phone-screen-bank-14', text: 'Required training availability', response: { kind: 'yes-no' }, questionType: 'Training', cardTitle: 'Training' }
];

export const PHONE_SCREEN_ALL_QUESTIONS: PhoneScreenQuestionSeed[] = [...PHONE_SCREEN_DEFAULT_QUESTIONS, ...PHONE_SCREEN_BANK_QUESTIONS];

export function findPhoneScreenSeed(id: string): PhoneScreenQuestionSeed | undefined {
  return PHONE_SCREEN_ALL_QUESTIONS.find((seed) => seed.id === id);
}

// The one canonical template per real (non-Custom) Question Type - the
// coherent default package (wording + response control + choices/unit/
// qualifying rule) Question Type selection loads synchronously. Where a
// type has more than one canonical question (e.g. Education appears in
// both the defaults and the bank), the first match wins, deterministically.
export const PHONE_SCREEN_TEMPLATE_BY_TYPE: Partial<Record<Exclude<PhoneScreenQuestionType, 'Custom'>, PhoneScreenQuestionSeed>> = (() => {
  const byType: Partial<Record<Exclude<PhoneScreenQuestionType, 'Custom'>, PhoneScreenQuestionSeed>> = {};
  for (const seed of PHONE_SCREEN_ALL_QUESTIONS) {
    if (!byType[seed.questionType]) byType[seed.questionType] = seed;
  }
  return byType;
})();

// Question Type "doing real work": selecting a non-Custom type must
// synchronously load its whole coherent package (text, response,
// cardTitle). Custom has no template - the recruiter builds it manually.
// Returns undefined for Custom or a type with no canonical template.
export function templateForPhoneScreenType(type: string): PhoneScreenQuestionSeed | undefined {
  return PHONE_SCREEN_TEMPLATE_BY_TYPE[type as Exclude<PhoneScreenQuestionType, 'Custom'>];
}

// The only honest mapping onto the current two-boolean persistence
// shape. yes-no and short-answer have an exact match; the other three
// kinds persist as neither flag set - a truthful "not yet
// representable", not a guess at the closest existing flag.
export function responseSpecToWireFlags(response: PhoneScreenResponseSpec): { commentBox: boolean; yesNo: boolean } {
  if (response.kind === 'yes-no') return { commentBox: false, yesNo: true };
  if (response.kind === 'short-answer') return { commentBox: true, yesNo: false };
  return { commentBox: false, yesNo: false };
}

// The inverse, used only to reconstruct a response kind for a question
// with no sourceId (i.e. a custom question, whose exact chosen kind -
// beyond yes-no/short-answer - is not yet persisted). This can only
// ever recover 'yes-no' or 'short-answer'; it is not a general inverse
// of responseSpecToWireFlags.
export function wireFlagsToResponseSpec(flags: { commentBox: boolean; yesNo: boolean }): PhoneScreenResponseSpec {
  if (flags.yesNo) return { kind: 'yes-no' };
  return { kind: 'short-answer' };
}

// Sensible default spec when a recruiter switches a question's
// response-type selector to a new kind, preserving what can be
// preserved from whatever kind it was previously.
export function responseSpecForKind(kind: PhoneScreenResponseKind, previous?: PhoneScreenResponseSpec): PhoneScreenResponseSpec {
  if (kind === 'single-choice') {
    const priorChoice = previous?.kind === 'single-choice' ? previous : undefined;
    return { kind, options: priorChoice?.options ?? [], ...(priorChoice?.qualifying ? { qualifying: priorChoice.qualifying } : {}) };
  }
  if (kind === 'numeric') return { kind, unit: previous?.kind === 'numeric' ? previous.unit : undefined };
  if (kind === 'yes-no') return { kind };
  if (kind === 'yes-no-needs-discussion') return { kind };
  return { kind: 'short-answer' };
}

// Reconstructs a discriminated PhoneScreenResponseSpec from the flat
// kind/options/unit/qualifying parts persistence and generation both
// use on the wire. Shared by the plan loader (InterviewPlan.tsx) and
// the Question Bank panel so a question's exact response package - not
// just yes-no/short-answer - round-trips identically wherever it is
// reconstructed. An unrecognized kind falls back to short-answer, the
// same neutral default wireFlagsToResponseSpec uses when nothing more
// specific is known.
export function responseSpecFromParts(kind: string | undefined, options?: string[], unit?: string, qualifying?: string[]): PhoneScreenResponseSpec {
  switch (kind) {
    case 'single-choice':
      return { kind: 'single-choice', options: options ?? [], ...(qualifying && qualifying.length > 0 ? { qualifying } : {}) };
    case 'numeric':
      return { kind: 'numeric', ...(unit ? { unit } : {}) };
    case 'yes-no':
      return { kind: 'yes-no' };
    case 'yes-no-needs-discussion':
      return { kind: 'yes-no-needs-discussion' };
    case 'short-answer':
      return { kind: 'short-answer' };
    default:
      return { kind: 'short-answer' };
  }
}
