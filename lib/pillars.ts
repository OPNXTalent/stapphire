export type Pillar = { requirement: string; weight: number | null };

// Existing requisitions have evaluation_pillars as a bare string[]
// (dimension names only, no weights — that's all the format used to
// support). Newer ones are { requirement, weight }[]. This normalizes
// either shape so the rest of the app never has to care which one
// it's looking at.
export function normalizePillars(raw: unknown): Pillar[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (typeof item === 'string') return { requirement: item, weight: null };
    if (item && typeof item === 'object' && 'requirement' in item) {
      return { requirement: String((item as any).requirement), weight: (item as any).weight ?? null };
    }
    return { requirement: String(item), weight: null };
  });
}
