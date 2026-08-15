const GENERIC_HEADINGS = /^(job description|position description|summary|overview|about(?: the role)?|role overview|responsibilities|duties|essential functions|qualifications|requirements|who we are|our organization)$/i;
const METADATA_LINES = /^(department|division|location|salary|classification|reports? to|posting|schedule|status|job code)\s*[:\-]/i;
const CONNECTOR_WORDS = /^(and|or|of|for|to|the|a|an|in|on|with)$/i;

function plausibleStandaloneTitle(line: string): boolean {
  if (!line || line.length > 100 || GENERIC_HEADINGS.test(line) || METADATA_LINES.test(line)) return false;
  if (/[:.!?]$/.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 10) return false;
  const significantWords = words.filter((word) => !CONNECTOR_WORDS.test(word));
  return significantWords.length > 0 && significantWords.every((word) => /^[A-Z][A-Za-z0-9&/()+.'-]*$/.test(word));
}

export function detectPositionTitle(jobDescription: string): string {
  const lines = jobDescription
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);

  for (const line of lines) {
    const explicit = line.match(/^(?:(?:job|position|role)\s+)?title\s*[:\u2013\u2014-]\s*(.{2,100})$/i);
    if (explicit) return explicit[1].trim();
  }

  for (const line of lines.slice(0, 8)) {
    if (plausibleStandaloneTitle(line)) return line;
  }

  return '';
}
