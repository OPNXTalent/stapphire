import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabaseAdmin
    .from('candidates')
    .select('*, evaluations(*)')
    .eq('requisition_id', params.id)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .order('created_at', { foreignTable: 'evaluations', ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ candidates: data });
}
