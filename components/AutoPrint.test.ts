import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This project has no React/DOM testing infrastructure - these inspect
// the component's own source for the specific print-session lifecycle
// contract this correction depends on: the dedicated print tab
// (opened by CompletedInterviewActions via ?print=1) must run the print
// dialog and then close itself, whether the user printed or cancelled,
// without ever becoming a second interactive Stapphire instance.

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'AutoPrint.tsx'), 'utf8');

test('the afterprint listener is registered before window.print() is ever invoked', () => {
  const effectMatch = source.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/);
  assert.ok(effectMatch, 'expected to find the mount effect');
  const listenerIndex = effectMatch[1].indexOf("window.addEventListener('afterprint', handleAfterPrint)");
  const printCallIndex = effectMatch[1].indexOf('setTimeout(() => window.print()');
  assert.ok(listenerIndex >= 0 && printCallIndex > listenerIndex, 'afterprint must be registered before window.print() is called, so the dialog\'s completion can never be missed');
});

test('afterprint fires exactly once per mounted instance, even under React development-mode effect replay', () => {
  const effectMatch = source.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/);
  assert.ok(effectMatch);
  assert.match(effectMatch[1], /let handled = false;/, 'expected a guard flag scoped to this effect instance');
  const handlerMatch = effectMatch[1].match(/function handleAfterPrint\(\) \{([\s\S]*?)\n    \}/);
  assert.ok(handlerMatch, 'expected to find handleAfterPrint');
  assert.match(handlerMatch[1], /if \(handled\) return;\s*\n\s*handled = true;/, 'the handler must guard against running its close/fallback cycle twice');
});

test('the effect cleanup removes the afterprint listener and clears both timers, so a torn-down (dev-replay) instance cannot fire anything later', () => {
  const effectMatch = source.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/);
  assert.ok(effectMatch);
  const cleanupMatch = effectMatch[1].match(/return \(\) => \{([\s\S]*?)\n    \};/);
  assert.ok(cleanupMatch, 'expected to find the effect cleanup');
  assert.match(cleanupMatch[1], /window\.removeEventListener\('afterprint', handleAfterPrint\)/);
  assert.match(cleanupMatch[1], /if \(printTimer\) clearTimeout\(printTimer\)/);
  assert.match(cleanupMatch[1], /if \(closeCheckTimer\) clearTimeout\(closeCheckTimer\)/);
});

test('window.close() is called only from the afterprint handler - never eagerly on mount, and never for any other tab', () => {
  const handlerMatch = source.match(/function handleAfterPrint\(\) \{([\s\S]*?)\n    \}/);
  assert.ok(handlerMatch, 'expected to find handleAfterPrint');
  assert.match(handlerMatch[1], /window\.close\(\);/, 'window.close() must be called from inside the afterprint handler');
  const outsideHandler = source.slice(0, source.indexOf('function handleAfterPrint')) + source.slice(source.indexOf('function handleAfterPrint') + handlerMatch[0].length);
  assert.doesNotMatch(outsideHandler, /window\.close\(\);/, 'window.close() must not be called eagerly on mount or from anywhere outside the afterprint handler');
});

test('if the close is silently blocked, a minimal fallback notice replaces the page instead of leaving a fully interactive instance open', () => {
  assert.match(source, /if \(!window\.closed\) setCloseFailed\(true\)/, 'expected a check of window.closed after a delay, since window.close() has no direct success signal');
  assert.match(source, /if \(!closeFailed\) return null;/, 'expected the component to render nothing at all unless the close attempt is known to have failed');
  assert.match(source, /Printing finished — close this tab\./);
});

test('the print trigger delay and window.print() call site are unchanged, preserving the exact printed document/pagination this correction must not affect', () => {
  assert.match(source, /const PRINT_TRIGGER_DELAY_MS = 250;/);
  assert.match(source, /printTimer = setTimeout\(\(\) => window\.print\(\), PRINT_TRIGGER_DELAY_MS\);/);
});
