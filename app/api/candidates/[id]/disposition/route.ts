import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const ALLOWED = ['screen', 'interview', 'hire', 'delete', ''] as const;

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const disposition = String(body.disposition ?? '');
    if (!ALLOWED.includes(disposition as (typeof ALLOWED)[number])) {
      return NextResponse.json({ error: 'Invalid disposition value.' }, { status: 400 });
    }
    const { error } = await supabaseAdmin
      .from('phase1_candidates')
      .update({
        disposition: disposition || null,
        // Selecting Delete is a real action, not just a label - it
        // soft-deletes the candidate into the trash bin. Any other
        // disposition value clears deleted_at in case this candidate
        // was somehow re-triaged from a restored state.
        deleted_at: disposition === 'delete' ? new Date().toISOString() : null
      })
      .eq('id', params.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to update disposition.' }, { status: 500 });
  }
}
