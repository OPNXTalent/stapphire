import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function PATCH(request: Request, { params }: { params: { token: string } }) {
  try {
    const body = await request.json();
    const participantName = String(body?.participantName ?? '').trim();

    if (!participantName || participantName.length > 200) {
      return NextResponse.json({ error: 'Participant name is required.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('phase1_interview_invitations')
      .update({ participant_name: participantName, updated_at: new Date().toISOString() })
      .eq('token', params.token)
      .neq('status', 'revoked')
      .select('id, participant_name, status')
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });

    return NextResponse.json({
      invitation: {
        id: data.id,
        participantName: data.participant_name,
        status: data.status
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to update interview invitation.' }, { status: 500 });
  }
}
