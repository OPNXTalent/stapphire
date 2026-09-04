import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { newSessionSecret, resolveActiveShare, sessionHash, setTeamworkSessionCookie, TEAMWORK_CONTEXTS } from '@/lib/teamworkSharing';

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const share = await resolveActiveShare(params.token);
    if (!share) return NextResponse.json({ error: 'This Teamwork link is invalid or has been revoked.' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const displayName = String(body.displayName || '').trim();
    const contextRole = String(body.contextRole || '');
    if (!displayName || displayName.length > 80) return NextResponse.json({ error: 'Enter your name.' }, { status: 400 });
    if (!(TEAMWORK_CONTEXTS as readonly string[]).includes(contextRole)) return NextResponse.json({ error: 'Choose how you are contributing.' }, { status: 400 });
    const secret = newSessionSecret();
    const { data: participant, error } = await supabaseAdmin.from('phase1_teamwork_participants').insert({
      share_id: share.id,
      display_name: displayName,
      context_role: contextRole,
      session_token_hash: sessionHash(secret)
    }).select('id,display_name,context_role,joined_at,last_seen_at').single();
    if (error) throw error;
    const response = NextResponse.json({ participant }, { status: 201 });
    setTeamworkSessionCookie(response, participant.id, secret);
    return response;
  } catch (error) {
    console.error('Teamwork join failed', { error });
    return NextResponse.json({ error: 'Unable to enter the Teamwork workspace.' }, { status: 500 });
  }
}
