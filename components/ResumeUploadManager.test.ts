import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ResumeUploadManager.tsx'), 'utf8');

test('each upload selection appends a new batch without resetting existing batch state', () => {
  assert.match(source, /setBatches\(\(current\) => \[\.\.\.current, \{/);
  assert.doesNotMatch(source, /setBatches\(\[\{/);
});

test('per-item updates reconcile into their matching batch and item without replacing siblings', () => {
  assert.match(source, /current\.map\(\(batch\) => batch\.clientBatchKey === clientBatchKey/);
  assert.match(source, /batch\.items\.map\(\(item\) => item\.id === descriptor\.id/);
});
