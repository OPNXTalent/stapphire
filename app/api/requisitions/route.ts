import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { anthropic, EVALUATION_MODEL } from '@/lib/anthropic';
import { extractTextFromBuffer } from '@/lib/extractText';
import { HIRING_CATEGORIES, normalizeProfileWeights, type HiringProfile } from '@/lib/hiringProfile';

export const maxDuration = 60;

// Builds Hiring Profile Revision 1 from the raw Job Description. This
// is a starting point, not a final answer — discovery (the
// /discovery endpoint) is what lets it actually evolve.
const JD_PARSE_PROMPT = `
You are building the initial Hiring Decision Model from a Job
Description. This model is organized under exactly five permanent
categories — never add, remove, or rename them:

1. Core Responsibilities
2. Minimum & Preferred Qualifications
3. Hard Skills
4. Soft Skills
5. Keyword & Terminology Relevance

For each category, extract specific, measurable subcriteria from the
Job Description — not a summary, actual distinct requirements (e.g.
under Hard Skills: "Oracle Fusion", "SQL", not just "technical
skills"). A category may have zero subcriteria if the JD gives it
nothing, but do not force subcriteria into a category that doesn't fit.

Weight every subcriterion using contextual judgment — frequency of
mention, emphasis, placement, required-vs-preferred language, scope of
responsibility, apparent business impact, technical specificity,
seniority signals, and repeated themes. Do not default to equal
weights, and do not inflate formal requirements (like a degree) simply
because they're easy to identify — a degree should not automatically
outweigh the actual work performed unless the JD clearly establishes
that importance.

All subcriteria weights across all five categories must be whole
numbers summing to exactly 100.

Call submit_hiring_profile with the result.
`.trim();

const HIRING_PROFILE_TOOL = {
  name: 'submit_hiring_profile',
  description: 'Submit the initial weighted Hiring Decision Model parsed from the job description.',
  input_schema: {
    type: 'object' as const,
    properties: {
      categories: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', enum: [...HIRING_CATEGORIES] },
            subcriteria: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  weight: { type: 'number', description: 'Whole-number percentage' }
                },
                required: ['name', 'weight']
              }
            }
          },
          required: ['name', 'subcriteria']
        },
        description: 'Exactly the five fixed categories, in order, each with its extracted subcriteria'
      }
    },
    required: ['categories']
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
      max_tokens: 1536,
      system: JD_PARSE_PROMPT,
      tools: [HIRING_PROFILE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_hiring_profile' },
      messages: [{ role: 'user', content: job_description }]
    });

    const toolUseBlock = parseResponse.content.find((b) => b.type === 'tool_use');
    const rawCategories =
      toolUseBlock && toolUseBlock.type === 'tool_use' ? (toolUseBlock.input as any).categories : [];

    const profile: HiringProfile = normalizeProfileWeights({
      categories: Array.isArray(rawCategories)
        ? rawCategories.map((c: any) => ({
            name: c.name,
            weight: 0,
            subcriteria: Array.isArray(c.subcriteria)
              ? c.subcriteria.map((s: any) => ({ name: s.name, weight: Number(s.weight) || 0, source: ['Job Description'] }))
              : []
          }))
        : []
    });

    const { data: requisition, error } = await supabaseAdmin
      .from('requisitions')
      .insert({
        org_id,
        title,
        job_description,
        evaluation_pillars: profile,
        profile_revision: 1,
        created_by
      })
      .select()
      .single();

    if (error) throw error;

    await supabaseAdmin.from('hiring_profile_revisions').insert({
      requisition_id: requisition.id,
      revision: 1,
      source: 'job_description',
      change_summary: 'Initial Hiring Profile parsed from the job description.',
      profile_snapshot: profile,
      changes: null
    });

    return NextResponse.json({ requisition });
  } catch (err: any) {
    console.error('Create requisition failed:', err);
    return NextResponse.json({ error: err.message ?? 'Failed to create requisition' }, { status: 500 });
  }
}
