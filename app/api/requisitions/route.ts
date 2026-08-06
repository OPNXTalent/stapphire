import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { anthropic, EVALUATION_MODEL } from '@/lib/anthropic';
import { extractTextFromBuffer } from '@/lib/extractText';

export const maxDuration = 60;

const JD_PARSE_PROMPT = `
Parse the job description into its natural evaluation dimensions for a
candidate comparison matrix (e.g. "Call Center Experience", "CRM /
Systems", "Complaint Resolution" — dimensions should reflect this
specific role, not a generic template). Produce 4-7 dimensions, then
call the submit_pillars tool with them.
`.trim();

const JD_PARSE_TOOL = {
  name: 'submit_pillars',
  description: 'Submit the parsed evaluation dimensions for this job description.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pillars: {
        type: 'array',
        items: { type: 'string' },
        description: '4-7 short column-header strings for the comparison matrix'
      }
    },
    required: ['pillars']
  }
};

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id');
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('requisitions')
    .select('*, candidates(count)')
    .eq('org_id', orgId)
    .is('archived_at', null)
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

    const job_description = file
      ? await extractTextFromBuffer(Buffer.from(await file.arrayBuffer()), file.name, file.type)
      : (pastedText as string);

    if (!job_description.trim()) {
      return NextResponse.json({ error: 'Job description is empty after extraction' }, { status: 400 });
    }

    const parseResponse = await anthropic.messages.create({
      model: EVALUATION_MODEL,
      max_tokens: 512,
      system: JD_PARSE_PROMPT,
      tools: [JD_PARSE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_pillars' },
      messages: [{ role: 'user', content: job_description }]
    });

    const toolUseBlock = parseResponse.content.find((b) => b.type === 'tool_use');
    const pillars =
      toolUseBlock && toolUseBlock.type === 'tool_use' ? (toolUseBlock.input as any).pillars : [];

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
