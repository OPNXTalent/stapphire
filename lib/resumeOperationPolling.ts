import type { OperationStatus } from './operationTypes';

// Pure target-resolution logic for the résumé-operation polling loop in
// ResumeUpload.tsx: given the operations currently visible in a poll
// response, decide what to do with whatever operation id the loop is
// currently targeting.
//
// "The target operation id is absent from the poll response" is
// ambiguous on its own - it could mean the operation has not been
// created/become visible yet (legitimate creation lag - keep waiting), or
// it could mean the operation existed and has since been permanently
// deleted. The durable duplicate-protection RPC does exactly that: an
// exact-content-hash duplicate's operation item is deleted outright, and
// the parent operation too once no items remain. Only the caller can
// resolve the ambiguity, from two independent, non-guessing kinds of
// proof:
//
//   - previouslyConfirmedPresent: a prior poll already observed this
//     exact target id in the list. If it is missing now, that is
//     unambiguous deletion, never lag.
//   - localBatchFullySettled: this exact target id belongs to a local
//     upload batch whose every item has already finished its own upload
//     attempt (accepted or rejected). By the time that is true, the
//     server has already durably applied whatever happened to each item
//     - including a duplicate rejection's delete - so "existed, then
//     vanished" needs no poll to have observed it first. This closes the
//     gap where the duplicate path deletes the operation before the very
//     first poll ever sees it.
//
// Neither piece of evidence is a guess or a timeout: both are proof the
// operation is gone, not merely not-yet-visible.
export type PollableOperation = { id: string; status: OperationStatus };

export type TargetResolution<T extends PollableOperation> =
  | { kind: 'found'; operation: T }
  | { kind: 'awaiting-creation' }
  | { kind: 'confirmed-deleted' };

export function resolveTargetOperation<T extends PollableOperation>(input: {
  targetId: string;
  operations: readonly T[];
  previouslyConfirmedPresent: boolean;
  localBatchFullySettled: boolean;
}): TargetResolution<T> {
  const operation = input.operations.find((candidate) => candidate.id === input.targetId) || null;
  if (operation) return { kind: 'found', operation };
  if (input.previouslyConfirmedPresent || input.localBatchFullySettled) return { kind: 'confirmed-deleted' };
  return { kind: 'awaiting-creation' };
}

// Full poll-target state machine, including the reconstruction rule: once
// a target has been resolved as confirmed-deleted, reconstruction (the
// "no known target - recover the latest durable operation" fallback,
// meant only for a fresh page load with nothing local to track yet) must
// not run afterward in its place. Otherwise the very next tick would
// attach the UI to whatever the newest operation happens to be for the
// requisition - a stale, entirely unrelated batch's progress rendered as
// if it were this one's.
export type PollTargetState = {
  targetId: string | null;
  confirmedTargetId: string | null;
  attemptedReconstruction: boolean;
};

export type PollTickResult<T extends PollableOperation> = {
  state: PollTargetState;
  found: T | null;
};

export function advancePollTarget<T extends PollableOperation>(
  state: PollTargetState,
  operations: readonly T[],
  options: { localBatchFullySettledId: string | null; isDismissed: (id: string) => boolean }
): PollTickResult<T> {
  if (state.targetId) {
    const resolution = resolveTargetOperation({
      targetId: state.targetId,
      operations,
      previouslyConfirmedPresent: state.confirmedTargetId === state.targetId,
      localBatchFullySettled: options.localBatchFullySettledId === state.targetId
    });
    if (resolution.kind === 'found') {
      return { state: { ...state, confirmedTargetId: state.targetId }, found: resolution.operation };
    }
    if (resolution.kind === 'confirmed-deleted') {
      return {
        state: { targetId: null, confirmedTargetId: state.confirmedTargetId, attemptedReconstruction: true },
        found: null
      };
    }
    return { state, found: null }; // awaiting-creation: unchanged, keep polling normally
  }

  if (!state.attemptedReconstruction) {
    const newest = operations[0] || null;
    if (newest && !options.isDismissed(newest.id)) {
      return { state: { ...state, targetId: newest.id, attemptedReconstruction: true }, found: newest };
    }
    return { state: { ...state, attemptedReconstruction: true }, found: null };
  }

  return { state, found: null };
}
