import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { data: requisition, error: reqError } = await supabaseAdmin
    .from('requisitions')
    .select('*, organizations(*)')
    .eq('id', params.id)
    .single();

  if (reqError || !requisition) {
    return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
  }

  const { data: candidates, error: candError } = await supabaseAdmin
    .from('candidates')
    .select('*, evaluations(*)')
    .eq('requisition_id', params.id)
    .order('created_at', { ascending: false });

  if (candError) {
    return NextResponse.json({ error: candError.message }, { status: 500 });
  }

  // Sort by overall_match descending for the Matrix / rank badges
  const sorted = [...(candidates ?? [])].sort((a, b) => {
    const scoreA = a.evaluations?.[0]?.overall_match ?? -1;
    const scoreB = b.evaluations?.[0]?.overall_match ?? -1;
    return scoreB - scoreA;
  });

  return NextResponse.json({ requisition, candidates: sorted });
}
