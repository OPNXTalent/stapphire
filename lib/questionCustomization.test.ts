import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuestionTextCustomized } from './questionCustomization.ts';

test('a blank question is never considered customized, regardless of the current template', () => {
  assert.equal(isQuestionTextCustomized('', undefined), false);
  assert.equal(isQuestionTextCustomized('   ', 'Some template text'), false);
});

test('text that still reads exactly as its own current type\'s template is not customized', () => {
  assert.equal(isQuestionTextCustomized('Is the stated compensation range acceptable?', 'Is the stated compensation range acceptable?'), false);
});

test('a fresh Custom question (no template for its own type) with real text is customized', () => {
  assert.equal(isQuestionTextCustomized('I wrote my own question here.', undefined), true);
});

test('text that has been edited away from its current type\'s template is customized', () => {
  assert.equal(isQuestionTextCustomized('Is the compensation range something you would accept?', 'Is the stated compensation range acceptable?'), true);
});

test('whitespace-only differences do not by themselves make text "still the template" - exact match is required', () => {
  assert.equal(isQuestionTextCustomized('Is the stated compensation range acceptable? ', 'Is the stated compensation range acceptable?'), true);
});
