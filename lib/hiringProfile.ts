// The five categories are permanent — they never change. What evolves
// is each category's weight and its subcriteria, through discovery.
export const HIRING_CATEGORIES = [
  'Core Responsibilities',
  'Minimum & Preferred Qualifications',
  'Hard Skills',
  'Soft Skills',
  'Keyword & Terminology Relevance'
] as const;

export type Subcriterion = {
  name: string;
  weight: number;
  source?: string[];
};

export type HiringCategory = {
  name: string;
  weight: number;
  subcriteria: Subcriterion[];
};

export type HiringProfile = {
  categories: HiringCategory[];
};

export type ProfileChange = {
  criterion: string;
  action: 'added' | 'removed' | 'increased' | 'decreased' | 'reclassified';
  old_weight: number;
  new_weight: number;
  reason: string;
};

// Legacy requisitions had evaluation_pillars as either a bare string[]
// or a flat { requirement, weight }[] — neither has the category
// structure. This gives every requisition a valid, empty-but-correct
// profile shape to build on rather than crashing on old data.
export function normalizeHiringProfile(raw: unknown): HiringProfile {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'categories' in (raw as any)) {
    const categories = (raw as any).categories;
    if (Array.isArray(categories)) {
      return {
        categories: categories.map((c: any) => ({
          name: String(c.name ?? ''),
          weight: Number(c.weight) || 0,
          subcriteria: Array.isArray(c.subcriteria)
            ? c.subcriteria.map((s: any) => ({
                name: String(s.name ?? ''),
                weight: Number(s.weight) || 0,
                source: Array.isArray(s.source) ? s.source : undefined
              }))
            : []
        }))
      };
    }
  }
  // Legacy flat shape (old evaluation_pillars) — fold everything into
  // Core Responsibilities as a starting point rather than losing it.
  if (Array.isArray(raw) && raw.length > 0) {
    const subcriteria: Subcriterion[] = raw.map((item: any) => {
      if (typeof item === 'string') return { name: item, weight: 0 };
      return { name: String(item.requirement ?? item.name ?? ''), weight: Number(item.weight) || 0 };
    });
    const totalWeight = subcriteria.reduce((sum, s) => sum + s.weight, 0) || 100;
    return {
      categories: [{ name: 'Core Responsibilities', weight: 100, subcriteria: rebalanceTo(subcriteria, totalWeight) }]
    };
  }
  return { categories: [] };
}

function rebalanceTo(items: Subcriterion[], targetSum: number): Subcriterion[] {
  const currentSum = items.reduce((s, i) => s + i.weight, 0);
  if (currentSum === 0) return items;
  const factor = targetSum / currentSum;
  return items.map((i) => ({ ...i, weight: Math.round(i.weight * factor) }));
}

// Every subcriterion weight across every category must sum to exactly
// 100 — this is a hard invariant per the Hiring Decision Model spec.
// Rather than rejecting a model call that's off by a point or two of
// rounding, this proportionally rescales everything to land exactly
// on 100, and syncs each category's weight to the sum of its own
// subcriteria so the two numbers never silently disagree.
export function normalizeProfileWeights(profile: HiringProfile): HiringProfile {
  const allSubcriteria = profile.categories.flatMap((c) => c.subcriteria);
  const total = allSubcriteria.reduce((sum, s) => sum + s.weight, 0);

  if (total === 0) return profile;

  const factor = 100 / total;
  let categories = profile.categories.map((c) => {
    const subcriteria = c.subcriteria.map((s) => ({ ...s, weight: Math.round(s.weight * factor) }));
    const categoryWeight = subcriteria.reduce((sum, s) => sum + s.weight, 0);
    return { ...c, weight: categoryWeight, subcriteria };
  });

  // Rounding can leave the grand total off by a point or two — correct
  // it on the single largest subcriterion so the visible model is
  // never silently wrong.
  const grandTotal = categories.flatMap((c) => c.subcriteria).reduce((sum, s) => sum + s.weight, 0);
  const drift = 100 - grandTotal;
  if (drift !== 0) {
    let largest: { catIdx: number; subIdx: number; weight: number } | null = null;
    categories.forEach((c, catIdx) => {
      c.subcriteria.forEach((s, subIdx) => {
        if (!largest || s.weight > largest.weight) largest = { catIdx, subIdx, weight: s.weight };
      });
    });
    if (largest) {
      const { catIdx, subIdx } = largest as { catIdx: number; subIdx: number; weight: number };
      categories = categories.map((c, ci) =>
        ci !== catIdx
          ? c
          : {
              ...c,
              subcriteria: c.subcriteria.map((s, si) => (si !== subIdx ? s : { ...s, weight: s.weight + drift })),
              weight: c.weight + drift
            }
      );
    }
  }

  return { categories };
}

export function flattenProfile(profile: HiringProfile): { requirement: string; weight: number; category: string }[] {
  return profile.categories.flatMap((c) => c.subcriteria.map((s) => ({ requirement: s.name, weight: s.weight, category: c.name })));
}
