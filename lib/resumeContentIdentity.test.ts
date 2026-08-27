import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumeContentHash } from './resumeContentIdentity.ts';

const migration = readFileSync(
  new URL('../supabase/migrations/20260827115348_candidate_records_interview_decisioning.sql', import.meta.url),
  'utf8'
);
const uploadRoute = readFileSync(new URL('../app/api/operations/[operationId]/items/[itemId]/upload/route.ts', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../components/ResumeUploadManager.tsx', import.meta.url), 'utf8');

test('resume identity depends on file bytes rather than filename', () => {
  const renamedCopy = Buffer.from('identical resume bytes');
  assert.equal(resumeContentHash(renamedCopy), resumeContentHash(Buffer.from('identical resume bytes')));
  assert.notEqual(resumeContentHash(renamedCopy), resumeContentHash(Buffer.from('changed resume bytes')));
});

test('the upload route hashes the uploaded bytes and claims before queue dispatch', () => {
  assert.match(uploadRoute, /const contentHash = resumeContentHash\(buffer\)/);
  assert.ok(
    uploadRoute.indexOf("rpc('mark_phase1_resume_item_uploaded'") < uploadRoute.indexOf('operationQueue.enqueueResumeEvaluation'),
    'the database claim must succeed before evaluation is dispatched'
  );
});

test('duplicate claims are atomic per requisition and return a clear error', () => {
  assert.match(migration, /primary key \(requisition_id, content_hash\)/i);
  assert.match(migration, /insert into public\.phase1_resume_content_claims\(requisition_id, content_hash, operation_item_id\)/i);
  assert.match(migration, /on conflict \(requisition_id, content_hash\) do nothing[\s\S]*if not found then/i);
  assert.match(uploadRoute, /if \(!uploaded\) throw new Error\('This resume has already been uploaded\.'\)/);
});

test('a losing simultaneous duplicate leaves no extra durable item or empty operation', () => {
  assert.match(migration, /if not found then[\s\S]*delete from public\.phase1_operation_items[\s\S]*delete from public\.phase1_operations/i);
  assert.match(migration, /not exists \([\s\S]*public\.phase1_operation_items/i);
});

test('a durable claim follows the candidate resume rather than operation-history cleanup', () => {
  const claimsTable = migration.match(/create table if not exists public\.phase1_resume_content_claims \([\s\S]*?\n\);/)?.[0] ?? '';
  assert.match(claimsTable, /candidate_id uuid unique references public\.phase1_candidates\(id\) on delete cascade/);
  assert.match(claimsTable, /operation_item_id uuid not null unique/);
  assert.doesNotMatch(claimsTable, /operation_item_id[^\n]*references public\.phase1_operation_items/);
  assert.match(migration, /after insert or update of operation_item_id on public\.phase1_candidates/);
  assert.match(migration, /set candidate_id = new\.id[\s\S]*where operation_item_id = new\.operation_item_id/);
});

test('intentional candidate resume deletion releases only that requisition claim for re-upload', () => {
  assert.match(migration, /primary key \(requisition_id, content_hash\)/i);
  assert.match(migration, /candidate_id uuid unique references public\.phase1_candidates\(id\) on delete cascade/);
  assert.doesNotMatch(migration, /references public\.phase1_operation_items\(id\) on delete cascade/);
});

test('a failed duplicate item does not stop valid items in the same batch', () => {
  assert.match(manager, /while \(cursor < descriptors\.length\)[\s\S]*try \{[\s\S]*fetch\([\s\S]*catch \(error\)[\s\S]*status: 'error'/);
  assert.match(manager, /Promise\.all\(Array\.from/);
});
