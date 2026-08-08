import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { anthropic, EVALUATION_MODEL } from '@/lib/anthropic';
import { HIRING_CATEGORIES, normalizeHiringProfile, normalizeProfileWeights } from '@/lib/hiringProfile';
import { extractTextFromBuffer } from '@/lib/extractText';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DISCOVERY_SYSTEM_PROMPT = `
You are conducting hiring discovery with a recruiter or hiring leader —
the way an experienced Talent Acquisition consultant runs an intake
conversation, not a form-filling exercise. The Job Description is a
starting point, not the final truth about what this role needs.

You maintain a Hiring Decision Model organized under exactly five
permanent categories, which never change:
1. Core Responsibilities
2. Minimum & Preferred Qualifications
3. Hard Skills
4. Soft Skills
5. Keyword & Terminology Relevance

You'll be given the job description, the current model (categories with
weighted subcriteria), recent conversation history, and a new message.

Decide whether this message materially changes understanding of the
role. Casual chat, questions back to the user, or comments that don't
imply a real priority shift do NOT change the model — just reply
naturally. When it does carry real signal, translate it directly:

- "Communication matters more than SQL" -> reweight, don't ask for
  percentages.
- "Oracle can be trained" -> reduce its weight, possibly move it from
  Minimum to Preferred Qualifications.
- "I don't care about the degree" -> reduce or remove that subcriterion,
  redistribute its weight to what actually matters.
- A new priority mentioned that isn't in the model yet -> add it under
  the right category with a sensible weight, and note its source.

When you change the model: add, remove, reweight, or reclassify
subcriteria as needed, then return the COMPLETE updated category list
(not just the changed items) — every category and every subcriterion
that should exist after this change, including the ones you didn't
touch. Weights must be whole numbers summing to exactly 100 across all
categories combined.

While you're at it, correct any existing subcriterion whose weight
looks inflated purely because it's mentioned often in the JD rather
than because an external candidate should reasonably already have it —
employer-specific systems, proprietary tools, and things the JD
describes the organization training on after hire should carry
meaningfully lower weight than portable, general capabilities. You
don't need to ask permission for this kind of correction if it's
clearly warranted by what's already in the JD and model.

Also decide whether a natural discovery question would help — ask at
most one, and only if it would materially change sourcing or
evaluation (e.g. "What will this person need to accomplish in the
first six months?", "Which of these would you compromise on for the
right candidate?"). Don't interrogate. Most turns don't need a
question at all.

Never tell the user the Job Description is wrong or that they're
inconsistent. If the model has drifted meaningfully from the JD, that's
a normal, expected outcome of discovery, not a problem to flag as an
error.

Communicate like an experienced TA partner: concise, confident, neutral,
practical. No HR-policy tone, no AI-assistant filler, no lecturing.

Call submit_discovery_response with your result.
`.trim();

const DISCOVERY_TOOL = {
  name: 'submit_discovery_response',
  description: 'Submit the conversational reply and any resulting change to the Hiring Decision Model.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reply: { type: 'string', description: 'Natural conversational reply shown in the discovery chat thread' },
      profile_changed: { type: 'boolean' },
      change_summary: {
        type: 'string',
        description: 'One or two sentences describing what changed and why, if profile_changed is true'
      },
      categories: {
        type: 'array',
        description: 'The COMPLETE updated category list if profile_changed is true — omit otherwise',
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
                  weight: { type: 'number' },
                  source: { type: 'array', items: { type: 'string' } }
                },
                required: ['name', 'weight']
              }
            }
          },
          required: ['name', 'subcriteria']
        }
      },
      changes: {
        type: 'array',
        description: 'What specifically changed, if profile_changed is true',
        items: {
          type: 'object',
          properties: {
            criterion: { type: 'string' },
            action: { type: 'string', enum: ['added', 'removed', 'increased', 'decreased', 'reclassified'] },
            old_weight: { type: 'number' },
            new_weight: { type: 'number' },
            reason: { type: 'string' }
          },
          required: ['criterion', 'action', 'old_weight', 'new_weight', 'reason']
        }
      }
    },
    required: ['reply', 'profile_changed']
  }
};

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabaseAdmin
    .from('discovery_messages')
    .select('*')
    .eq('requisition_id', params.id)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const formData = await req.formData();
    const message = (formData.get('message') as string | null) ?? '';
    const source = formData.get('source') as string | null;
    const file = formData.get('file') as File | null;

    if (!message.trim() && !file) {
      return NextResponse.json({ error: 'A message or attachment is required' }, { status: 400 });
    }

    let effectiveMessage = message.trim();
    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileText = await extractTextFromBuffer(buffer, file.name, file.type);
      effectiveMessage = effectiveMessage
        ? `${effectiveMessage}\n\n[Attached document: ${file.name}]\n${fileText}`
        : `[Attached document: ${file.name}]\n${fileText}`;
    }

    const { data: requisition, error: reqError } = await supabaseAdmin
      .from('requisitions')
      .select('job_description, evaluation_pillars, profile_revision')
      .eq('id', params.id)
      .single();

    if (reqError || !requisition) {
      return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
    }

    const currentProfile = normalizeHiringProfile(requisition.evaluation_pillars);

    const { data: history } = await supabaseAdmin
      .from('discovery_messages')
      .select('role, content')
      .eq('requisition_id', params.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const recentHistory = (history ?? []).reverse();

    await supabaseAdmin
      .from('discovery_messages')
      .insert({ requisition_id: params.id, role: 'user', content: message.trim() || `Attached: ${file?.name}` });

    const userMessage = JSON.stringify({
      job_description: requisition.job_description,
      current_profile: currentProfile,
      recent_conversation: recentHistory,
      new_message: effectiveMessage
    });

    const response = await anthropic.messages.create({
      model: EVALUATION_MODEL,
      max_tokens: 2048,
      system: DISCOVERY_SYSTEM_PROMPT,
      tools: [DISCOVERY_TOOL],
      tool_choice: { type: 'tool', name: 'submit_discovery_response' },
      messages: [{ role: 'user', content: userMessage }]
    });

    const toolUseBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      return NextResponse.json({ error: 'Model did not return a discovery response' }, { status: 500 });
    }

    const result = toolUseBlock.input as any;
    const reply: string = result.reply ?? '';
    const profileChanged = !!result.profile_changed && Array.isArray(result.categories) && result.categories.length > 0;

    await supabaseAdmin.from('discovery_messages').insert({ requisition_id: params.id, role: 'assistant', content: reply });

    if (!profileChanged) {
      return NextResponse.json({
        reply,
        profile_changed: false,
        profile: currentProfile,
        revision: requisition.profile_revision
      });
    }

    const updatedProfile = normalizeProfileWeights({
      categories: result.categories.map((c: any) => ({
        name: c.name,
        weight: 0,
        subcriteria: Array.isArray(c.subcriteria)
          ? c.subcriteria.map((s: any) => ({ name: s.name, weight: Number(s.weight) || 0, source: s.source }))
          : []
      }))
    });

    const newRevision = (requisition.profile_revision ?? 1) + 1;
    const changeSource = source === 'hiring_leader_discovery' ? 'hiring_leader_discovery' : 'recruiter_discovery';

    const { error: updateError } = await supabaseAdmin
      .from('requisitions')
      .update({ evaluation_pillars: updatedProfile, profile_revision: newRevision })
      .eq('id', params.id);

    if (updateError) throw updateError;

    await supabaseAdmin.from('hiring_profile_revisions').insert({
      requisition_id: params.id,
      revision: newRevision,
      source: changeSource,
      change_summary: result.change_summary ?? null,
      profile_snapshot: updatedProfile,
      changes: result.changes ?? null
    });

    return NextResponse.json({
      reply,
      profile_changed: true,
      change_summary: result.change_summary,
      profile: updatedProfile,
      revision: newRevision,
      changes: result.changes ?? []
    });
  } catch (err: any) {
    console.error('Discovery failed:', err);
    return NextResponse.json({ error: err.message ?? 'Discovery failed' }, { status: 500 });
  }
}
