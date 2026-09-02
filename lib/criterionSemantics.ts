import { createHash } from 'crypto';

export const CRITERION_SEMANTIC_FINGERPRINT_VERSION = 'criterion_semantics_v1' as const;

export type CriterionSemantics = {
  category: string;
  label: string;
  rationale?: string | null;
  jdEvidence?: string | null;
};

export function normalizeCriterionSemanticText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .trim();
}

function normalizeOptionalCriterionSemanticText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeCriterionSemanticText(value);
  return normalized || null;
}

export function canonicalizeCriterionSemantics(criterion: CriterionSemantics): string {
  return JSON.stringify({
    category: normalizeCriterionSemanticText(criterion.category),
    label: normalizeCriterionSemanticText(criterion.label),
    rationale: normalizeOptionalCriterionSemanticText(criterion.rationale),
    jdEvidence: normalizeOptionalCriterionSemanticText(criterion.jdEvidence)
  });
}

export function fingerprintCriterionSemantics(criterion: CriterionSemantics): string {
  return createHash('sha256').update(canonicalizeCriterionSemantics(criterion), 'utf8').digest('hex');
}
