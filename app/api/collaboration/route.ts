import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

// Append-only: this route only ever inserts. There is no PATCH/DELETE
// here on purpose — the evaluation's evidence and the human's decision
// both get preserved permanently, side by side, per the Collaboration
// section of the spec.

export async function GET(req: NextRequest) {
  const requisitionId = req.nextUrl.searchParams.get('requisition_id');
  const candidateId = req.nextUrl.searchParams.get('candidate_id');
  const scope = req.nextUrl.searchParams.get('scope');
  if (!requisitionId) return NextResponse.json({ error: 'requisition_id required' }, { status: 400 });

  let query = supabaseAdmin
    .from('collaboration_events')
    .select('*, profiles(full_name, role)')
    .eq('requisition_id', requisitionId)
    .order('created_at', { ascending: false });

  if (candidateId) {
    query = query.eq('candidate_id', candidateId);
  } else if (scope === 'general') {
    query = query.is('candidate_id', null);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data });
}

// Accepts multipart form data so a comment can optionally carry a file
// attachment — same shape whether or not a file is included, which
// keeps the client simple (always FormData, never branching by type).
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const requisition_id = formData.get('requisition_id') as string | null;
    const candidate_id = formData.get('candidate_id') as string | null;
    const actor_name = formData.get('actor_name') as string | null;
    const event_type = formData.get('event_type') as string | null;
    const comment = formData.get('comment') as string | null;
    const decision = formData.get('decision') as string | null;
    const file = formData.get('file') as File | null;

    if (!requisition_id || !event_type) {
      return NextResponse.json({ error: 'requisition_id and event_type are required' }, { status: 400 });
    }
    if (event_type === 'decision' && !decision) {
      return NextResponse.json({ error: 'decision events require a decision value and a reason in comment' }, { status: 400 });
    }

    let attachment_path: string | null = null;
    let attachment_filename: string | null = null;

    if (file && file.size > 0) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const scopePart = candidate_id || 'general';
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${requisition_id}/${scopePart}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from('collaboration-attachments')
        .upload(path, buffer, { contentType: file.type || 'application/octet-stream' });

      if (uploadError) {
        return NextResponse.json({ error: `Attachment upload failed: ${uploadError.message}` }, { status: 500 });
      }

      attachment_path = path;
      attachment_filename = file.name;
    }

    const { data, error } = await supabaseAdmin
      .from('collaboration_events')
      .insert({
        requisition_id,
        candidate_id: candidate_id || null,
        actor_name: actor_name || null,
        event_type,
        comment,
        decision,
        attachment_path,
        attachment_filename
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ event: data });
  } catch (err: any) {
    console.error('Failed to log collaboration event:', err);
    return NextResponse.json({ error: err.message ?? 'Failed to log event' }, { status: 500 });
  }
}
