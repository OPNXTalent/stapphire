import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveShare, verifyTeamworkParticipant } from '@/lib/teamworkSharing';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const share = await resolveActiveShare(params.token);
    if (!share) return NextResponse.json({ error: 'This Teamwork link is invalid or has been revoked.' }, { status: 404 });
    const participant = await verifyTeamworkParticipant(request, share.id);
    if (!participant) return NextResponse.json({ error: 'Join this Teamwork workspace before contributing.' }, { status: 401 });
    if (share.access_level !== 'contributor') return NextResponse.json({ error: 'This is a view-only Teamwork link.' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const noteBody = String(body.body || '').trim();
    const scope = body.scope === 'candidate' ? 'candidate' : 'requisition';
    if (!noteBody) return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
    if (noteBody.length > 4000) return NextResponse.json({ error: 'Message is too long.' }, { status: 400 });

    let query;
    if (scope === 'candidate') {
      const candidateId = String(body.candidateId || '');
      const { data: candidate, error: candidateError } = await supabaseAdmin.from('phase1_candidates').select('id').eq('id', candidateId).eq('requisition_id', share.requisition_id).is('deleted_at', null).maybeSingle();
      if (candidateError) throw candidateError;
      if (!candidate) return NextResponse.json({ error: 'Candidate not found in this shared requisition.' }, { status: 404 });
      query = supabaseAdmin.from('phase1_candidate_teamwork_notes').insert({ candidate_id: candidateId, author_name: participant.display_name, body: noteBody, teamwork_participant_id: participant.id });
    } else {
      query = supabaseAdmin.from('phase1_requisition_notes').insert({ requisition_id: share.requisition_id, author_name: participant.display_name, body: noteBody, teamwork_participant_id: participant.id });
    }
    const { data: note, error } = await query.select('id,author_name,body,created_at').single();
    if (error) throw error;
    await supabaseAdmin.from('phase1_teamwork_participants').update({ last_seen_at: new Date().toISOString() }).eq('id', participant.id).eq('share_id', share.id);
    return NextResponse.json({ note: { ...note, context_role: participant.context_role } }, { status: 201 });
  } catch (error) {
    console.error('Shared Teamwork note failed', { error });
    return NextResponse.json({ error: 'Unable to post the Teamwork note.' }, { status: 500 });
  }
}
