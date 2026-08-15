import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
const RESUME_BUCKET = 'candidate-resumes';

function contentDisposition(filename: string): string {
  const safeAscii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'resume';
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { data: candidate, error: candidateError } = await supabaseAdmin
      .from('phase1_candidates')
      .select('source_filename,source_storage_path,source_mime_type')
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (candidateError) throw candidateError;
    if (!candidate?.source_storage_path) return NextResponse.json({ error: 'Resume unavailable.' }, { status: 404 });

    const { data, error } = await supabaseAdmin.storage.from(RESUME_BUCKET).download(candidate.source_storage_path);
    if (error || !data) throw error || new Error('Stored resume was not found.');
    return new NextResponse(await data.arrayBuffer(), {
      headers: {
        'Content-Type': candidate.source_mime_type || 'application/octet-stream',
        'Content-Disposition': contentDisposition(candidate.source_filename || 'resume'),
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('Resume download failed', error);
    return NextResponse.json({ error: 'Unable to download résumé.' }, { status: 500 });
  }
}
