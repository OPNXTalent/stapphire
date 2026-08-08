import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServerClient';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authClient = createSupabaseServerClient();
  const {
    data: { user }
  } = await authClient.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  // Real authorization: this exact requisition_id must have been
  // explicitly granted to this exact verified email. Knowing the ID
  // alone (e.g. from a URL) grants nothing.
  const { data: grant } = await supabaseAdmin
    .from('requisition_shares')
    .select('access_level')
    .eq('requisition_id', params.id)
    .eq('shared_with_email', user.email)
    .maybeSingle();

  if (!grant) {
    return NextResponse.json({ error: 'You do not have access to this requisition' }, { status: 403 });
  }

  const { data: requisition, error: reqError } = await supabaseAdmin
    .from('requisitions')
    .select('id, title, status, job_description, evaluation_pillars, profile_revision')
    .eq('id', params.id)
    .single();

  if (reqError || !requisition) {
    return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
  }

  const { data: candidates, error: candError } = await supabaseAdmin
    .from('candidates')
    .select('id, full_name, source_filename, original_file_url, document_type, disposition, additional_context, resume_text, evaluations(*)')
    .eq('requisition_id', params.id)
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

  return NextResponse.json({ requisition, candidates: sorted, accessLevel: grant.access_level });
}
