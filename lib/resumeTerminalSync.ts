type OperationStatus = 'queued' | 'processing' | 'completed' | 'partially_completed' | 'failed' | 'cancelled';

export const RESUME_OPERATION_TERMINAL_EVENT = 'stapphire:resume-operation-terminal';

export type ResumeOperationTerminalDetail = {
  requisitionId: string;
  operationId: string;
};

export function resolveTerminalObservation(
  status: OperationStatus,
  alreadyNotified: boolean
) {
  const active = status === 'queued' || status === 'processing';
  return {
    active,
    continuePolling: active,
    notifyTerminal: !active && !alreadyNotified
  };
}

export function dispatchResumeOperationTerminal(target: EventTarget, detail: ResumeOperationTerminalDetail): void {
  const event = new Event(RESUME_OPERATION_TERMINAL_EVENT) as Event & { detail: ResumeOperationTerminalDetail };
  event.detail = detail;
  target.dispatchEvent(event);
}

export function subscribeToResumeOperationTerminal(
  target: EventTarget,
  requisitionId: string,
  refresh: () => void
): () => void {
  const listener = (event: Event) => {
    const detail = (event as Event & { detail?: ResumeOperationTerminalDetail }).detail;
    if (detail?.requisitionId === requisitionId) refresh();
  };
  target.addEventListener(RESUME_OPERATION_TERMINAL_EVENT, listener);
  return () => target.removeEventListener(RESUME_OPERATION_TERMINAL_EVENT, listener);
}
