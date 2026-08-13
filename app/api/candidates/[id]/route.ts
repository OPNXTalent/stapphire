import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// Permanent delete - only allowed on a candidate already sitting in
// the trash (deleted_at set). This is the irreversible step; the
// soft-delete via the disposition route is what puts them here in the
// first place. Cascades to phase1_evaluations automatically.
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { data: candidate, error: fetchError } = await supabaseAdmin
      .from('phase1_candidates')
      .select('deleted_at')
      .eq('id', params.id)
      .single();
    if (fetchError) throw fetchError;
    if (!candidate?.deleted_at) {
      return NextResponse.json({ error: 'Only candidates already in the trash can be permanently deleted.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('phase1_candidates').delete().eq('id', params.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to permanently delete candidate.' }, { status: 500 });
  }
}
