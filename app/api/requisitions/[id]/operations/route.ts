import { NextResponse } from 'next/server';
import { getLatestHiringCriteriaOperation, getResumeOperations } from '@/lib/operations';
import { normalizeHiringCriteriaError } from '@/lib/hiringCriteriaError';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const [operation, resumeOperations] = await Promise.all([
      getLatestHiringCriteriaOperation(params.id),
      getResumeOperations(params.id)
    ]);
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
