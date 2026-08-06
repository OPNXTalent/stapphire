import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Resolves the share token to a real requisition, then creates a fixed
// identity record for this visitor. The client only ever stores the
// returned id + name — the name itself lives in the database from this
// point on, not as editable client-side text.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const { name } = await req.json();
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const { data: requisition, error: reqError } = await supabaseAdmin
      .from('requisitions')
      .select('id')
      .eq('share_token', params.token)
      .single();

    if (reqError || !requisition) {
      return NextResponse.json({ error: 'Invalid or expired share link' }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from('share_collaborators')
      .insert({ requisition_id: requisition.id, name: name.trim() })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ collaborator: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to register collaborator' }, { status: 500 });
  }
}
