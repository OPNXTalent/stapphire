import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const plan = readFileSync(new URL('./InterviewPlan.tsx', import.meta.url), 'utf8');
const participant = readFileSync(new URL('./ParticipantInterviewPreview.tsx', import.meta.url), 'utf8');

test('new bank and manual questions default their comment box on', () => {
  assert.match(plan, /cloneBankQuestion[\s\S]*commentBox: true/);
  assert.match(plan, /Add a new interview question[^\n]*commentBox: true/);
});

test('AOE tables render only when at least one area exists', () => {
  assert.match(participant, /question\.areas\.length > 0 && <div className=\{styles\.ratingTable\}/);
  assert.match(plan, /question\.areas\.length > 0 && \(/);
});

test('AOE picker closes on outside pointer and Escape', () => {
  assert.match(plan, /event\.key === 'Escape'[^\n]*setOpenAreaId\(null\)/);
  assert.match(plan, /document\.addEventListener\('pointerdown', closeOnOutsideClick\)/);
});

test('Yes\/No is serialized with the saved interview plan', () => {
  assert.match(plan, /yesNo: Boolean\(question\.yesNo\)/);
});
