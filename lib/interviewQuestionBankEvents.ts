import type { BankQuestion, InterviewStageId } from '@/lib/interviewQuestionBank';

export const INTERVIEW_BANK_ADD_EVENT = 'stapphire:interview-bank-add';
export const INTERVIEW_BUILDER_CONTEXT_EVENT = 'stapphire:interview-builder-context';
export const INTERVIEW_BANK_USED_EVENT = 'stapphire:interview-bank-used';
export const INTERVIEW_BANK_DRAG_MIME = 'application/x-stapphire-interview-question';

export type InterviewBankAddDetail = { question: BankQuestion };
export type InterviewBuilderContextDetail = { stage: InterviewStageId; positionTitle: string };
export type InterviewBankUsedDetail = { sourceIds: string[] };
