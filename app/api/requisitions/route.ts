import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { anthropic, EVALUATION_MODEL } from '@/lib/anthropic';
import { extractTextFromFile } from '@/lib/extractText';

const JD_PARSE_PROMPT = `
Parse the following job description into its natural evaluation
dimensions for a candidate comparison matrix (e.g. "Call Center
Experience", "CRM / Systems", "Complaint Resolution" — dimensions
should reflect this specific role, not a generic template).

Respond with ONLY a JSON array of short column-header strings, no prose,
no markdown fences. 4-7 dimensions.
`.trim();

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id');
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('requisitions')
    .select('*, candidates(count)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requisitions: data });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const org_id = formData.get('org_id') as string | null;
    const title = formData.get('title') as string | null;
    const created_by = formData.get('created_by') as string | null;
    const pastedText = formData.get('job_description') as string | null;
    const file = formData.get('file') as File | null;

    if (!org_id || !title || (!pastedText?.trim() && !file)) {
      return NextResponse.json(
        { error: 'org_id, title, and a job description (pasted text or a file) are required' },
        { status: 400 }
      );
    }

    const job_description = file ? await extractTextFromFile(file) : (pastedText as string);

    if (!job_description.trim()) {
      return NextResponse.json({ error: 'Job description is empty after extraction' }, { status: 400 });
    }

    const parseResponse = await anthropic.messages.create({
      model: EVALUATION_MODEL,
      max_tokens: 512,
      system: JD_PARSE_PROMPT,
      messages: [{ role: 'user', content: job_description }]
    });

    const textBlock = parseResponse.content.find((b) => b.type === 'text');
    const pillars = textBlock && textBlock.type === 'text' ? JSON.parse(textBlock.text) : [];

    const { data, error } = await supabaseAdmin
      .from('requisitions')
      .insert({
        org_id,
        title,
        job_description,
        evaluation_pillars: pillars,
        created_by
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ requisition: data });
  } catch (err: any) {
    console.error('Create requisition failed:', err);
    return NextResponse.json({ error: err.message ?? 'Failed to create requisition' }, { status: 500 });
  }
}
