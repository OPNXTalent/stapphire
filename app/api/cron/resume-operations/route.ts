import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { operationQueue } from '@/lib/operationQueue';
import { normalizeHiringCriteriaError } from '@/lib/hiringCriteriaError';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const reconciliationSecret = process.env.RESUME_RECONCILIATION_SECRET;
  if (!reconciliationSecret) {
    console.error('Resume reconciliation secret is not configured');
    return NextResponse.json({ error: 'Reconciliation is unavailable.' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${reconciliationSecret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { data: items, error } = await supabaseAdmin
    .from('phase1_operation_items')
    .select('id,phase1_operations!inner(operation_type)')
    .eq('status', 'queued')
    .lte('available_at', new Date().toISOString())
    .eq('phase1_operations.operation_type', 'resume_batch_evaluation')
    .order('available_at', { ascending: true })
    .limit(100);
  if (error) {
    console.error('Resume operation reconciliation read failed', { error: normalizeHiringCriteriaError(error) });
    return NextResponse.json({ error: 'Resume operation reconciliation failed.' }, { status: 500 });
  }

  const dispatches = await Promise.allSettled(
    (items || []).map((item) => operationQueue.enqueueResumeEvaluation({ operationItemId: item.id }))
  );
  const rejected = dispatches.filter((result) => result.status === 'rejected');
  if (rejected.length) {
    console.error('Resume operation reconciliation dispatch failed', {
      failed: rejected.length,
      error: normalizeHiringCriteriaError(rejected[0].reason)
    });
  }
  return NextResponse.json({
    inspected: items?.length || 0,
    dispatched: dispatches.length - rejected.length
  });
}
