import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function comparableJobDescription(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const title = String(body.title || '').trim();
    const jobDescription = String(body.job_description || '').trim();
    if (!title || !jobDescription) return NextResponse.json({ error: 'Position title and Job Description are required.' }, { status: 400 });

    const { data: current, error: readError } = await supabaseAdmin
      .from('phase1_requisitions')
      .select('id,job_description')
      .eq('id', params.id)
      .is('archived_at', null)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });

    const jobDescriptionChanged = comparableJobDescription(current.job_description) !== comparableJobDescription(jobDescription);
    const updates: Record<string, string> = { title, job_description: jobDescription, updated_at: new Date().toISOString() };
    if (jobDescriptionChanged) updates.job_description_updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('phase1_requisitions')
      .update(updates)
      .eq('id', params.id)
      .is('archived_at', null)
      .select('id,title,job_description,job_description_updated_at')
      .single();
    if (error) throw error;
    return NextResponse.json({ id: data.id, title: data.title, jobDescription: data.job_description, jobDescriptionUpdatedAt: data.job_description_updated_at });
  } catch (error) {
    console.error('Requisition update failed', error);
    return NextResponse.json({ error: 'Unable to update requisition.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { data, error } = await supabaseAdmin
      .from('phase1_requisitions')
      .delete()
      .eq('id', params.id)
      .not('archived_at', 'is', null)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Archived requisition not found.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to permanently delete requisition.' }, { status: 500 });
  }
}
