import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../app/candidate-record-print.css', import.meta.url), 'utf8');
const chrome = readFileSync(new URL('./ClientPrintHeader.tsx', import.meta.url), 'utf8');

test('candidate records override the legacy zero-margin page rule', () => {
  assert.match(css, /@page\{[^}]*margin:\.78in \.72in \.82in/);
  assert.doesNotMatch(css, /@page candidate-record/);
});

test('print content remains in normal flow rather than bypassing page margins', () => {
  assert.match(css, /client-branded-evaluation-print\{[^}]*position:static!important/);
  assert.doesNotMatch(css, /client-branded-evaluation-print\{[^}]*position:absolute!important/);
});

test('branded header and footer repeat as table page groups without fixed positioning', () => {
  assert.match(css, /client-print-frame>thead\{display:table-header-group!important\}/);
  assert.match(css, /client-print-frame>tfoot\{display:table-footer-group!important\}/);
  assert.doesNotMatch(css, /client-print-(?:header|footer)\{[^}]*position:fixed/);
  assert.match(chrome, /className="client-print-frame"/);
});
