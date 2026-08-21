export const RESUME_OPERATION_DISMISSALS_KEY = 'stapphire:resume-operation-dismissals:v1';
export const MAX_RESUME_OPERATION_DISMISSALS = 50;

type DismissalStorage = Pick<Storage, 'getItem' | 'setItem'>;

function validOperationId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function boundedIds(ids: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(ids).filter(validOperationId))).slice(-MAX_RESUME_OPERATION_DISMISSALS);
}

export function loadDismissedResumeOperationIds(storage: DismissalStorage | null): Set<string> {
  if (!storage) return new Set();
  try {
    const parsed = JSON.parse(storage.getItem(RESUME_OPERATION_DISMISSALS_KEY) || '[]') as unknown;
    return new Set(Array.isArray(parsed) ? boundedIds(parsed.filter(validOperationId)) : []);
  } catch {
    return new Set();
  }
}

export function addDismissedResumeOperationId(
  current: ReadonlySet<string>,
  operationId: string,
  storage: DismissalStorage | null
): Set<string> {
  const next = new Set(boundedIds([...current, operationId]));
  if (storage) {
    try {
      storage.setItem(RESUME_OPERATION_DISMISSALS_KEY, JSON.stringify([...next]));
    } catch {
      // Dismissal remains effective for this mount when storage is
      // unavailable, full, or blocked by browser privacy settings.
    }
  }
  return next;
}
