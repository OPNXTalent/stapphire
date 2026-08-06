import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Archiving is deliberately non-destructive — sets the requisition
// aside from the active "Other Requisitions" list, nothing more. There
// is no cascade, no data loss, and no path to permanent removal here.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await supabaseAdmin
    .from('requisitions')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
