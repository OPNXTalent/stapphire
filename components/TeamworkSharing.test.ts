import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8');
const loader = read('lib/teamworkWorkspace.ts');
const notesRoute = read('app/api/teamwork/[token]/notes/route.ts');
const shareHelper = read('lib/teamworkSharing.ts');
const joinRoute = read('app/api/teamwork/[token]/join/route.ts');
const publicPage = read('components/SharedTeamworkWorkspace.tsx');
const middleware = read('middleware.ts');
const migration = read('supabase/migrations/20260904082908_lightweight_teamwork_sharing.sql');

test('shared workspace is a separate route and projects no candidate files, resume text, dispositions, or private notes', () => {
  assert.match(read('app/teamwork/[token]/page.tsx'), /SharedTeamworkWorkspace/);
  assert.doesNotMatch(loader, /from\('phase1_candidate_private_notes'\)/);
  assert.doesNotMatch(loader, /from\('phase1_candidate_files'\)/);
  const candidateSelect = loader.match(/phase1_candidates'\)\.select\('([^']+)'\)/)?.[1] || '';
  assert.ok(candidateSelect);
  assert.doesNotMatch(candidateSelect, /resume_text|source_storage_path|source_filename|disposition/);
});

test('every public lookup and candidate contribution is bound to the one shared requisition', () => {
  assert.match(shareHelper, /\.eq\('public_token', token\)/);
  assert.match(notesRoute, /\.eq\('requisition_id', share\.requisition_id\)/);
  assert.match(notesRoute, /Candidate not found in this shared requisition/);
  assert.match(loader, /\.eq\('requisition_id', requisitionId\)/);
});

test('guest identity is an opaque HttpOnly session and note authorship comes only from the verified participant', () => {
  assert.match(shareHelper, /httpOnly: true/);
  assert.match(joinRoute, /session_token_hash: sessionHash\(secret\)/);
  assert.match(notesRoute, /author_name: participant\.display_name/);
  assert.doesNotMatch(notesRoute, /body\.author_name|body\.authorName/);
});

test('viewer and contributor access, inviter attribution, roles, timestamps, and revocation are explicit', () => {
  assert.match(notesRoute, /share\.access_level !== 'contributor'/);
  assert.match(publicPage, /View only/);
  assert.match(publicPage, /Contributor/);
  assert.match(publicPage, /Invited by/);
  assert.match(publicPage, /Who’s joining\?/);
  assert.match(migration, /invited_by_name/);
  assert.match(migration, /context_role/);
  assert.match(migration, /joined_at/);
  assert.match(migration, /last_seen_at/);
  assert.match(migration, /revoked_at/);
});

test('Teamwork routes bypass only the site gate while database tables remain service-role only', () => {
  assert.match(middleware, /'\/teamwork'/);
  assert.match(middleware, /'\/api\/teamwork'/);
  assert.match(middleware, /pathname\.startsWith\('\/teamwork\/'\)/);
  assert.match(middleware, /x-stapphire-public-invite/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all[\s\S]+from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete[\s\S]+to service_role/);
});

test('lightweight sharing contains no Supabase magic-link or OTP authentication flow', () => {
  const combined = [shareHelper, joinRoute, publicPage].join('\n');
  assert.doesNotMatch(combined, /signInWithOtp|magiclink|magic-link|supabase\.auth/);
});
