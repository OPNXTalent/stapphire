import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getLatestHiringCriteriaOperation, getResumeOperations } from '@/lib/operations';
import { normalizeHiringCriteriaError } from '@/lib/hiringCriteriaError';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function diagnosticHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name);
  return value && value.length <= 200 ? value : null;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const [operation, resumeOperations] = await Promise.all([
      getLatestHiringCriteriaOperation(params.id),
      getResumeOperations(params.id)
    ]);
    // Explicit server-side cache invalidation for the requisition page,
    // independent of the client's router.refresh() call. router.refresh()
    // is invoked from a component that lives in the shared layout tree
    // (AppShell/WorkspacePanel), not the page itself - client-side
    // refresh propagation from that position is not guaranteed to
    // invalidate the page's cached render on every call. Revalidating
    // here, server-side, on every poll that has relevant operations to
    // report, ensures the next client refresh actually gets fresh data
    // regardless of that client-side mechanism's reliability.
    if (resumeOperations.length > 0 || operation) {
      revalidatePath(`/requisitions/${params.id}`);
    }
    const returnedOperationIds = resumeOperations.map((resumeOperation) => resumeOperation.id);
    const targetOperationId = diagnosticHeader(request, 'x-stapphire-target-operation-id');
    console.info('Resume operation identity poll', {
      requisitionId: params.id,
      pollSequence: diagnosticHeader(request, 'x-stapphire-poll-sequence'),
      clientBatchKey: diagnosticHeader(request, 'x-stapphire-client-batch-key'),
      localOperationId: diagnosticHeader(request, 'x-stapphire-local-operation-id'),
      localPhase: diagnosticHeader(request, 'x-stapphire-local-phase'),
      targetOperationId,
      targetContextOperationId: diagnosticHeader(request, 'x-stapphire-target-context-operation-id'),
      trackedOperationId: diagnosticHeader(request, 'x-stapphire-tracked-operation-id'),
      attemptedReconstruction: diagnosticHeader(request, 'x-stapphire-attempted-reconstruction'),
      returnedOperationIds,
      newestReturnedOperationId: returnedOperationIds[0] || null,
      targetPresentInResponse: Boolean(targetOperationId && returnedOperationIds.includes(targetOperationId))
    });
    return NextResponse.json({ operation, resumeOperations }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' }
    });
  } catch (error) {
    console.error('Operation status read failed', {
      requisitionId: params.id,
      error: normalizeHiringCriteriaError(error)
    });
    return NextResponse.json({ error: 'Unable to load operation status.' }, { status: 500 });
  }
}
