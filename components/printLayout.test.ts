import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../app/candidate-record-print.css', import.meta.url), 'utf8');
const chrome = readFileSync(new URL('./ClientPrintHeader.tsx', import.meta.url), 'utf8');

test('candidate records use a named page with reserved physical margins', () => {
  assert.match(css, /@page candidate-record\{[^}]*margin:\.78in \.72in \.82in/);
  assert.match(css, /client-branded-evaluation-print[^\n]*page:candidate-record/);
});

test('print content remains in normal flow rather than bypassing page margins', () => {
  assert.match(css, /client-branded-evaluation-print\{[^}]*position:static!important/);
  assert.doesNotMatch(css, /client-branded-evaluation-print\{[^}]*position:absolute!important/);
});

test('branded header and footer are fixed inside the reserved page margins', () => {
  assert.match(css, /client-print-header\{[^}]*position:fixed/);
  assert.match(css, /client-print-footer\{[^}]*position:fixed/);
  assert.match(chrome, /<footer className="client-print-footer"/);
});
