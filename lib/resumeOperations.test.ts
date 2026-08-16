import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20260815130000_durable_resume_evaluation_operations.sql', import.meta.url),
  'utf8'
);

test('resume batches capture one immutable Evaluation Basis before creating items', () => {
  assert.match(migration, /selected_requisition\.current_evaluation_basis_id/);
  assert.match(migration, /'evaluationBasisId', selected_basis\.id/);
  assert.match(migration, /insert into phase1_operation_items/);
});

test('resume completion is idempotent and transactionally links one candidate and evaluation', () => {
  assert.match(migration, /unique index if not exists phase1_candidates_operation_item_key/);
  assert.match(migration, /unique index if not exists phase1_evaluations_operation_item_key/);
  assert.match(migration, /where operation_item_id=selected_item\.id/);
  assert.match(migration, /evaluation_basis_id/);
});

test('resume worker claims are leased, retry-bounded, and globally concurrency-capped', () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('resume-evaluation-capacity'\)\)/);
  assert.match(migration, /active_count >= 3/);
  assert.match(migration, /selected_item\.attempt_count >= 3/);
  assert.match(migration, /lease_expires_at/);
});

test('resume operation rollups preserve partial success and terminal item failures', () => {
  assert.match(migration, /next_status := 'partially_completed'/);
  assert.match(migration, /progress_current = completed_count \+ failed_count/);
  assert.match(migration, /where operation_id=p_operation_id and status='failed'/);
  assert.match(migration, /and input_ref->>'uploaded'='true'/);
});
