import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Resolves a share token to a deliberately limited view: no org/credit/
// billing data, no deleted candidates, no Private Notes anywhere in the
// payload. Whoever holds this link never sees anything beyond what a
// hiring manager should see.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const { data: requisition, error: reqError } = await supabaseAdmin
    .from('requisitions')
    .select('id, title, status, job_description')
    .eq('share_token', params.token)
    .single();

  if (reqError || !requisition) {
    return NextResponse.json({ error: 'Invalid or expired share link' }, { status: 404 });
  }

  const { data: candidates, error: candError } = await supabaseAdmin
    .from('candidates')
    .select('id, full_name, source_filename, original_file_url, document_type, disposition, evaluations(*)')
    .eq('requisition_id', requisition.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('created_at', { foreignTable: 'evaluations', ascending: false });

  if (candError) {
    return NextResponse.json({ error: candError.message }, { status: 500 });
  }

  const sorted = [...(candidates ?? [])].sort((a, b) => {
    const scoreA = a.evaluations?.[0]?.overall_match ?? -1;
    const scoreB = b.evaluations?.[0]?.overall_match ?? -1;
    return scoreB - scoreA;
  });

  return NextResponse.json({ requisition, candidates: sorted });
}
