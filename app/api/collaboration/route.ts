import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Append-only: this route only ever inserts. There is no PATCH/DELETE
// here on purpose — the evaluation's evidence and the human's decision
// both get preserved permanently, side by side, per the Collaboration
// section of the spec.

export async function GET(req: NextRequest) {
  const requisitionId = req.nextUrl.searchParams.get('requisition_id');
  const candidateId = req.nextUrl.searchParams.get('candidate_id');
  if (!requisitionId) return NextResponse.json({ error: 'requisition_id required' }, { status: 400 });

  let query = supabaseAdmin
    .from('collaboration_events')
    .select('*, profiles(full_name, role)')
    .eq('requisition_id', requisitionId)
    .order('created_at', { ascending: false });

  // Scope to one candidate when opened from a specific row, so the
  // panel shows that candidate's history rather than the whole
  // requisition's noise.
  if (candidateId) {
    query = query.eq('candidate_id', candidateId);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { requisition_id, candidate_id, actor_id, event_type, comment, decision } = body;

    if (!requisition_id || !event_type) {
      return NextResponse.json({ error: 'requisition_id and event_type are required' }, { status: 400 });
    }
    if (event_type === 'decision' && !decision) {
      return NextResponse.json({ error: 'decision events require a decision value and a reason in comment' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('collaboration_events')
      .insert({ requisition_id, candidate_id, actor_id: actor_id ?? null, event_type, comment, decision })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ event: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to log event' }, { status: 500 });
  }
}
