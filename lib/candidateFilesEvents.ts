export const CANDIDATE_FILES_FOCUS_EVENT = 'stapphire:candidate-files-focus';
export const CANDIDATE_FILES_CLEAR_EVENT = 'stapphire:candidate-files-clear';

export type CandidateFilesSelection = {
  id: string;
  name: string;
  sourceFilename: string;
  resumeAvailable: boolean;
  // Optional: an interview invitation id that the Candidate Files panel
  // should default its Interviews folder open for and highlight, when
  // focus arrived from viewing that specific completed assessment.
  focusInterviewId?: string;
};
