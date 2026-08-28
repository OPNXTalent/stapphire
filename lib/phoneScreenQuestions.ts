// Phone Screen's own compact qualification question set. Distinct from
// lib/interviewQuestionBank.ts's buildQuestionBank() 'phone-screen'
// entries, which remain the open-ended narrative questions used by the
// pre-production InterviewBuilder prototype and by
// ParticipantInterviewPreview's generic bank-driven fallback - neither
// touched here. These questions are qualification screening items:
// short, closed-form, meant to be answered in minutes, not narrative
// interview questions.

// The only two response shapes this pass supports. Both already map
// directly onto the existing, unchanged persistence contract
// (phase1_interview_questions.yes_no / comment_box) - a "short answer"
// question is stored exactly like a Structured Interview comment-box
// question, just rendered compactly instead of as a permanently visible
// textarea. No schema change, no new column.
export type PhoneScreenResponseType = 'yes-no' | 'short-answer';

export type PhoneScreenQuestionSeed = {
  id: string;
  text: string;
  responseType: PhoneScreenResponseType;
};

// Pre-loaded onto every new Phone Screen by default. Recruiters can
// edit, remove, and reorder each one - they are plain editable
// questions once placed, not bank-linked, so removing one does not
// return it anywhere; it is simply gone from the form (matching how a
// manually-typed question already behaves elsewhere in this builder).
export const PHONE_SCREEN_DEFAULT_QUESTIONS: PhoneScreenQuestionSeed[] = [
  { id: 'phone-screen-default-1', text: 'Are you within commuting distance of the work location, or prepared to relocate?', responseType: 'yes-no' },
  { id: 'phone-screen-default-2', text: 'Is the stated compensation range acceptable?', responseType: 'yes-no' },
  { id: 'phone-screen-default-3', text: 'How many years of applicable experience do you have?', responseType: 'short-answer' },
  { id: 'phone-screen-default-4', text: 'What is the highest degree you have completed?', responseType: 'short-answer' },
  { id: 'phone-screen-default-5', text: 'Are you currently authorized to work in the United States?', responseType: 'yes-no' },
  { id: 'phone-screen-default-6', text: 'Will you now or in the future require employer sponsorship to work in the United States?', responseType: 'yes-no' }
];

// The remaining suggested screening questions, offered from the
// Question Bank rather than pre-loaded. Dragged (or added) onto the
// Phone Screen the same way a Structured Interview bank question is -
// and, removed, they return here the same way too.
export const PHONE_SCREEN_BANK_QUESTIONS: PhoneScreenQuestionSeed[] = [
  { id: 'phone-screen-bank-1', text: 'Required schedule availability', responseType: 'short-answer' },
  { id: 'phone-screen-bank-2', text: 'Onsite, hybrid, or remote arrangement', responseType: 'short-answer' },
  { id: 'phone-screen-bank-3', text: 'Earliest start date', responseType: 'short-answer' },
  { id: 'phone-screen-bank-4', text: 'Employment-type acceptance', responseType: 'yes-no' },
  { id: 'phone-screen-bank-5', text: 'Travel requirements', responseType: 'yes-no' },
  { id: 'phone-screen-bank-6', text: 'Required licenses or certifications', responseType: 'yes-no' },
  { id: 'phone-screen-bank-7', text: 'Essential job functions', responseType: 'yes-no' },
  { id: 'phone-screen-bank-8', text: 'Highest level of education', responseType: 'short-answer' },
  { id: 'phone-screen-bank-9', text: 'Evening, weekend, holiday, overtime, split-shift, or on-call availability', responseType: 'yes-no' },
  { id: 'phone-screen-bank-10', text: 'Time-zone or coverage-hour requirements', responseType: 'short-answer' },
  { id: 'phone-screen-bank-11', text: 'Security-clearance requirements', responseType: 'yes-no' },
  { id: 'phone-screen-bank-12', text: 'Language proficiency', responseType: 'short-answer' },
  { id: 'phone-screen-bank-13', text: 'Portfolio or work sample', responseType: 'yes-no' },
  { id: 'phone-screen-bank-14', text: 'Required training availability', responseType: 'yes-no' }
];
