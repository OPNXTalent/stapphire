import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Permanently removes every trashed resume across the org. Deliberately
// scoped to candidates only — archived requisitions are never touched
// here, since archiving has no permanent-deletion path in this product.
export async function POST(req: NextRequest, { params }: { params: { orgId: string } }) {
  const { data: requisitionIds } = await supabaseAdmin
    .from('requisitions')
    .select('id')
    .eq('org_id', params.orgId);

  const ids = (requisitionIds ?? []).map((r) => r.id);
  if (ids.length === 0) return NextResponse.json({ success: true, removed: 0 });

  const { data: trashed, error: fetchError } = await supabaseAdmin
    .from('candidates')
    .select('id, original_file_url')
    .in('requisition_id', ids)
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
    .in('requisition_id', ids)
    .not('deleted_at', 'is', null);

  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  return NextResponse.json({ success: true, removed: trashed?.length ?? 0 });
}
