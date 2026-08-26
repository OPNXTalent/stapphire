import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPdfTextWithRepair, sanitizeExtractedText } from './extractText.ts';

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

test('valid PDFs use the normal parse path without normalization', async () => {
  let normalizations = 0;
  const original = Buffer.from('original');
  const text = await extractPdfTextWithRepair(original, {
    parse: async (buffer) => ({ text: buffer === original ? 'valid\0 text' : 'unexpected' }),
    normalize: async () => { normalizations += 1; return Buffer.from('repaired'); },
    log: () => {}
  });
  assert.equal(text, 'valid text');
  assert.equal(normalizations, 0);
});

test('a structurally malformed PDF is normalized temporarily and retried', async () => {
  const original = Buffer.from('authoritative-original');
  const repaired = Buffer.from('temporary-derivative');
  const parsed: Buffer[] = [];
  const text = await extractPdfTextWithRepair(original, {
    parse: async (buffer) => {
      parsed.push(buffer);
      if (buffer === original) throw new Error('bad XRef entry');
      return { text: 'recovered text' };
    },
    normalize: async (buffer) => {
      assert.equal(buffer, original, 'normalization must read the original without replacing it');
      return repaired;
    },
    log: () => {}
  });
  assert.equal(text, 'recovered text');
  assert.deepEqual(parsed, [original, repaired]);
  assert.equal(original.toString(), 'authoritative-original');
});

test('the original failure is retained when normalization or retry also fails', async () => {
  const originalError = new Error('bad XRef entry');
  let parseAttempts = 0;
  await assert.rejects(
    extractPdfTextWithRepair(Buffer.from('original'), {
      parse: async () => {
        parseAttempts += 1;
        if (parseAttempts === 1) throw originalError;
        throw new Error('normalized retry still failed');
      },
      normalize: async () => Buffer.from('repaired'),
      log: () => {}
    }),
    (error: unknown) => error instanceof AggregateError && error.errors[0] === originalError
  );
  assert.equal(parseAttempts, 2);
});

test('non-structural parser failures do not invoke the repair path', async () => {
  let normalized = false;
  await assert.rejects(
    extractPdfTextWithRepair(Buffer.from('original'), {
      parse: async () => { throw new Error('password required'); },
      normalize: async () => { normalized = true; return Buffer.from('repaired'); },
      log: () => {}
    }),
    /password required/
  );
  assert.equal(normalized, false);
});
