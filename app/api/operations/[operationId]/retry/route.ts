import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { operationQueue } from '@/lib/operationQueue';
import { normalizeHiringCriteriaError } from '@/lib/hiringCriteriaError';

export const runtime = 'nodejs';

export async function POST(_: Request, { params }: { params: { operationId: string } }) {
  try {
    const { data, error } = await supabaseAdmin.rpc('retry_phase1_resume_operation_items', { p_operation_id: params.operationId });
    if (error) throw error;
    const itemIds = Array.isArray(data) ? data.filter((id): id is string => typeof id === 'string') : [];
    const dispatches = await Promise.allSettled(itemIds.map((operationItemId) => operationQueue.enqueueResumeEvaluation({ operationItemId })));
    await Promise.all(dispatches.map(async (result, index) => {
      if (result.status === 'rejected') {
        await supabaseAdmin.rpc('fail_phase1_resume_item_dispatch', {
          p_item_id: itemIds[index],
          p_error: normalizeHiringCriteriaError(result.reason)
        });
      }
    }));
    return NextResponse.json({ retried: dispatches.filter((result) => result.status === 'fulfilled').length });
  } catch (error) {
    console.error('Resume item retry failed', { operationId: params.operationId, error: normalizeHiringCriteriaError(error) });
    return NextResponse.json({ error: 'Unable to retry failed resume evaluations.' }, { status: 500 });
  }
}
