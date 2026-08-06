import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { data: event, error } = await supabaseAdmin
    .from('collaboration_events')
    .select('attachment_path, attachment_filename')
    .eq('id', params.id)
    .single();

  if (error || !event || !event.attachment_path) {
    return NextResponse.json({ error: 'No attachment on record for this comment' }, { status: 404 });
  }

  const { data, error: signError } = await supabaseAdmin.storage
    .from('collaboration-attachments')
    .createSignedUrl(event.attachment_path, 60, { download: event.attachment_filename ?? true });

  if (signError || !data) {
    return NextResponse.json({ error: signError?.message ?? 'Could not generate download link' }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl });
}
