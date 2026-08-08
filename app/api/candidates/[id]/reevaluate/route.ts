import { NextRequest, NextResponse } from 'next/server';
import { reevaluateCandidate } from '@/lib/reevaluateCandidate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Free — re-evaluating a candidate you've already paid to evaluate
// once should never cost anything further. See lib/reevaluateCandidate
// for the shared logic also used by automatic course-correction
// re-evaluation after a discovery chat exchange.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const result = await reevaluateCandidate(params.id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ evaluation: result.evaluation });
}
