import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// Pulls a candidate back out of the trash - clears deleted_at and
// resets disposition, since 'delete' no longer makes sense once
// they're back in the active matrix and need re-triaging.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { error } = await supabaseAdmin
      .from('phase1_candidates')
      .update({ deleted_at: null, disposition: null })
      .eq('id', params.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to restore candidate.' }, { status: 500 });
  }
}
