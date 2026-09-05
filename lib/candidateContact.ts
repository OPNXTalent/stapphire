export const CONTACT_EXTRACTION_VERSION = 'resume_contact_v1';

export type CandidateContact = {
  primaryEmail: string | null;
  primaryPhoneDisplay: string | null;
  primaryPhoneE164: string | null;
  linkedinProfileUrl: string | null;
};

type StoredCandidateContact = {
  primaryEmail?: unknown;
  primaryPhoneDisplay?: unknown;
  primaryPhoneE164?: unknown;
  linkedinProfileUrl?: unknown;
};

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validEmail(value: unknown): string | null {
  const candidate = clean(value)?.toLowerCase() ?? null;
  return candidate && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(candidate)
    ? candidate
    : null;
}

export function normalizeLinkedInProfileUrl(value: unknown): string | null {
  let candidate = clean(value);
  if (!candidate) return null;
  candidate = candidate.replace(/[),.;]+$/, '');
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol !== 'https:' || hostname !== 'linkedin.com' || !/^\/in\/[^/]+\/?$/i.test(url.pathname)) return null;
    url.protocol = 'https:';
    url.hostname = 'www.linkedin.com';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizePhone(value: unknown): Pick<CandidateContact, 'primaryPhoneDisplay' | 'primaryPhoneE164'> {
  const raw = clean(value);
  if (!raw) return { primaryPhoneDisplay: null, primaryPhoneE164: null };
  const extensionPattern = /(?:;?ext\.?\s*=?|x)\s*(\d{1,6})\b/i;
  const extension = raw.match(extensionPattern)?.[1] ?? null;
  let digits = raw.replace(extensionPattern, '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return { primaryPhoneDisplay: null, primaryPhoneE164: null };
  return {
    primaryPhoneDisplay: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}${extension ? ` ext. ${extension}` : ''}`,
    primaryPhoneE164: `+1${digits}${extension ? `;ext=${extension}` : ''}`
  };
}

export function extractCandidateContact(resumeText: string): CandidateContact {
  const emailMatch = resumeText.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i)?.[0] ?? null;
  const phoneMatch = resumeText.match(/\b(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d{1,6})?\b/i)?.[0] ?? null;
  const linkedinMatch = resumeText.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-z0-9%_-]+\/?(?:\?[^\s]*)?/i)?.[0] ?? null;
  return {
    primaryEmail: validEmail(emailMatch),
    ...normalizePhone(phoneMatch),
    linkedinProfileUrl: normalizeLinkedInProfileUrl(linkedinMatch)
  };
}

export function resolveCandidateContact(stored: StoredCandidateContact, resumeText: string): CandidateContact {
  const extracted = extractCandidateContact(resumeText);
  const storedPhone = normalizePhone(stored.primaryPhoneE164 ?? stored.primaryPhoneDisplay);
  return {
    primaryEmail: validEmail(stored.primaryEmail) ?? extracted.primaryEmail,
    primaryPhoneDisplay: storedPhone.primaryPhoneDisplay ?? extracted.primaryPhoneDisplay,
    primaryPhoneE164: storedPhone.primaryPhoneE164 ?? extracted.primaryPhoneE164,
    linkedinProfileUrl: normalizeLinkedInProfileUrl(stored.linkedinProfileUrl) ?? extracted.linkedinProfileUrl
  };
}
