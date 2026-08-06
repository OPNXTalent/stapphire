import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabaseAdmin
    .from('requisition_shares')
    .select('id, shared_with_email, access_level, created_at')
    .eq('requisition_id', params.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shares: data });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { email, access_level } = await req.json();
    if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('requisition_shares')
      .insert({
        requisition_id: params.id,
        shared_with_email: email.trim().toLowerCase(),
        access_level: access_level || 'collaborate'
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ share: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to grant access' }, { status: 500 });
  }
}
