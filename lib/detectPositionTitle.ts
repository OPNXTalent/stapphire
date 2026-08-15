const GENERIC_HEADINGS = /^(job description|position description|summary|overview|about the role|role overview|responsibilities|duties)$/i;

export function detectPositionTitle(jobDescription: string): string {
  const lines = jobDescription.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 20);
  for (const line of lines) {
    const explicit = line.match(/^(?:job|position|role)\s+title\s*[:\-–—]\s*(.{2,100})$/i);
    if (explicit) return explicit[1].trim();
  }
  const first = lines[0] || '';
  if (!first || first.length > 100 || GENERIC_HEADINGS.test(first) || /[.!?]$/.test(first)) return '';
  const words = first.split(/\s+/);
  if (words.length < 2 || words.length > 12) return '';
  const titleLikeWords = words.filter((word) => /^[A-Z][A-Za-z0-9&/()+-]*$/.test(word));
  return titleLikeWords.length >= Math.ceil(words.length * 0.6) ? first : '';
}
