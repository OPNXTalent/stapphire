import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const SYSTEM_SECTIONS = [
  { key: 'resume', name: 'Resume', system: true },
  { key: 'notes', name: 'Notes', system: true },
  { key: 'uploads', name: 'Uploads', system: true },
  { key: 'interviews', name: 'Interviews', system: true }
] as const;

const SYSTEM_NAMES = new Map(SYSTEM_SECTIONS.map((section) => [section.key, section.name]));

type FileSection = {
  key: string;
  name: string;
  system: boolean;
};

function defaultSections(): FileSection[] {
  return SYSTEM_SECTIONS.map((section) => ({ ...section }));
}

function validateSections(value: unknown): FileSection[] | null {
  if (!Array.isArray(value) || value.length < SYSTEM_SECTIONS.length || value.length > 30) return null;

  const sections: FileSection[] = [];
  const keys = new Set<string>();

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const section = raw as Record<string, unknown>;
    const key = String(section.key ?? '').trim();
    const name = String(section.name ?? '').trim();
    const system = section.system === true;

    if (!key || keys.has(key) || !name || name.length > 80) return null;
    keys.add(key);

    const systemName = SYSTEM_NAMES.get(key as (typeof SYSTEM_SECTIONS)[number]['key']);
    if (systemName) {
      if (!system || name !== systemName) return null;
    } else {
      if (system || !key.startsWith('custom-')) return null;
    }

    sections.push({ key, name, system });
  }

  if (SYSTEM_SECTIONS.some((section) => !keys.has(section.key))) return null;
  return sections;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { data, error } = await supabaseAdmin
      .from('phase1_candidate_file_layouts')
      .select('sections')
      .eq('candidate_id', params.id)
      .maybeSingle();

    if (error) throw error;
    const sections = validateSections(data?.sections) ?? defaultSections();
    return NextResponse.json({ sections });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to load Candidate Files layout.' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const sections = validateSections(body?.sections);
    if (!sections) {
      return NextResponse.json({ error: 'Candidate Files layout is invalid.' }, { status: 400 });
    }

    const { data: candidate, error: candidateError } = await supabaseAdmin
      .from('phase1_candidates')
      .select('id')
      .eq('id', params.id)
      .maybeSingle();

    if (candidateError) throw candidateError;
    if (!candidate) return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });

    const { error } = await supabaseAdmin
      .from('phase1_candidate_file_layouts')
      .upsert({
        candidate_id: params.id,
        sections,
        updated_at: new Date().toISOString()
      }, { onConflict: 'candidate_id' });

    if (error) throw error;
    return NextResponse.json({ sections });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to save Candidate Files layout.' }, { status: 500 });
  }
}
