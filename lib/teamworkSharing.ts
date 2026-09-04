import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const TEAMWORK_SESSION_COOKIE = 'stapphire_teamwork_guest';
export const TEAMWORK_CONTEXTS = ['hiring_manager', 'interviewer', 'department_leader', 'hr_ta', 'executive_sponsor', 'other'] as const;
export type TeamworkContext = typeof TEAMWORK_CONTEXTS[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sessionHash(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

export function newSessionSecret() {
  return randomBytes(32).toString('base64url');
}

export async function resolveActiveShare(token: string) {
  if (!UUID_PATTERN.test(token)) return null;
  const { data, error } = await supabaseAdmin
    .from('phase1_teamwork_shares')
    .select('id,requisition_id,public_token,invited_by_name,access_level,created_at,revoked_at')
    .eq('public_token', token)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function verifyTeamworkParticipant(request: NextRequest, shareId: string) {
  const raw = request.cookies.get(TEAMWORK_SESSION_COOKIE)?.value || '';
  const separator = raw.indexOf('.');
  if (separator < 1) return null;
  const participantId = raw.slice(0, separator);
  const secret = raw.slice(separator + 1);
  if (!UUID_PATTERN.test(participantId) || !secret) return null;
  const { data, error } = await supabaseAdmin
    .from('phase1_teamwork_participants')
    .select('id,share_id,display_name,context_role,joined_at,last_seen_at')
    .eq('id', participantId)
    .eq('share_id', shareId)
    .eq('session_token_hash', sessionHash(secret))
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function setTeamworkSessionCookie(response: NextResponse, participantId: string, secret: string) {
  response.cookies.set(TEAMWORK_SESSION_COOKIE, `${participantId}.${secret}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 90
  });
}
