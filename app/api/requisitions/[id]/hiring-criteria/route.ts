import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { HIRING_CRITERIA_EXTRACTOR_VERSION } from '@/lib/hiringCriteriaExtractor';
import { normalizeHiringCriteriaError } from '@/lib/hiringCriteriaError';
import { operationQueue } from '@/lib/operationQueue';
import { markHiringCriteriaDispatchFailed } from '@/lib/operations';

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
      if (!data || typeof data !== 'object' || typeof data.draftWeight !== 'number' || typeof data.isKnockout !== 'boolean') {
        throw new Error('Knockout update returned an invalid persisted state.');
      }
      return NextResponse.json({ draftWeight: data.draftWeight, isKnockout: data.isKnockout });
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
    console.error('Hiring Criteria update failed', { requisitionId: params.id, error: normalizeHiringCriteriaError(error) });
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
      if (error) {
        console.error('Hiring Criteria activation failed', {
          requisitionId: params.id,
          error: normalizeHiringCriteriaError(error)
        });
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (!data || typeof data !== 'object' || typeof data.versionId !== 'string' || typeof data.basisId !== 'string') throw new Error('Hiring Criteria activation returned an invalid state.');
      return NextResponse.json({ versionId: data.versionId, basisId: data.basisId }, { status: 201 });
    }
    if (body.action === 'generate') {
      const { data, error } = await supabaseAdmin.rpc('create_phase1_hiring_criteria_operation', {
        p_requisition_id: params.id,
        p_extractor_version: HIRING_CRITERIA_EXTRACTOR_VERSION
      });
      if (error) throw error;
      if (!data || typeof data !== 'object' || typeof data.id !== 'string' || typeof data.status !== 'string') {
        throw new Error('Hiring Criteria operation creation returned an invalid state.');
      }
      if (data.shouldDispatch === true) {
        try {
          await operationQueue.enqueueHiringCriteria({ operationId: data.id });
        } catch (dispatchError) {
          await markHiringCriteriaDispatchFailed(data.id, dispatchError);
          throw dispatchError;
        }
      }
      return NextResponse.json({ operation: { id: data.id, status: data.status } }, { status: 202 });
    }
    return NextResponse.json({ error: 'Invalid Hiring Criteria action.' }, { status: 400 });
  } catch (error) {
    console.error('Hiring Criteria action failed', { requisitionId: params.id, error: normalizeHiringCriteriaError(error) });
    return NextResponse.json({ error: 'Unable to update Hiring Criteria.' }, { status: 500 });
  }
}
