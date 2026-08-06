import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Notes are append-only, like collaboration events — each save adds a
// new entry rather than overwriting the last one, so a recruiter's
// earlier thinking on a candidate is never silently lost.

export async function GET(req: NextRequest) {
  const candidateId = req.nextUrl.searchParams.get('candidate_id');
  if (!candidateId) return NextResponse.json({ error: 'candidate_id required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('notes')
    .select('*, profiles(full_name)')
    .eq('candidate_id', candidateId)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { candidate_id, author_id, body: noteBody } = body;

    if (!candidate_id || !noteBody?.trim()) {
      return NextResponse.json({ error: 'candidate_id and a non-empty body are required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('notes')
      .insert({ candidate_id, author_id: author_id ?? null, body: noteBody })
      .select('*, profiles(full_name)')
      .single();

    if (error) throw error;
    return NextResponse.json({ note: data });
  } catch (err: any) {
    console.error('Save note failed:', err);
    return NextResponse.json({ error: err.message ?? 'Failed to save note' }, { status: 500 });
  }
}
