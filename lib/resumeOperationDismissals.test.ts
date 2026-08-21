import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDismissedResumeOperationId,
  loadDismissedResumeOperationIds,
  MAX_RESUME_OPERATION_DISMISSALS,
  RESUME_OPERATION_DISMISSALS_KEY
} from './resumeOperationDismissals.ts';

class MemoryStorage {
  value: string | null = null;
  getItem(key: string) { return key === RESUME_OPERATION_DISMISSALS_KEY ? this.value : null; }
  setItem(key: string, value: string) { if (key === RESUME_OPERATION_DISMISSALS_KEY) this.value = value; }
}

test('dismiss A then remount/rehydrate keeps A dismissed', () => {
  const storage = new MemoryStorage();
  const dismissed = addDismissedResumeOperationId(new Set(), 'operation-a', storage);
  assert.equal(dismissed.has('operation-a'), true);

  const rehydrated = loadDismissedResumeOperationIds(storage);
  assert.equal(rehydrated.has('operation-a'), true);
});

test('dismissal of A never suppresses a new operation B', () => {
  const storage = new MemoryStorage();
  addDismissedResumeOperationId(new Set(), 'operation-a', storage);
  const rehydrated = loadDismissedResumeOperationIds(storage);
  assert.equal(rehydrated.has('operation-a'), true);
  assert.equal(rehydrated.has('operation-b'), false);
});

test('malformed or unavailable storage safely falls back to empty', () => {
  const malformed = new MemoryStorage();
  malformed.value = '{not-json';
  assert.deepEqual([...loadDismissedResumeOperationIds(malformed)], []);
  assert.deepEqual([...loadDismissedResumeOperationIds(null)], []);

  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); }
  };
  assert.deepEqual([...loadDismissedResumeOperationIds(blocked)], []);
  assert.doesNotThrow(() => addDismissedResumeOperationId(new Set(), 'operation-a', blocked));
});

test('retained dismissal IDs are bounded and preserve the newest acknowledgments', () => {
  const storage = new MemoryStorage();
  let dismissed = new Set<string>();
  for (let index = 0; index < MAX_RESUME_OPERATION_DISMISSALS + 7; index += 1) {
    dismissed = addDismissedResumeOperationId(dismissed, `operation-${index}`, storage);
  }

  const rehydrated = loadDismissedResumeOperationIds(storage);
  assert.equal(rehydrated.size, MAX_RESUME_OPERATION_DISMISSALS);
  assert.equal(rehydrated.has('operation-0'), false);
  assert.equal(rehydrated.has(`operation-${MAX_RESUME_OPERATION_DISMISSALS + 6}`), true);
});
