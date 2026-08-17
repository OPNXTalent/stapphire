// Pure text-normalization and evidence-validation helpers, kept
// dependency-free (no supabaseAdmin, no OpenAI) so they can be unit
// tested directly rather than only indirectly through the full
// extraction pipeline, which requires live API/DB credentials.

export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2012\u2013\u2014\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function cleanEvidence(value: string): string {
  return value.trim().replace(/^["“”]+|["“”]+$/g, '').trim();
}

// Requires that a model's quoted jdEvidence actually appears
// (post-normalization) in the source Job Description text - a guard
// against fabricated/hallucinated evidence. normalizeText handles
// typographic punctuation variants (smart quotes, em/en-dashes) that
// are semantically identical but would otherwise fail an exact
// substring match; it deliberately does not do fuzzy/partial matching
// beyond that, so genuinely fabricated evidence still fails.
export function validateEvidence(jobDescription: string, evidence: string): void {
  const normalizedEvidence = normalizeText(evidence);
  if (!normalizedEvidence || !normalizeText(jobDescription).includes(normalizedEvidence)) {
    throw new Error('Hiring Criteria evidence was not found in the Job Description.');
  }
}
