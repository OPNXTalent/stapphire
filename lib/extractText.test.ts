import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeExtractedText } from './extractText.ts';

test('removes an embedded NUL character', () => {
  assert.equal(sanitizeExtractedText('before\0after'), 'beforeafter');
});

test('removes multiple NUL characters', () => {
  assert.equal(sanitizeExtractedText('\0one\0two\0\0three\0'), 'onetwothree');
});

test('preserves ordinary Unicode unchanged', () => {
  const text = 'José — résumé • Kraków • 東京';
  assert.equal(sanitizeExtractedText(text), text);
});

test('preserves tabs, newlines, and carriage returns unchanged', () => {
  const text = 'Heading\r\nFirst\tcolumn\nSecond line\rThird line';
  assert.equal(sanitizeExtractedText(text), text);
});

test('leaves text without NUL unchanged', () => {
  const text = 'Ordinary resume text with punctuation: skills, experience, and education.';
  assert.equal(sanitizeExtractedText(text), text);
});
