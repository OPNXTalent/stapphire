import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LIMIT = 5;
const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest, { params }: { params: { orgId: string } }) {
  const windowStart = new Date(Date.now() - WINDOW_MS);

  const { data, error } = await supabaseAdmin
    .from('free_trial_usage')
    .select('used_at')
    .eq('org_id', params.orgId)
    .gte('used_at', windowStart.toISOString())
    .order('used_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const used = data?.length ?? 0;
  const remaining = Math.max(0, LIMIT - used);
  // The window frees up one slot as soon as its oldest entry turns 24h old.
  const resetsAt = used > 0 ? new Date(new Date(data![0].used_at).getTime() + WINDOW_MS).toISOString() : null;

  return NextResponse.json({ limit: LIMIT, used, remaining, resetsAt });
}
