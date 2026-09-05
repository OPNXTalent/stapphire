import assert from 'node:assert/strict';
import test from 'node:test';
import { extractCandidateContact, normalizeLinkedInProfileUrl, resolveCandidateContact } from './candidateContact.ts';

test('extracts and normalizes candidate contact details from resume text', () => {
  assert.deepEqual(extractCandidateContact(`
    Kisha Boyer | Kisha.Boyer@example.com | (571) 588-2397
    linkedin.com/in/kisha-boyer?trk=resume
  `), {
    primaryEmail: 'kisha.boyer@example.com',
    primaryPhoneDisplay: '(571) 588-2397',
    primaryPhoneE164: '+15715882397',
    linkedinProfileUrl: 'https://www.linkedin.com/in/kisha-boyer'
  });
});

test('extracts a parenthesized phone after a bullet in an actual resume header layout', () => {
  const contact = extractCandidateContact('KISHA BOYER\nPELHAM, AL • (205) 555-0199 • person@example.com');
  assert.equal(contact.primaryPhoneDisplay, '(205) 555-0199');
  assert.equal(contact.primaryPhoneE164, '+12055550199');
});

test('does not pull ten digits out of a longer identifier', () => {
  assert.equal(extractCandidateContact('Applicant ID 123456789012').primaryPhoneE164, null);
});

test('rejects unsafe or non-profile LinkedIn links', () => {
  assert.equal(normalizeLinkedInProfileUrl('http://linkedin.com/in/example'), null);
  assert.equal(normalizeLinkedInProfileUrl('https://evil.example/linkedin.com/in/example'), null);
  assert.equal(normalizeLinkedInProfileUrl('https://www.linkedin.com/company/example'), null);
});

test('uses validated stored fields and falls back to the resume for missing or invalid fields', () => {
  assert.deepEqual(resolveCandidateContact({
    primaryEmail: 'stored@example.com',
    primaryPhoneDisplay: 'not a phone',
    linkedinProfileUrl: 'javascript:alert(1)'
  }, 'fallback@example.com • 202-555-0199 • linkedin.com/in/fallback-person'), {
    primaryEmail: 'stored@example.com',
    primaryPhoneDisplay: '(202) 555-0199',
    primaryPhoneE164: '+12025550199',
    linkedinProfileUrl: 'https://www.linkedin.com/in/fallback-person'
  });
});
