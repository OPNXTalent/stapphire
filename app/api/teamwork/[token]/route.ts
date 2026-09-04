import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveShare, verifyTeamworkParticipant } from '@/lib/teamworkSharing';
import { loadSharedTeamworkWorkspace } from '@/lib/teamworkWorkspace';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const share = await resolveActiveShare(params.token);
    if (!share) return NextResponse.json({ error: 'This Teamwork link is invalid or has been revoked.' }, { status: 404 });
    const { data: requisition, error } = await supabaseAdmin.from('phase1_requisitions').select('title').eq('id', share.requisition_id).is('archived_at', null).maybeSingle();
    if (error) throw error;
    if (!requisition) return NextResponse.json({ error: 'This requisition is no longer available.' }, { status: 404 });

    const participant = await verifyTeamworkParticipant(request, share.id);
    const invitation = {
      title: requisition.title,
      invitedByName: share.invited_by_name,
      accessLevel: share.access_level,
      createdAt: share.created_at
    };
    if (!participant) return NextResponse.json({ joined: false, invitation });

    const workspace = await loadSharedTeamworkWorkspace(share.requisition_id);
    if (!workspace) return NextResponse.json({ error: 'This requisition is no longer available.' }, { status: 404 });
    const now = new Date().toISOString();
    await supabaseAdmin.from('phase1_teamwork_participants').update({ last_seen_at: now }).eq('id', participant.id).eq('share_id', share.id);
    return NextResponse.json({ joined: true, invitation, participant: { ...participant, last_seen_at: now }, workspace });
  } catch (error) {
    console.error('Shared Teamwork workspace load failed', { error });
    return NextResponse.json({ error: 'Unable to load this Teamwork workspace.' }, { status: 500 });
  }
}
