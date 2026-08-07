import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { anthropic, EVALUATION_MODEL } from '@/lib/anthropic';
import { normalizePillars } from '@/lib/pillars';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const REFINE_TOOL = {
  name: 'submit_refined_pillars',
  description: 'Submit the updated, weighted evaluation dimensions for this job description.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pillars: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string', description: 'Short label for this evaluation dimension' },
            weight: { type: 'number', description: 'Relative importance as a whole-number percentage' }
          },
          required: ['requirement', 'weight']
        },
        description: 'The complete updated list of dimensions, weights summing to exactly 100'
      }
    },
    required: ['pillars']
  }
};

// Turns a recruiter's plain-language direction into a real, structural
// change to the evaluation rubric — not just an invisible influence on
// scoring tone. This never touches already-evaluated candidates; it
// only changes the standard that new or explicitly re-run evaluations
// are measured against.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { prompt } = await req.json();
    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'A direction is required' }, { status: 400 });
    }

    const { data: requisition, error: reqError } = await supabaseAdmin
      .from('requisitions')
      .select('job_description, evaluation_pillars')
      .eq('id', params.id)
      .single();

    if (reqError || !requisition) {
      return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
    }

    const currentPillars = normalizePillars(requisition.evaluation_pillars);

    const systemPrompt = `
You maintain the weighted evaluation rubric for a specific job
requisition. You'll be given the job description, the current set of
evaluation dimensions with their weights, and a recruiter's
plain-language direction for how to change it (e.g. "drop the
bilingual requirement, it's not essential" or "weight call center
experience higher than technical skills").

Apply the direction to produce an updated, complete list of dimensions
— add, remove, rename, or reweight as the direction calls for. Keep
whatever the direction doesn't address unchanged. Weights must be
whole numbers summing to exactly 100. Call submit_refined_pillars with
the complete resulting list (not just the changed items).
`.trim();

    const userMessage = JSON.stringify({
      job_description: requisition.job_description,
      current_pillars: currentPillars,
      direction: prompt.trim()
    });

    const response = await anthropic.messages.create({
      model: EVALUATION_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: [REFINE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_refined_pillars' },
      messages: [{ role: 'user', content: userMessage }]
    });

    const toolUseBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      return NextResponse.json({ error: 'Model did not return updated criteria' }, { status: 500 });
    }

    const newPillars = (toolUseBlock.input as any).pillars;

    const { error: updateError } = await supabaseAdmin
      .from('requisitions')
      .update({ evaluation_pillars: newPillars })
      .eq('id', params.id);

    if (updateError) throw updateError;

    return NextResponse.json({ pillars: newPillars });
  } catch (err: any) {
    console.error('Refine pillars failed:', err);
    return NextResponse.json({ error: err.message ?? 'Failed to update criteria' }, { status: 500 });
  }
}
