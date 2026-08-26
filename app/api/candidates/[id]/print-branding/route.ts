import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type Branding = {
  paletteName?: string;
  primary?: string;
  accent?: string;
  logoUrl?: string;
  logoName?: string;
};

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { data: candidate, error: candidateError } = await supabaseAdmin
      .from('phase1_candidates')
      .select('requisition_id')
      .eq('id', params.id)
      .maybeSingle();

    if (candidateError) throw candidateError;
    if (!candidate) return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });

    const { data: plan, error: planError } = await supabaseAdmin
      .from('phase1_interview_plans')
      .select('id')
      .eq('requisition_id', candidate.requisition_id)
      .maybeSingle();

    if (planError) throw planError;
    if (!plan) return NextResponse.json({ defaultBranding: {}, byStage: {} });

    const { data: rounds, error: roundsError } = await supabaseAdmin
      .from('phase1_interview_rounds')
      .select('stage, branding, sort_order')
      .eq('plan_id', plan.id)
      .order('sort_order', { ascending: true });

    if (roundsError) throw roundsError;

    const byStage: Record<string, Branding> = {};
    for (const round of rounds ?? []) byStage[round.stage] = (round.branding ?? {}) as Branding;

    const defaultBranding = (rounds ?? [])
      .map((round) => (round.branding ?? {}) as Branding)
      .find((branding) => branding.logoUrl || branding.primary || branding.accent) ?? {};

    return NextResponse.json({ defaultBranding, byStage });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to load print branding.' }, { status: 500 });
  }
}
