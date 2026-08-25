import { NextResponse } from 'next/server';
import { AREAS_OF_EVALUATION } from '@/lib/interviewQuestionBank';
import { DEFAULT_AOE_PREFERENCES, activeAoeAreas, type AoePreferences } from '@/lib/aoePreferences';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

function canonicalArea(value: string) {
  return AREAS_OF_EVALUATION.includes(value as (typeof AREAS_OF_EVALUATION)[number]);
}

function cleanUnique(values: unknown[], maxLength = 80) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!value || value.length > maxLength) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

async function resolveOrganization() {
  const { data, error } = await supabaseAdmin.from('organizations').select('id').limit(2);
  if (error) throw error;
  if (!data || data.length !== 1) return null;
  return data[0];
}

async function loadPreferences(orgId: string): Promise<AoePreferences> {
  const { data, error } = await supabaseAdmin
    .from('phase1_aoe_preferences')
    .select('hidden_standard_areas,custom_areas')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? {
    hiddenStandardAreas: Array.isArray(data.hidden_standard_areas) ? data.hidden_standard_areas as string[] : [],
    customAreas: Array.isArray(data.custom_areas) ? data.custom_areas as string[] : []
  } : DEFAULT_AOE_PREFERENCES;
}

export async function GET() {
  try {
    const organization = await resolveOrganization();
    if (!organization) return NextResponse.json({ ...DEFAULT_AOE_PREFERENCES, activeAreas: [...AREAS_OF_EVALUATION] });
    const preferences = await loadPreferences(organization.id);
    return NextResponse.json({ ...preferences, activeAreas: activeAoeAreas(preferences) });
  } catch (error) {
    console.error('AOE preferences load failed', error);
    return NextResponse.json({ error: 'Unable to load AOE preferences.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const organization = await resolveOrganization();
    if (!organization) return NextResponse.json({ error: 'Workspace settings are not configured.' }, { status: 409 });

    const body = await request.json();
    const hiddenStandardAreas = cleanUnique(Array.isArray(body.hiddenStandardAreas) ? body.hiddenStandardAreas : [])
      .filter(canonicalArea);
    const customAreas = cleanUnique(Array.isArray(body.customAreas) ? body.customAreas : [])
      .filter((area) => !canonicalArea(area));

    if (customAreas.length > 50) return NextResponse.json({ error: 'No more than 50 custom Areas of Evaluation may be active.' }, { status: 400 });

    const preferences: AoePreferences = { hiddenStandardAreas, customAreas };
    if (activeAoeAreas(preferences).length === 0) {
      return NextResponse.json({ error: 'At least one Area of Evaluation must remain available.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('phase1_aoe_preferences').upsert({
      org_id: organization.id,
      hidden_standard_areas: hiddenStandardAreas,
      custom_areas: customAreas,
      updated_at: new Date().toISOString()
    }, { onConflict: 'org_id' });
    if (error) throw error;

    return NextResponse.json({ ...preferences, activeAreas: activeAoeAreas(preferences) });
  } catch (error) {
    console.error('AOE preferences update failed', error);
    return NextResponse.json({ error: 'Unable to save AOE preferences.' }, { status: 500 });
  }
}
