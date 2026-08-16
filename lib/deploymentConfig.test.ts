import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vercelConfig = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  crons?: unknown;
  functions?: Record<string, { experimentalTriggers?: Array<{ topic?: string }> }>;
};
const migration = readFileSync(
  new URL('../supabase/migrations/20260816090000_schedule_resume_reconciliation.sql', import.meta.url),
  'utf8'
);

test('Vercel config keeps queue consumers without a Hobby-incompatible cron', () => {
  assert.equal(vercelConfig.crons, undefined);
  assert.equal(
    vercelConfig.functions?.['app/api/queues/hiring-criteria/route.ts']?.experimentalTriggers?.[0]?.topic,
    'stapphire-hiring-criteria'
  );
  assert.equal(
    vercelConfig.functions?.['app/api/queues/resume-evaluation/route.ts']?.experimentalTriggers?.[0]?.topic,
    'stapphire-resume-evaluation'
  );
});

test('Supabase schedules authenticated resume reconciliation every minute idempotently', () => {
  assert.match(migration, /create extension if not exists pg_cron/);
  assert.match(migration, /create extension if not exists pg_net/);
  assert.match(migration, /cron\.unschedule/);
  assert.match(migration, /'\* \* \* \* \*'/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /'Authorization'/);
});
