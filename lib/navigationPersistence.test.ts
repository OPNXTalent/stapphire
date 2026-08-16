import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appShell = readFileSync(new URL('../components/AppShell.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const candidateDetail = readFileSync(new URL('../app/candidates/[id]/page.tsx', import.meta.url), 'utf8');
const bannerControls = readFileSync(new URL('../components/GlobalBannerControls.tsx', import.meta.url), 'utf8');
const uploadManager = readFileSync(new URL('../components/ResumeUploadManager.tsx', import.meta.url), 'utf8');

test('shell owns resume uploads above route content', () => {
  assert.match(appShell, /<ResumeUploadManagerProvider>/);
  assert.match(appShell, /\{children\}/);
  assert.match(uploadManager, /const descriptors = files\.map\(\(file\) => \(\{ id: crypto\.randomUUID\(\), file \}\)\)/);
  assert.match(uploadManager, /UPLOAD_CONCURRENCY = 3/);
});

test('internal navigation uses Next links so the shell upload manager persists', () => {
  assert.match(home, /<Link className="row"/);
  assert.match(candidateDetail, /<Link className="back"/);
  assert.match(bannerControls, /<Link href="\/archived"/);
  assert.doesNotMatch(home, /<a className="row"/);
  assert.doesNotMatch(candidateDetail, /<a className="back"/);
  assert.doesNotMatch(bannerControls, /<a href="\/archived"/);
});

test('each stored resume is published independently without waiting for the batch', () => {
  const uploadRoute = readFileSync(
    new URL('../app/api/operations/[operationId]/items/[itemId]/upload/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(uploadRoute, /mark_phase1_resume_item_uploaded/);
  assert.match(uploadRoute, /enqueueResumeEvaluation\(\{ operationItemId: params\.itemId \}\)/);
});
