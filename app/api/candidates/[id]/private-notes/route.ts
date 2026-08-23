import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { data, error } = await supabaseAdmin
      .from('phase1_candidate_private_notes')
      .select('id, author_name, body, created_at')
      .eq('candidate_id', params.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ notes: data ?? [] });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to load private candidate notes.' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const authorName = String(body.author_name ?? '').trim();
    const noteBody = String(body.body ?? '').trim();

    if (!authorName || !noteBody) {
      return NextResponse.json({ error: 'Name and note are both required.' }, { status: 400 });
    }
    if (authorName.length > 80) {
      return NextResponse.json({ error: 'Name is too long.' }, { status: 400 });
    }
    if (noteBody.length > 4000) {
      return NextResponse.json({ error: 'Note is too long.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('phase1_candidate_private_notes')
      .insert({ candidate_id: params.id, author_name: authorName, body: noteBody })
      .select('id, author_name, body, created_at')
      .single();
    if (error) throw error;

    return NextResponse.json({ note: data }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to post private candidate note.' }, { status: 500 });
  }
}
