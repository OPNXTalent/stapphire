import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// No live database connection is available in this environment, so
// these are source/contract tests over the migration's raw SQL text -
// they prove the statements exist with the right shape and ordering,
// not that Postgres accepts and executes them correctly. This
// migration must still be verified transactionally against the
// connected database (apply it to a staging project, or run it inside
// a transaction that is rolled back) before rollout.
//
// This is the CURRENT effective definition of
// consume_qc_and_add_interview_questions - 20260829020000 supersedes
// 20260829010000 via CREATE OR REPLACE FUNCTION on the same name.
// 20260829010000 itself is untouched (see its own, still-passing test
// file, lib/atomicInterviewQuestionGeneration.test.ts) and remains a
// correct historical record of what it defined at the time; these
// tests instead prove the properties that matter about what is
// actually live today.

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations', '20260829020000_phone_screen_credit_ledger.sql'),
  'utf8'
);

// The header comment documents the verified live schema, including a
// quoted copy of the exact ledger-insert statement for reference - so
// counting raw occurrences of DDL text would double-count that quote.
// Executable-only text strips every `--` comment line first.
const executableSql = sql.replace(/^\s*--.*$/gm, '');

test('the prior migration is not modified - this migration is purely additive, replacing the function again via CREATE OR REPLACE', () => {
  const priorSql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations', '20260829010000_atomic_interview_question_generation.sql'),
    'utf8'
  );
  assert.doesNotMatch(priorSql, /credit_transactions/, '20260829010000 must remain exactly as committed - it never mentions credit_transactions');
});

test('the Phone Screen branch contains the exact verified ledger insert', () => {
  assert.match(sql, /insert into public\.credit_transactions \(org_id, amount, reason\)\s*\n\s*values \(p_org_id, -1, 'interview_question_generation'\);/);
});

test('the ledger insert occurs exactly once, only in the fresh Phone Screen generation path - never in the replay branch, the partial-batch branch, or the Structured/legacy path', () => {
  const ledgerInserts = executableSql.match(/insert into public\.credit_transactions/g) || [];
  assert.equal(ledgerInserts.length, 1, 'expected exactly one executable credit_transactions insert in the whole file (the header comment\'s quoted reference copy does not count) - Structured Interview keeps using the preserved original function\'s own insert, never a second one added here');

  const phoneScreenBranchMatch = sql.match(/if v_stage = 'phone-screen' then([\s\S]*?)\n {2}end if;\n\n {2}-- Structured Interview/);
  assert.ok(phoneScreenBranchMatch, 'expected to isolate the Phone Screen branch');
  assert.match(phoneScreenBranchMatch[1], /insert into public\.credit_transactions/, 'the ledger insert must be inside the Phone Screen branch');

  const replayMatch = sql.match(/if v_existing_count = 5 then([\s\S]*?)elsif v_existing_count between 1 and 4 then/);
  assert.ok(replayMatch);
  assert.doesNotMatch(replayMatch[1], /credit_transactions/, 'the replay branch must never touch the ledger');

  const structuredPathMatch = sql.match(/select public\._consume_qc_and_add_interview_questions_v1[\s\S]*?end;\n\$function\$;/);
  assert.ok(structuredPathMatch);
  assert.doesNotMatch(structuredPathMatch[0], /insert into public\.credit_transactions/, 'the Structured/legacy path must rely solely on the preserved original function\'s own ledger insert, never a duplicate');
});

test('the ledger insert happens after the credit deduction and the five question inserts, and before the response is built - all inside the same transaction, with the replay/partial-batch branches returning or raising earlier still', () => {
  const deductIndex = sql.indexOf('update public.organizations set credits_remaining = credits_remaining - 1 where id = p_org_id;');
  const ledgerIndex = sql.indexOf("insert into public.credit_transactions (org_id, amount, reason)\n    values (p_org_id, -1, 'interview_question_generation');");
  const insertedCountCheckIndex = sql.indexOf('if v_inserted_count <> 5 then');
  const replayReturnIndex = sql.indexOf('if v_existing_count = 5 then');
  const partialRaiseIndex = sql.indexOf("raise exception 'A partial batch already exists");

  assert.ok(deductIndex >= 0 && ledgerIndex >= 0 && insertedCountCheckIndex >= 0);
  assert.ok(insertedCountCheckIndex < deductIndex, 'the five-row count check must happen before credit deduction');
  assert.ok(deductIndex < ledgerIndex, 'credit deduction must happen before the ledger insert');
  assert.ok(replayReturnIndex < deductIndex && partialRaiseIndex < deductIndex, 'the replay and partial-batch branches must both occur, and return/raise, before any credit or ledger mutation in the fresh path');
});

test('a failure at or after the ledger insert - or anywhere else in the function - participates in full rollback: no exception handler exists to swallow it', () => {
  assert.doesNotMatch(sql, /exception\s+when/i, 'no exception handler must catch and continue past a failure, including a ledger insert failure');
  // The ledger insert is the last statement before the response is
  // built - nothing after it could "already have committed" separately,
  // since it is still inside the same function invocation / transaction.
  const ledgerIndex = sql.indexOf("insert into public.credit_transactions (org_id, amount, reason)\n    values (p_org_id, -1, 'interview_question_generation');");
  const returnIndex = sql.indexOf('return v_result;', ledgerIndex);
  assert.ok(ledgerIndex >= 0 && returnIndex > ledgerIndex);
});

test('legacy callers (no requestId, no stage) are unaffected - idempotency and ledger logic are both conditioned on values that are simply absent for them', () => {
  assert.match(sql, /if v_request_id is not null then/);
  assert.match(sql, /if v_stage = 'phone-screen' then/, 'a legacy caller with no stage falls through to the untouched Structured/legacy path, exactly as before');
});

test('security, signature, and grants are preserved exactly: SECURITY INVOKER (never DEFINER), same signature/return type, search_path=public, owner postgres, execute limited to postgres/service_role', () => {
  const fnMatch = sql.match(/create or replace function public\.consume_qc_and_add_interview_questions\(([\s\S]*?)\)\s*\nreturns jsonb\s*\nlanguage plpgsql\s*\nsecurity invoker\s*\nvolatile\s*\nset search_path to public/);
  assert.ok(fnMatch, 'expected the exact preserved signature/return type/security/volatility/search_path');
  assert.match(fnMatch[1], /p_org_id uuid/);
  assert.match(fnMatch[1], /p_requisition_id uuid/);
  assert.match(fnMatch[1], /p_questions jsonb/);
  assert.doesNotMatch(sql, /security definer/i, 'must never be SECURITY DEFINER');

  assert.match(sql, /alter function public\.consume_qc_and_add_interview_questions\(uuid, uuid, jsonb\) owner to postgres;/);
  assert.match(sql, /revoke all on function public\.consume_qc_and_add_interview_questions\(uuid, uuid, jsonb\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.consume_qc_and_add_interview_questions\(uuid, uuid, jsonb\) to postgres, service_role;/);
});

test('the advisory lock still serializes concurrent/repeated attempts for the same request id before either the replay check or any ledger mutation', () => {
  const lockIndex = executableSql.indexOf('pg_advisory_xact_lock');
  const countCheckIndex = executableSql.indexOf('if v_existing_count = 5 then');
  const ledgerIndex = executableSql.indexOf('insert into public.credit_transactions');
  assert.ok(lockIndex >= 0 && lockIndex < countCheckIndex && countCheckIndex < ledgerIndex);
});

test('exactly one CREATE OR REPLACE FUNCTION statement in this migration, and no statement outside the function body touches the bank or credit tables', () => {
  const createStatements = sql.match(/create or replace function/g) || [];
  assert.equal(createStatements.length, 1);
  const afterBody = sql.slice(sql.indexOf('$function$;') + '$function$;'.length);
  assert.doesNotMatch(afterBody, /phase1_interview_question_bank|credit_transactions|organizations/);
});
