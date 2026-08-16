import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vercelConfig = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  crons?: unknown;
  functions?: Record<string, { experimentalTriggers?: Array<{ topic?: string }> }>;
};

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
