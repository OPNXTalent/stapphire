import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// The resumes bucket is private. Rather than storing a permanent public
// URL, we keep the storage path and mint a short-lived signed URL on
// each download request — the file itself is never publicly reachable
// without going through this authenticated route.

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { data: candidate, error } = await supabaseAdmin
    .from('candidates')
    .select('original_file_url, source_filename')
    .eq('id', params.id)
    .single();

  if (error || !candidate) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  if (!candidate.original_file_url) {
    return NextResponse.json({ error: 'No original file on record for this candidate' }, { status: 404 });
  }

  const { data, error: signError } = await supabaseAdmin.storage
    .from('resumes')
    .createSignedUrl(candidate.original_file_url, 60, {
      download: candidate.source_filename ?? true
    });

  if (signError || !data) {
    return NextResponse.json({ error: signError?.message ?? 'Could not generate download link' }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl });
}
