export const CANDIDATE_FILES_FOCUS_EVENT = 'stapphire:candidate-files-focus';
export const CANDIDATE_FILES_CLEAR_EVENT = 'stapphire:candidate-files-clear';

export type CandidateFilesSelection = {
  id: string;
  name: string;
  sourceFilename: string;
  resumeAvailable: boolean;
  // Every candidate belongs to exactly one requisition
  // (phase1_candidates.requisition_id) - required, not derived from the
  // current pathname, so WorkspacePanel has the correct requisition
  // context even on routes with no /requisitions/[id] segment of their
  // own (e.g. the completed-interview assessment view).
  requisitionId: string;
  // Optional: an interview invitation id that the Candidate Files panel
  // should default its Interviews folder open for and highlight, when
  // focus arrived from viewing that specific completed assessment.
  focusInterviewId?: string;
};
