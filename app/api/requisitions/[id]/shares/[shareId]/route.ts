import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: { shareId: string } }) {
  const { error } = await supabaseAdmin.from('requisition_shares').delete().eq('id', params.shareId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
