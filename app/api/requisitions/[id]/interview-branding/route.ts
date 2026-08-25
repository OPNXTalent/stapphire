import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type BrandingInput = {
  paletteName?: unknown;
  primary?: unknown;
  accent?: unknown;
  logoUrl?: unknown;
  logoName?: unknown;
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_LOGO_DATA_URL = 1_500_000;

function normalizeBranding(value: BrandingInput) {
  const paletteName = String(value.paletteName ?? '').trim().slice(0, 80);
  const primary = String(value.primary ?? '').trim();
  const accent = String(value.accent ?? '').trim();
  const logoUrl = String(value.logoUrl ?? '');
  const logoName = String(value.logoName ?? '').trim().slice(0, 200);

  if (!paletteName) throw new Error('Palette name is required.');
  if (!HEX.test(primary) || !HEX.test(accent)) throw new Error('Brand colors must be valid hex colors.');
  if (logoUrl && (!logoUrl.startsWith('data:image/') || logoUrl.length > MAX_LOGO_DATA_URL)) {
    throw new Error('Logo image is invalid or too large.');
  }

  return { paletteName, primary, accent, logoUrl, logoName };
}

async function findRound(requisitionId: string, stage: string) {
  const { data: plan, error: planError } = await supabaseAdmin
    .from('phase1_interview_plans')
    .select('id')
    .eq('requisition_id', requisitionId)
    .maybeSingle();

  if (planError) throw planError;
  if (!plan) return null;

  const { data: round, error: roundError } = await supabaseAdmin
    .from('phase1_interview_rounds')
    .select('id, stage, title, branding')
    .eq('plan_id', plan.id)
    .eq('stage', stage)
    .maybeSingle();

  if (roundError) throw roundError;
  return round;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const stage = new URL(request.url).searchParams.get('stage')?.trim() ?? '';
    if (!stage) return NextResponse.json({ error: 'Interview form is required.' }, { status: 400 });

    const round = await findRound(params.id, stage);
    if (!round) return NextResponse.json({ error: 'Interview form not found.' }, { status: 404 });

    return NextResponse.json({
      interview: {
        stage: round.stage,
        title: round.title,
        branding: round.branding ?? {}
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to load interview form design.' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const stage = String(body?.stage ?? '').trim();
    if (!stage) return NextResponse.json({ error: 'Interview form is required.' }, { status: 400 });

    const branding = normalizeBranding(body?.branding ?? {});
    const round = await findRound(params.id, stage);
    if (!round) return NextResponse.json({ error: 'Interview form not found.' }, { status: 404 });

    const { error } = await supabaseAdmin
      .from('phase1_interview_rounds')
      .update({ branding })
      .eq('id', round.id);

    if (error) throw error;
    return NextResponse.json({ branding });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const validationError = message.includes('required') || message.includes('valid') || message.includes('too large');
    if (!validationError) console.error(error);
    return NextResponse.json(
      { error: validationError ? message : 'Unable to save interview form design.' },
      { status: validationError ? 400 : 500 }
    );
  }
}
