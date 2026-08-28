import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This project has no React/DOM testing infrastructure - these tests
// inspect the completed-interview page's own source and its scoped CSS
// module for the specific presentation/behavior contract this correction
// depends on. Precedent for a components/ test reading app/ files:
// CandidateFilesPanel.test.ts already reads three app/api route files.

const interviewDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'app',
  'candidates',
  '[id]',
  'interviews',
  '[invitationId]'
);
const css = readFileSync(join(interviewDir, 'readOnlyInterview.module.css'), 'utf8');
const page = readFileSync(join(interviewDir, 'page.tsx'), 'utf8');

test('per-question comments get their own horizontal inset - .question has none of its own, unlike .questionHead/.ratings', () => {
  assert.doesNotMatch(css, /\.question\{[^}]*padding/, '.question itself must still have no padding of its own - .questionHead/.ratings/the new rule each carry their own inset instead');
  assert.match(css, /\.question \.assessmentBlock\{padding:12px 16px\}/, 'expected per-question comments to get the same ~16px horizontal inset as .questionHead (padding:14px 16px)');
});

test('the horizontal-inset fix is scoped to per-question comments only, not the shared .assessmentBlock class used by Overall Comments/Recommendation', () => {
  // .assessment (Overall Comments/Recommendation) already supplies its
  // own 18px padding to every child, including .assessmentBlock. Adding
  // padding to .assessmentBlock itself (rather than to .question
  // .assessmentBlock specifically) would double-inset that section.
  assert.doesNotMatch(css, /\n\.assessmentBlock\{padding/, 'must not add padding to .assessmentBlock in general - only to .question .assessmentBlock - or Overall Comments/Recommendation would be double-inset inside .assessment{padding:18px}');
});

test('long comments wrap inside the card instead of overflowing horizontally', () => {
  assert.match(css, /\.assessmentBlock p\{[^}]*overflow-wrap:break-word/, 'expected an explicit wrap rule so a long unbroken comment (e.g. a URL) cannot overflow the fixed-width card');
  assert.match(css, /\.assessmentBlock p\{[^}]*white-space:pre-wrap/, 'expected the existing whitespace-preserving wrap behavior to remain in place');
});

test('the completed-interview presentation correction is scoped to this page\'s own CSS module, not a shared/global stylesheet', () => {
  assert.match(page, /import styles from '\.\/readOnlyInterview\.module\.css';/, 'the page must keep using its own scoped CSS module rather than shared/global form or print rules');
});

test('per-question comments remain read-only text - no input/textarea/contentEditable was introduced', () => {
  const commentBlockMatch = page.match(/\{question\.commentBox && questionComments\[question\.id\]\?\.trim\(\) && \(([\s\S]*?)\)\}/);
  assert.ok(commentBlockMatch, 'expected to find the per-question comment block');
  assert.doesNotMatch(commentBlockMatch[1], /<input|<textarea|contentEditable/i, 'the completed-interview view must stay a read-only audit record');
  assert.match(commentBlockMatch[1], /<strong>Comments<\/strong>/);
  assert.match(commentBlockMatch[1], /<p>\{questionComments\[question\.id\]\}<\/p>/);
});

test('the completed-interview print output is untouched by this correction - print-document class and the print media rules remain in place', () => {
  assert.match(page, /className=\{`\$\{styles\.page\} print-document`\}/, 'expected the page to keep rendering as a print-document, per the earlier fix for blank interview print');
  assert.match(css, /@media print\{\.topRow\{display:none\}\.page\{max-width:none;padding:0\}\.question,\.assessment\{break-inside:avoid;box-shadow:none\}\}/, 'expected the existing print media rules to remain exactly as they were');
});

test('the Back to candidate link still restores the same candidate into Evaluation via the existing view/candidate URL convention', () => {
  assert.match(page, /const backToCandidateHref = `\/requisitions\/\$\{invitation\.requisition_id\}\?view=candidates&candidate=\$\{params\.id\}`;/);
});
