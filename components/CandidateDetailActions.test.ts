import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This project has no React/DOM testing infrastructure - this inspects
// the component's own source for the specific mount-ordering fix this
// correction depends on.

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'CandidateDetailActions.tsx'), 'utf8');

test('the candidate-files focus dispatch is deferred to a microtask, not fired synchronously on mount', () => {
  // AppShell renders the page content (which mounts this component)
  // before WorkspacePanel (which listens for this event) - on any fresh
  // mount (a hard navigation, or a reload) both mount effects fire
  // within the same synchronous commit flush, in that JSX sibling
  // order. A synchronous dispatch here would fire before
  // WorkspacePanel's listener exists and be silently lost.
  const effectMatch = source.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[candidateId, sourceFilename, resumeAvailable\]\);/);
  assert.ok(effectMatch, 'expected to find the mount effect');
  assert.match(effectMatch[1], /queueMicrotask\(\(\) => \{/, 'the dispatch must be deferred past the current synchronous effect-flush, so every effect from this same commit (including WorkspacePanel\'s listener registration) has already run by the time it fires');
  const microtaskBody = effectMatch[1].match(/queueMicrotask\(\(\) => \{([\s\S]*?)\n {4}\}\);/);
  assert.ok(microtaskBody, 'expected to find the deferred callback body');
  assert.match(microtaskBody[1], /window\.dispatchEvent\(new CustomEvent\(CANDIDATE_FILES_FOCUS_EVENT, \{ detail \}\)\)/);
});

test('a deferred dispatch that would fire after unmount is cancelled, not sent for a stale candidate', () => {
  const effectMatch = source.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[candidateId, sourceFilename, resumeAvailable\]\);/);
  assert.ok(effectMatch);
  assert.match(effectMatch[1], /let cancelled = false;/);
  assert.match(effectMatch[1], /if \(!cancelled\) window\.dispatchEvent/, 'the deferred dispatch must check the cancelled flag before firing');
  assert.match(effectMatch[1], /return \(\) => \{\s*\n\s*cancelled = true;/, 'unmount/dep-change cleanup must set cancelled=true before the deferred dispatch can run');
});

test('the clear event still fires synchronously on cleanup, unaffected by deferring the focus dispatch', () => {
  const cleanupMatch = source.match(/return \(\) => \{([\s\S]*?)\n {4}\};/);
  assert.ok(cleanupMatch, 'expected to find the effect cleanup');
  assert.match(cleanupMatch[1], /window\.dispatchEvent\(new CustomEvent\(CANDIDATE_FILES_CLEAR_EVENT, \{ detail: \{ id: candidateId \} \}\)\)/);
});

test('candidate display data (name/sourceFilename/resumeAvailable) is still computed synchronously on mount, only the dispatch itself is deferred', () => {
  const effectMatch = source.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[candidateId, sourceFilename, resumeAvailable\]\);/);
  assert.ok(effectMatch);
  const beforeMicrotask = effectMatch[1].slice(0, effectMatch[1].indexOf('queueMicrotask'));
  assert.match(beforeMicrotask, /const candidateName = document\.querySelector\('\.matrix-selected-banner \.matrix-row-name'\)/);
  assert.match(beforeMicrotask, /const detail = \{ id: candidateId, name: candidateName, sourceFilename, resumeAvailable \};/);
});
