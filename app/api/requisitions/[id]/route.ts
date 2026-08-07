import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { data: requisition, error: reqError } = await supabaseAdmin
    .from('requisitions')
    .select('*, organizations(*)')
    .eq('id', params.id)
    .single();

  if (reqError || !requisition) {
    return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
  }

  const { data: candidates, error: candError } = await supabaseAdmin
    .from('candidates')
    .select('*, evaluations(*)')
    .eq('requisition_id', params.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('created_at', { foreignTable: 'evaluations', ascending: false });

  if (candError) {
    return NextResponse.json({ error: candError.message }, { status: 500 });
  }

  // Sort by overall_match descending for the Matrix / rank badges
  const sorted = [...(candidates ?? [])].sort((a, b) => {
    const scoreA = a.evaluations?.[0]?.overall_match ?? -1;
    const scoreB = b.evaluations?.[0]?.overall_match ?? -1;
    return scoreB - scoreA;
  });

  return NextResponse.json({ requisition, candidates: sorted });
}

// Permanent deletion — deliberately requires the requisition to already
// be archived first, so there's no one-step path from an active role
// straight to permanent loss. Cleans up storage files (resumes and
// collaboration attachments) that the database's cascade delete can't
// reach on its own, then removes the requisition row — every related
// row (candidates, evaluations, collaboration history, notes, access
// grants) cascades automatically via the schema's foreign keys.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { data: requisition, error: reqError } = await supabaseAdmin
    .from('requisitions')
    .select('id, archived_at')
    .eq('id', params.id)
    .single();

  if (reqError || !requisition) {
    return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
  }

  if (!requisition.archived_at) {
    return NextResponse.json(
      { error: 'This requisition must be archived before it can be permanently deleted.' },
      { status: 400 }
    );
  }

  const { data: candidates } = await supabaseAdmin
    .from('candidates')
    .select('original_file_url')
    .eq('requisition_id', params.id);

  const resumePaths = (candidates ?? []).map((c) => c.original_file_url).filter(Boolean) as string[];
  if (resumePaths.length > 0) {
    const { error: storageError } = await supabaseAdmin.storage.from('resumes').remove(resumePaths);
    if (storageError) console.error('Failed to remove some resume files:', storageError);
  }

  const { data: attachments } = await supabaseAdmin
    .from('collaboration_events')
    .select('attachment_path')
    .eq('requisition_id', params.id)
    .not('attachment_path', 'is', null);

  const attachmentPaths = (attachments ?? []).map((a) => a.attachment_path).filter(Boolean) as string[];
  if (attachmentPaths.length > 0) {
    const { error: attachError } = await supabaseAdmin.storage.from('collaboration-attachments').remove(attachmentPaths);
    if (attachError) console.error('Failed to remove some attachment files:', attachError);
  }

  const { error: deleteError } = await supabaseAdmin.from('requisitions').delete().eq('id', params.id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
