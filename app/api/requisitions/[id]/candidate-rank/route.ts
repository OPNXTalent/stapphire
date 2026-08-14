import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const orderedIds = Array.isArray(body.orderedIds)
      ? body.orderedIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    const { data: activeCandidates, error: readError } = await supabaseAdmin
      .from('phase1_candidates')
      .select('id')
      .eq('requisition_id', params.id)
      .is('deleted_at', null);
    if (readError) throw readError;

    const activeIds = (activeCandidates ?? []).map((candidate) => candidate.id);
    const submitted = new Set(orderedIds);
    if (orderedIds.length !== activeIds.length || submitted.size !== orderedIds.length || activeIds.some((id) => !submitted.has(id))) {
      return NextResponse.json({ error: 'Candidate order is stale. Refresh and try again.' }, { status: 409 });
    }

    const { error: updateError } = await supabaseAdmin.rpc('set_phase1_candidate_ranks', {
      p_requisition_id: params.id,
      p_ordered_ids: orderedIds
    });
    if (updateError) throw updateError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to save candidate ranking.' }, { status: 500 });
  }
}
