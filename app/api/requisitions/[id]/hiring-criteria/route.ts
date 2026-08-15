import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { generateHiringCriteria } from '@/lib/hiringCriteriaExtractor';

export const runtime = 'nodejs';

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const criterionId = String(body.criterionId || '');
    if (criterionId && typeof body.isKnockout === 'boolean') {
      const { data, error } = await supabaseAdmin.rpc('set_phase1_hiring_criterion_knockout', {
        p_requisition_id: params.id,
        p_criterion_id: criterionId,
        p_is_knockout: body.isKnockout
      });
      if (error) throw error;
      return NextResponse.json({ weight: data, isKnockout: body.isKnockout });
    }
    const delta = Number(body.delta);
    if (!criterionId || (delta !== -1 && delta !== 1)) return NextResponse.json({ error: 'Invalid criterion adjustment.' }, { status: 400 });
    const { data, error } = await supabaseAdmin.rpc('adjust_phase1_hiring_criterion', {
      p_requisition_id: params.id,
      p_criterion_id: criterionId,
      p_delta: delta
    });
    if (error) throw error;
    return NextResponse.json({ weight: data });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to update Hiring Criteria.' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    if (body.action === 'reset') {
      const { error } = await supabaseAdmin.rpc('reset_phase1_hiring_criteria', { p_requisition_id: params.id });
      if (error) throw error;
      return NextResponse.json({ reset: true });
    }
    if (body.action === 'apply') {
      const { data, error } = await supabaseAdmin.rpc('apply_phase1_hiring_criteria', { p_requisition_id: params.id });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ versionId: data }, { status: 201 });
    }
    if (body.action === 'generate') {
      const { data: requisition, error: requisitionError } = await supabaseAdmin
        .from('phase1_requisitions')
        .select('job_description')
        .eq('id', params.id)
        .is('archived_at', null)
        .single();
      if (requisitionError || !requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });
      await generateHiringCriteria(params.id, requisition.job_description);
      return NextResponse.json({ generated: true }, { status: 201 });
    }
    return NextResponse.json({ error: 'Invalid Hiring Criteria action.' }, { status: 400 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to update Hiring Criteria.' }, { status: 500 });
  }
}
