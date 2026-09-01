import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations', '20260831143000_prospect_sourcing_prototype.sql'), 'utf8');

test('prospect tables are RLS protected and restricted to the server role', () => {
  assert.match(migration, /alter table phase1_prospect_searches enable row level security/);
  assert.match(migration, /alter table phase1_prospects enable row level security/);
  assert.match(migration, /revoke all on table phase1_prospect_searches, phase1_prospects from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table phase1_prospect_searches, phase1_prospects to service_role/);
});

test('prospect unlock is idempotent and charges in the same transaction as persistence', () => {
  const existingEvaluationGuard = migration.indexOf('if selected_prospect.evaluation is not null then');
  const evaluationPersistence = migration.indexOf('update phase1_prospects', existingEvaluationGuard);
  const creditDebit = migration.indexOf('set credits_remaining = credits_remaining - 1', evaluationPersistence);
  const transaction = migration.indexOf("values (p_org_id, -1, 'prospect_evaluation_unlock')", creditDebit);
  assert.ok(existingEvaluationGuard >= 0 && evaluationPersistence > existingEvaluationGuard && creditDebit > evaluationPersistence && transaction > creditDebit);
  assert.match(migration, /if current_basis_id is distinct from p_evaluation_basis_id/);
});

test('browser roles cannot invoke the QC unlock function', () => {
  assert.match(migration, /revoke all on function consume_qc_and_unlock_prospect_evaluation_v1[\s\S]+from public, anon, authenticated/);
  assert.match(migration, /grant execute on function consume_qc_and_unlock_prospect_evaluation_v1[\s\S]+to service_role/);
});
