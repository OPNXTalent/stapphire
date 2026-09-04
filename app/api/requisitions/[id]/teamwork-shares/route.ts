import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

async function listShares(requisitionId: string, request: Request) {
  const { data: shares, error } = await supabaseAdmin
    .from('phase1_teamwork_shares')
    .select('id,public_token,invited_by_name,access_level,created_at,revoked_at')
    .eq('requisition_id', requisitionId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const ids = (shares || []).map((share) => share.id);
  const { data: participants, error: participantError } = ids.length
    ? await supabaseAdmin.from('phase1_teamwork_participants').select('id,share_id,display_name,context_role,joined_at,last_seen_at').in('share_id', ids).order('joined_at', { ascending: false })
    : { data: [], error: null };
  if (participantError) throw participantError;
  const origin = new URL(request.url).origin;
  return (shares || []).map((share) => ({
    ...share,
    url: `${origin}/teamwork/${share.public_token}`,
    participants: (participants || []).filter((participant) => participant.share_id === share.id)
  }));
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json({ shares: await listShares(params.id, request) });
  } catch (error) {
    console.error('Teamwork shares load failed', { requisitionId: params.id, error });
    return NextResponse.json({ error: 'Unable to load Teamwork links.' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const invitedByName = String(body.invitedByName || '').trim();
    const accessLevel = body.accessLevel === 'viewer' ? 'viewer' : 'contributor';
    if (!invitedByName || invitedByName.length > 80) return NextResponse.json({ error: 'Enter the inviter’s name.' }, { status: 400 });
    const { data: requisition, error: requisitionError } = await supabaseAdmin.from('phase1_requisitions').select('id').eq('id', params.id).is('archived_at', null).maybeSingle();
    if (requisitionError) throw requisitionError;
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });
    const { error } = await supabaseAdmin.from('phase1_teamwork_shares').insert({ requisition_id: params.id, invited_by_name: invitedByName, access_level: accessLevel });
    if (error) throw error;
    return NextResponse.json({ shares: await listShares(params.id, request) }, { status: 201 });
  } catch (error) {
    console.error('Teamwork share creation failed', { requisitionId: params.id, error });
    return NextResponse.json({ error: 'Unable to create the Teamwork link.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const shareId = String(body.shareId || '');
    const { data, error } = await supabaseAdmin.from('phase1_teamwork_shares').update({ revoked_at: new Date().toISOString() }).eq('id', shareId).eq('requisition_id', params.id).is('revoked_at', null).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Active Teamwork link not found.' }, { status: 404 });
    return NextResponse.json({ shares: await listShares(params.id, request) });
  } catch (error) {
    console.error('Teamwork share revocation failed', { requisitionId: params.id, error });
    return NextResponse.json({ error: 'Unable to revoke the Teamwork link.' }, { status: 500 });
  }
}
