import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Sets a candidate's pipeline stage and logs it as a permanent
// collaboration event — the disposition itself is the current state
// (fast to query, drives the pill), the event is the history (who
// moved this candidate to this stage, and when). Neither overwrites
// the other, matching how the AI's evaluation and human decisions are
// both preserved elsewhere in the app.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { disposition, actor_name } = await req.json();

    const { data: candidate, error } = await supabaseAdmin
      .from('candidates')
      .update({ disposition: disposition || null })
      .eq('id', params.id)
      .select('requisition_id, full_name')
      .single();

    if (error) throw error;

    if (disposition) {
      await supabaseAdmin.from('collaboration_events').insert({
        requisition_id: candidate.requisition_id,
        candidate_id: params.id,
        actor_name: actor_name || null,
        event_type: 'decision',
        decision: disposition
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to update disposition' }, { status: 500 });
  }
}
