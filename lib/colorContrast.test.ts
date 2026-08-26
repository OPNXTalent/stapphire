import assert from 'node:assert/strict';
import test from 'node:test';
import { contrastRatio, readableHeaderText } from './colorContrast.ts';

test('header text adapts to light and dark brand colors', () => {
  assert.equal(readableHeaderText('#f4d35e'), '#172033');
  assert.equal(readableHeaderText('#030d26'), '#ffffff');
  for (const background of ['#ffffff', '#e8eefc', '#1e4fd8', '#030d26']) {
    assert.ok(contrastRatio(background, readableHeaderText(background)) >= 4.5);
  }
});
