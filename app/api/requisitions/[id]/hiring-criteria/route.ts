import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const criterionId = String(body.criterionId || '');
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
    return NextResponse.json({ error: 'Invalid Hiring Criteria action.' }, { status: 400 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to update Hiring Criteria.' }, { status: 500 });
  }
}
