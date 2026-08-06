import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// One combined view: archived requisitions (non-destructive, always
// restorable) and trashed resumes across every requisition in the org
// (recoverable, but the one place that eventually leads to permanent
// removal via Empty Trash).
export async function GET(req: NextRequest, { params }: { params: { orgId: string } }) {
  const { data: archivedRequisitions, error: reqError } = await supabaseAdmin
    .from('requisitions')
    .select('id, title, archived_at')
    .eq('org_id', params.orgId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });

  if (reqError) return NextResponse.json({ error: reqError.message }, { status: 500 });

  const { data: requisitionIds } = await supabaseAdmin
    .from('requisitions')
    .select('id')
    .eq('org_id', params.orgId);

  const ids = (requisitionIds ?? []).map((r) => r.id);

  let trashedCandidates: any[] = [];
  if (ids.length > 0) {
    const { data, error: candError } = await supabaseAdmin
      .from('candidates')
      .select('id, full_name, deleted_at, requisitions(title)')
      .in('requisition_id', ids)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });

    if (candError) return NextResponse.json({ error: candError.message }, { status: 500 });
    trashedCandidates = data ?? [];
  }

  return NextResponse.json({
    archivedRequisitions: archivedRequisitions ?? [],
    trashedCandidates
  });
}
