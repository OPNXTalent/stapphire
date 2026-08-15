import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { hashJobDescription } from '@/lib/evaluationBasis';

type UpdatedRequisition = {
  requisition_id: string;
  position_title: string;
  persisted_job_description: string;
  persisted_job_description_updated_at: string;
};

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const title = String(body.title || '').trim();
    const jobDescription = String(body.job_description || '').trim();
    if (!title || !jobDescription) return NextResponse.json({ error: 'Position title and Job Description are required.' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .rpc('update_phase1_requisition_with_evaluation_basis', {
        p_requisition_id: params.id,
        p_title: title,
        p_job_description: jobDescription,
        p_job_description_hash: hashJobDescription(jobDescription)
      })
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });
    const updated = data as unknown as UpdatedRequisition;
    return NextResponse.json({ id: updated.requisition_id, title: updated.position_title, jobDescription: updated.persisted_job_description, jobDescriptionUpdatedAt: updated.persisted_job_description_updated_at });
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
