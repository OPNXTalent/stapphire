import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { anthropic, EVALUATION_MODEL } from '@/lib/anthropic';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CANDIDATE_DISCOVERY_PROMPT = `
You are having a discovery conversation with a recruiter or hiring
manager about ONE SPECIFIC CANDIDATE — gathering knowledge they have
that isn't reflected in the candidate's résumé (current employment,
internal performance feedback, demonstrated skills, certifications,
things confirmed directly with the candidate, etc.).

You are NOT scoring the candidate in this conversation — that only
happens when they explicitly click Re-evaluate afterward. Your job here
is just to have a real conversation: acknowledge what they told you,
briefly explain what it likely means for the candidate's fit, and ask
at most one useful clarifying question if it would genuinely help
sharpen the picture — most turns don't need a question at all. Don't
interrogate.

Apply the same evidence discipline you'd use when actually scoring:
- Credit only what's actually established. "Currently works at X"
  establishes current employment and organizational familiarity — it
  does NOT establish specific duties or tools there unless separately
  stated.
- Don't assume what's shared is positive — it can raise, lower,
  confirm, or introduce a new concern. Judge by job relevance, not
  sentiment.
- Where something is suggested but not established, say so plainly
  rather than treating it as settled.

You'll be given the job description, the candidate's résumé text, any
previously established context, recent conversation history, and a new
message. Maintain a clean, consolidated summary of everything
established about this candidate through this conversation so far —
written as clear prose ready to inform an actual evaluation, not a raw
transcript. Merge the new message into that summary; don't just append.

Call submit_candidate_discovery with your reply and the updated summary.
`.trim();

const CANDIDATE_DISCOVERY_TOOL = {
  name: 'submit_candidate_discovery',
  description: 'Submit the conversational reply and the updated consolidated candidate context.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reply: { type: 'string', description: 'Natural conversational reply shown in the chat thread' },
      updated_context: {
        type: 'string',
        description: 'Clean, consolidated prose summarizing everything established about this candidate beyond the résumé so far'
      }
    },
    required: ['reply', 'updated_context']
  }
};

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabaseAdmin
    .from('candidate_discovery_messages')
    .select('*')
    .eq('candidate_id', params.id)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { message } = await req.json();
    if (!message?.trim()) return NextResponse.json({ error: 'A message is required' }, { status: 400 });

    const { data: candidate, error: candError } = await supabaseAdmin
      .from('candidates')
      .select('id, full_name, additional_context, requisition_id, original_file_url, source_filename')
      .eq('id', params.id)
      .single();

    if (candError || !candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
    }

    const { data: requisition } = await supabaseAdmin
      .from('requisitions')
      .select('job_description')
      .eq('id', candidate.requisition_id)
      .single();

    const { data: history } = await supabaseAdmin
      .from('candidate_discovery_messages')
      .select('role, content')
      .eq('candidate_id', params.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const recentHistory = (history ?? []).reverse();

    await supabaseAdmin
      .from('candidate_discovery_messages')
      .insert({ candidate_id: params.id, role: 'user', content: message.trim() });

    const userMessage = JSON.stringify({
      job_description: requisition?.job_description ?? '',
      candidate_name: candidate.full_name,
      previously_established_context: candidate.additional_context ?? null,
      recent_conversation: recentHistory,
      new_message: message.trim()
    });

    const response = await anthropic.messages.create({
      model: EVALUATION_MODEL,
      max_tokens: 1024,
      system: CANDIDATE_DISCOVERY_PROMPT,
      tools: [CANDIDATE_DISCOVERY_TOOL],
      tool_choice: { type: 'tool', name: 'submit_candidate_discovery' },
      messages: [{ role: 'user', content: userMessage }]
    });

    const toolUseBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      return NextResponse.json({ error: 'Model did not return a discovery response' }, { status: 500 });
    }

    const result = toolUseBlock.input as any;
    const reply: string = result.reply ?? '';
    const updatedContext: string = result.updated_context ?? candidate.additional_context ?? '';

    await supabaseAdmin
      .from('candidate_discovery_messages')
      .insert({ candidate_id: params.id, role: 'assistant', content: reply });

    await supabaseAdmin.from('candidates').update({ additional_context: updatedContext }).eq('id', params.id);

    return NextResponse.json({ reply, updated_context: updatedContext });
  } catch (err: any) {
    console.error('Candidate discovery failed:', err);
    return NextResponse.json({ error: err.message ?? 'Discovery failed' }, { status: 500 });
  }
}
