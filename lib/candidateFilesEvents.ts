export const CANDIDATE_FILES_FOCUS_EVENT = 'stapphire:candidate-files-focus';
export const CANDIDATE_FILES_CLEAR_EVENT = 'stapphire:candidate-files-clear';

export type CandidateFilesSelection = {
  id: string;
  name: string;
  sourceFilename: string;
  resumeAvailable: boolean;
};
