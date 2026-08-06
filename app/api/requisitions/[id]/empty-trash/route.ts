import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Permanently removes every trashed candidate for this requisition —
// the one irreversible step in the whole delete flow. Evaluations,
// notes, and collaboration events cascade-delete automatically via the
// schema's foreign keys; the stored resume file is cleaned up here
// explicitly since Storage isn't covered by SQL cascade rules.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { data: trashed, error: fetchError } = await supabaseAdmin
    .from('candidates')
    .select('id, original_file_url')
    .eq('requisition_id', params.id)
    .not('deleted_at', 'is', null);

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

  const paths = (trashed ?? []).map((c) => c.original_file_url).filter(Boolean) as string[];
  if (paths.length > 0) {
    const { error: storageError } = await supabaseAdmin.storage.from('resumes').remove(paths);
    if (storageError) console.error('Failed to remove some resume files from storage:', storageError);
  }

  const { error: deleteError } = await supabaseAdmin
    .from('candidates')
    .delete()
    .eq('requisition_id', params.id)
    .not('deleted_at', 'is', null);

  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  return NextResponse.json({ success: true, removed: trashed?.length ?? 0 });
}
