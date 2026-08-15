// Server-only helper: import only from API routes and server extraction modules.
const UNKNOWN_ERROR = 'Unknown Hiring Criteria extraction error.';
const MAX_ERROR_LENGTH = 1000;
const SAFE_FIELDS = ['message', 'details', 'hint', 'code', 'status', 'type', 'name'] as const;
const SENSITIVE_KEY = /authorization|api[-_]?key|token|secret|password|cookie|headers|instructions|prompt|job[-_]?description|input|body/i;

function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted]');
}

function concise(value: string): string {
  const normalized = redactText(value).replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, MAX_ERROR_LENGTH) : UNKNOWN_ERROR;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function structuredFields(record: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const field of SAFE_FIELDS) {
    const value = record[field];
    if ((typeof value === 'string' && value.trim()) || typeof value === 'number') {
      const text = String(value).trim();
      parts.push(field === 'message' ? text : `${field}: ${text}`);
    }
  }
  return parts.join(' | ');
}

function safeJson(value: unknown): string | null {
  try {
    const seen = new WeakSet<object>();
    const serialized = JSON.stringify(value, (key, nestedValue: unknown) => {
      if (SENSITIVE_KEY.test(key)) return '[redacted]';
      if (typeof nestedValue === 'bigint') return nestedValue.toString();
      if (typeof nestedValue === 'object' && nestedValue !== null) {
        if (seen.has(nestedValue)) return '[circular]';
        seen.add(nestedValue);
      }
      return nestedValue;
    });
    return typeof serialized === 'string' && serialized !== '{}' ? serialized : null;
  } catch {
    return null;
  }
}

export function normalizeHiringCriteriaError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return concise(error.message);
  if (typeof error === 'string' && error.trim()) return concise(error);

  const record = recordOf(error);
  if (record) {
    const structured = structuredFields(record);
    if (structured) return concise(structured);
  }

  const serialized = safeJson(error);
  return serialized ? concise(serialized) : UNKNOWN_ERROR;
}
