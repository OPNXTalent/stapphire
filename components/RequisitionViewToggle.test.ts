import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'RequisitionViewToggle.tsx'), 'utf8');
const viewportCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'candidate-interview-scroll.css'), 'utf8');

test('the Interviews workspace fills its already-bounded parent instead of subtracting a second arbitrary viewport offset', () => {
  assert.match(source, /\.requisition-workspace\.interviews-active\{height:100%;min-height:0;/);
  assert.doesNotMatch(source, /100dvh - 190px/, 'the duplicate 190px subtraction shortened the editor and left unused page space below it');
  assert.match(viewportCss, /\.workspace-content:has\(\.requisition-workspace\.requisition-active\)\{height:calc\(100dvh - 56px\)/, 'the parent workspace remains the single owner of viewport sizing');
});
