import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'RequisitionNotes.tsx'), 'utf8');

test('Enter posts a requisition note while Shift Enter preserves multiline entry', () => {
  assert.match(source, /event\.key !== 'Enter' \|\| event\.shiftKey \|\| event\.nativeEvent\.isComposing/);
  assert.match(source, /event\.currentTarget\.form\?\.requestSubmit\(\)/);
  assert.match(source, /if \(body\.trim\(\) && !posting\)/);
});

test('the composer has no submit button or native required-field prompt', () => {
  const form = source.match(/<form className="requisition-notes-form"[\s\S]*?<\/form>/)?.[0] ?? '';
  assert.match(form, /noValidate/);
  assert.doesNotMatch(form, /\srequired(?:\s|>)/);
  assert.doesNotMatch(form, /<button/);
  assert.match(form, /Shift Enter for a new line/);
});
