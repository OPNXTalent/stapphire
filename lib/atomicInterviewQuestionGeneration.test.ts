import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// No live database connection is available in this environment, so
// these are source/contract tests over the migration's raw SQL text -
// they prove the statements exist with the right shape, not that
// Postgres accepts and executes them correctly. This migration must
// still be verified transactionally against the connected database
// (apply it to a staging project, or run it inside a transaction that
// is rolled back) before rollout - see the audit report for the exact
// verification steps.

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations', '20260829010000_atomic_interview_question_generation.sql'),
  'utf8'
);

test('the original opaque RPC is preserved verbatim under an internal name, never rewritten - its body is not reconstructed anywhere in this file', () => {
  assert.match(sql, /alter function public\.consume_qc_and_add_interview_questions\(uuid, uuid, jsonb\)\s*\n\s*rename to _consume_qc_and_add_interview_questions_v1;/);
  assert.match(sql, /select public\._consume_qc_and_add_interview_questions_v1\(p_org_id, p_requisition_id, p_questions\) into v_result;/, 'the new function must call the preserved original, not reimplement its credit/ledger logic');
});

test('the new function keeps the exact original signature, return type, and verified properties', () => {
  const fnMatch = sql.match(/create or replace function public\.consume_qc_and_add_interview_questions\(([\s\S]*?)\)\s*\nreturns jsonb\s*\nlanguage plpgsql\s*\nsecurity invoker\s*\nvolatile\s*\nset search_path to public/);
  assert.ok(fnMatch, 'expected the exact verified signature/return type/security/volatility/search_path');
  assert.match(fnMatch[1], /p_org_id uuid/);
  assert.match(fnMatch[1], /p_requisition_id uuid/);
  assert.match(fnMatch[1], /p_questions jsonb/);
});

test('owner and grants are preserved: postgres owns it, execute is granted only to postgres and service_role', () => {
  assert.match(sql, /alter function public\.consume_qc_and_add_interview_questions\(uuid, uuid, jsonb\) owner to postgres;/);
  assert.match(sql, /revoke all on function public\.consume_qc_and_add_interview_questions\(uuid, uuid, jsonb\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.consume_qc_and_add_interview_questions\(uuid, uuid, jsonb\) to postgres, service_role;/);
});

test('legacy {id,text,areas}-only callers remain valid: every new field is read null-safely and defaults resolve to null, never a required value', () => {
  const nullSafeFields = ['questionType', 'responseKind', 'responseUnit'];
  for (const field of nullSafeFields) {
    const pattern = new RegExp(`nullif\\(btrim\\(coalesce\\(v_question->>'${field}', ''\\)\\), ''\\)`);
    assert.match(sql, pattern, `expected ${field} to be read null-safely`);
  }
  assert.match(sql, /case when jsonb_typeof\(v_question->'responseOptions'\) = 'array'[\s\S]*?else null end/, 'responseOptions must default to null, not an empty/required array');
  assert.match(sql, /case when jsonb_typeof\(v_question->'responseQualifying'\) = 'array'[\s\S]*?else null end/, 'responseQualifying must default to null');
});

test('exactly five inserts, credit deduction, credit transaction, and metadata are one atomic function - no separate post-commit step exists anywhere in this file', () => {
  // Exactly one CREATE OR REPLACE FUNCTION statement defines the whole
  // new entry point - metadata is written inside it, not by a second
  // statement issued afterward from application code.
  const createStatements = sql.match(/create or replace function/g) || [];
  assert.equal(createStatements.length, 1, 'expected exactly one function definition in this migration');

  // Everything after the function body's closing delimiter is only
  // owner/grant statements - never another statement that touches the
  // bank table (which would mean metadata is written by a second,
  // independent, non-atomic step instead of inside the function).
  const afterBody = sql.slice(sql.indexOf('$function$;') + '$function$;'.length);
  assert.doesNotMatch(afterBody, /phase1_interview_question_bank/, 'no statement outside the function body should touch the bank table');
});

test('a metadata backfill failure rolls back the entire structured-path operation, including the nested original function\'s insert/credit/ledger work', () => {
  const backfillMatch = sql.match(/get diagnostics v_row_count = row_count;\s*\n\s*if v_row_count <> 1 then\s*\n\s*raise exception '([^']+)'/);
  assert.ok(backfillMatch, 'expected an explicit row-count check with a raise exception on mismatch');
  // The raise happens after the nested call to the original function, in
  // the same statement list, with no exception handler (no `exception
  // when` block) between them - so an uncaught raise here aborts this
  // function's entire transaction, which includes whatever the nested
  // call already did, since a nested plpgsql call shares its caller's
  // transaction rather than committing independently.
  assert.doesNotMatch(sql, /exception\s+when/i, 'no exception handler must swallow a mid-function failure and let the operation continue');
});

test('Phone Screen questions are inserted with zero Areas of Evaluation and no fake placeholder value', () => {
  assert.match(sql, /'\{\}'::text\[\],\s*\n\s*'phone-screen',/, 'expected areas to be inserted as an empty array, with stage set atomically in the same insert');
  assert.match(sql, /raise exception 'Phone Screen questions must not carry Areas of Evaluation';/);
});

test('the stage-aware constraint requires zero areas for phone-screen, 1-4 for every other stage (including legacy null-stage rows), and no fake value is used to satisfy it', () => {
  const constraintMatch = sql.match(/add constraint phase1_interview_question_bank_areas_check\s*\n\s*check \(([\s\S]*?)\);/);
  assert.ok(constraintMatch, 'expected the new stage-aware constraint');
  assert.match(constraintMatch[1], /when stage = 'phone-screen' then cardinality\(areas\) = 0/);
  assert.match(constraintMatch[1], /else cardinality\(areas\) between 1 and 4/);
});

test('an exact retry with the same generation request returns the existing batch and does not deduct another credit', () => {
  const replayMatch = sql.match(/if v_existing_count = 5 then([\s\S]*?)elsif v_existing_count between 1 and 4 then/);
  assert.ok(replayMatch, 'expected the exact-replay branch');
  assert.doesNotMatch(replayMatch[1], /credits_remaining = credits_remaining - 1/, 'a replay must never deduct a credit');
  assert.doesNotMatch(replayMatch[1], /insert into public\.phase1_interview_question_bank/, 'a replay must never insert again');
  assert.match(replayMatch[1], /return v_result;/);
});

test('concurrent or repeated requests for the same generation id are serialized by a transaction-scoped advisory lock before the existing-batch check runs', () => {
  const lockIndex = sql.indexOf('pg_advisory_xact_lock');
  const countCheckIndex = sql.indexOf('if v_existing_count = 5 then');
  assert.ok(lockIndex >= 0, 'expected a pg_advisory_xact_lock call');
  assert.ok(lockIndex < countCheckIndex, 'the lock must be acquired before the existing-batch check, so two concurrent attempts cannot both see zero existing rows');
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\(v_request_id::text\)::bigint\)/);
});

test('a partial existing batch (1-4 rows) fails explicitly rather than charging or inserting on top of it', () => {
  assert.match(sql, /elsif v_existing_count between 1 and 4 then\s*\n[\s\S]*?raise exception 'A partial batch already exists/);
});

test('a batch with no shared request id (or a mismatched/mixed one) is rejected outright, and idempotency logic is fully skipped - not just no-op - for a legacy batch with no request id at all', () => {
  assert.match(sql, /if array_length\(v_request_ids, 1\) > 1 then\s*\n\s*raise exception 'All questions in a batch must share the same generation request identifier';/);
  assert.match(sql, /if v_request_id is not null then/);
});

test('the INSUFFICIENT_QC error string is preserved verbatim for the Phone Screen path, matching the existing API route\'s error-message check', () => {
  assert.match(sql, /raise exception 'INSUFFICIENT_QC';/);
});

test('question_key is written from the caller-supplied id for both the Phone Screen insert and the structured metadata backfill match, never a freshly generated one', () => {
  assert.match(sql, /v_question->>'id',\s*\n\s*btrim\(v_question->>'text'\),/, 'Phone Screen insert must use the caller-supplied id as question_key');
  assert.match(sql, /and question_key = v_question->>'id';/, 'the structured backfill must match by the caller-supplied id, not a newly generated one');
});
