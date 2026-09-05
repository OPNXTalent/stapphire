import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/requisitions/[id]/page.tsx', import.meta.url), 'utf8');
const matrix = readFileSync(new URL('./CandidateMatrix.tsx', import.meta.url), 'utf8');
const rounds = readFileSync(new URL('./CandidateInterviewRounds.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./CandidateInterviewRounds.module.css', import.meta.url), 'utf8');

test('candidate contact stays server-resolved and only structured fields enter the client matrix', () => {
  assert.match(page, /resume_text,primary_email,primary_phone_display,primary_phone_e164,linkedin_profile_url/);
  assert.match(page, /resolveCandidateContact/);
  assert.match(matrix, /contact: CandidateContact/);
  assert.doesNotMatch(matrix, /resumeText|resume_text/);
});

test('the Evaluation banner renders only available safe contact links', () => {
  assert.match(rounds, /href=\{`mailto:\$\{contact\.primaryEmail\}`\}/);
  assert.match(rounds, /href=\{`tel:\$\{contact\.primaryPhoneE164\}`\}/);
  assert.match(rounds, /target="_blank" rel="noopener noreferrer">LinkedIn/);
  assert.match(rounds, /const hasContact = Boolean/);
});

test('the Evaluation hover changes only its label color, never its fill or border', () => {
  assert.match(styles, /\.evaluationBar:hover\{background:#fff\}/);
  assert.match(styles, /\.evaluationBar:not\(\.selectedBar\):hover\{border-color:var\(--line-strong\)\}/);
  assert.match(styles, /\.evaluationBar:hover \.evaluationToggle\{color:var\(--sapphire\)\}/);
});
