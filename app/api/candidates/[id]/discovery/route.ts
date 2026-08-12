import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { anthropic, EVALUATION_MODEL } from '@/lib/anthropic';
import { extractTextFromBuffer } from '@/lib/extractText';
import { reevaluateCandidate } from '@/lib/reevaluateCandidate';
import { HIRING_CATEGORIES, normalizeHiringProfile, normalizeProfileWeights } from '@/lib/hiringProfile';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CANDIDATE_DISCOVERY_PROMPT = `
You are having a discovery conversation with a recruiter or hiring
manager about ONE SPECIFIC CANDIDATE — gathering knowledge they have
that isn't reflected in the candidate's résumé (current employment,
internal performance feedback, demonstrated skills, certifications,
things confirmed directly with the candidate, etc.), and hearing their
reactions to the candidate's current evaluation.

You are NOT scoring the candidate in this conversation — that only
happens when they explicitly click Re-evaluate afterward. Your job here
is just to have a real conversation: acknowledge what they told you,
briefly explain what it likely means for the candidate's fit, and ask
at most one useful clarifying question if it would genuinely help
sharpen the picture — most turns don't need a question at all. Don't
interrogate.

You'll be given the job description, the CURRENT Hiring Decision Model
(the weighted subcriteria every candidate in this requisition is scored
against), the candidate's résumé text, any previously established
context, the candidate's CURRENT EVALUATION (scores, strengths,
categorized gaps, risk flags — the actual specific items currently
displayed to the recruiter on screen), recent conversation history, and
a new message.

CRITICAL DISTINCTION — most feedback is about the CANDIDATE, some is
actually about the ROLE:
- Candidate-specific facts ("she currently works at GRTC", "he
  mentioned he's not interested in relocating") only ever apply to this
  one person — capture these in the candidate summary only.
- Role-level calibration is feedback about what the job actually
  requires, disguised as a comment about this candidate — e.g. "GRTC
  transit knowledge doesn't matter, we train that," "the gaps you
  flagged for her aren't real concerns," or "stop counting X as a gap" /
  "don't hold X against candidates" — any instruction phrased as a
  blanket policy rather than a fact about this one person is role-level,
  even if it was said while discussing a specific candidate. This is
  really telling you the REQUIREMENT itself is weighted or classified
  wrong, and it should apply to EVERY candidate being scored against
  this Hiring Decision Model, not just the one you're discussing right
  now. When genuinely unsure, lean toward treating decisive language
  ("stop," "don't," "never," "not a factor") as role-level rather than
  letting it silently apply to only the current candidate.
When you judge feedback to be role-level, set role_level_change to true
and return the COMPLETE updated Hiring Decision Model (every category
and subcriterion, weights summing to exactly 100) with the correction
applied. If the recruiter said to stop counting something as a gap or
that it's not a factor at all, REMOVE that subcriterion from the model
entirely — a lower weight is not enough, since anything still present
in the model gets evaluated on every future run and can still surface
as some category of gap, which is exactly what they asked you to stop.
Redistribute its weight proportionally across what remains in its
category. Say so plainly in your reply — recruiters should know when
something they said just changed the standard for everyone, not just
this candidate.

If the recruiter reacts to specific items from the current evaluation
— disputing a gap, confirming a strength, saying something doesn't
matter to the hiring manager, correcting something — engage with those
SPECIFIC items directly by name, don't respond generically. If they say
something broad like "the gaps don't matter" or "none of these are
concerns," name which specific gaps you're now treating as non-factors
rather than giving a vague acknowledgment — you have the actual list,
use it. Never claim you don't have specifics available when
current_evaluation is present in what you were given.

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

Maintain a clean, consolidated summary of everything established about
this candidate through this conversation so far — written as clear
prose ready to inform an actual evaluation, not a raw transcript. Merge
the new message into that summary; don't just append. When the
recruiter dismisses specific gaps or gap categories as non-factors,
state that plainly and specifically in the summary (e.g. "Recruiter has
confirmed the GRTC-specific transit knowledge and dispatch-specific
experience gaps flagged previously are not concerns for this hiring
manager — treat as non-factors, not gaps, in future evaluations") so
that instruction actually carries into the next evaluation rather than
getting lost.

Call submit_candidate_discovery with your reply and the updated summary.
`.trim();

const CANDIDATE_DISCOVERY_TOOL = {
  name: 'submit_candidate_discovery',
  description: 'Submit the conversational reply, the updated consolidated candidate context, and any role-level Hiring Decision Model correction.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reply: { type: 'string', description: 'Natural conversational reply shown in the chat thread' },
      updated_context: {
        type: 'string',
        description: 'Clean, consolidated prose summarizing everything established about this candidate beyond the résumé so far'
      },
      role_level_change: {
        type: 'boolean',
        description: 'True if this feedback is really about the role/requirement, not just this candidate, and should apply to everyone'
      },
      hiring_profile_categories: {
        type: 'array',
        description: 'The COMPLETE updated Hiring Decision Model if role_level_change is true — omit otherwise',
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
      hiring_profile_change_summary: {
        type: 'string',
        description: 'One or two sentences describing the role-level correction, if role_level_change is true'
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
    const formData = await req.formData();
    const message = (formData.get('message') as string | null) ?? '';
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
      .select('job_description, evaluation_pillars, profile_revision')
      .eq('id', candidate.requisition_id)
      .single();

    const currentProfile = normalizeHiringProfile(requisition?.evaluation_pillars);

    const { data: latestEvaluation } = await supabaseAdmin
      .from('evaluations')
      .select('overall_match, status, strengths, gaps_structured, matrix_dimensions, risk_flags')
      .eq('candidate_id', params.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: history } = await supabaseAdmin
      .from('candidate_discovery_messages')
      .select('role, content')
      .eq('candidate_id', params.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const recentHistory = (history ?? []).reverse();

    await supabaseAdmin
      .from('candidate_discovery_messages')
      .insert({ candidate_id: params.id, role: 'user', content: message.trim() || `Attached: ${file?.name}` });

    const userMessage = JSON.stringify({
      job_description: requisition?.job_description ?? '',
      current_hiring_decision_model: currentProfile,
      candidate_name: candidate.full_name,
      previously_established_context: candidate.additional_context ?? null,
      current_evaluation: latestEvaluation ?? null,
      recent_conversation: recentHistory,
      new_message: effectiveMessage
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
    const roleLevelChange = !!result.role_level_change && Array.isArray(result.hiring_profile_categories) && result.hiring_profile_categories.length > 0;

    await supabaseAdmin
      .from('candidate_discovery_messages')
      .insert({ candidate_id: params.id, role: 'assistant', content: reply });

    const contextChanged = updatedContext.trim() !== (candidate.additional_context ?? '').trim();
    await supabaseAdmin.from('candidates').update({ additional_context: updatedContext }).eq('id', params.id);

    // Role-level correction — this applies to the whole requisition,
    // not just the candidate being discussed. Same propagation as the
    // requisition-level Hiring Discovery: update the model, log a
    // revision, so every future evaluation (and every OTHER candidate
    // re-evaluated from here) reflects the correction, not just this one.
    let updatedProfile = null;
    let newRevision = null;
    if (roleLevelChange) {
      updatedProfile = normalizeProfileWeights({
        categories: result.hiring_profile_categories.map((c: any) => ({
          name: c.name,
          weight: 0,
          subcriteria: Array.isArray(c.subcriteria)
            ? c.subcriteria.map((s: any) => ({ name: s.name, weight: Number(s.weight) || 0, source: s.source }))
            : []
        }))
      });
      newRevision = (requisition?.profile_revision ?? 1) + 1;

      await supabaseAdmin
        .from('requisitions')
        .update({ evaluation_pillars: updatedProfile, profile_revision: newRevision })
        .eq('id', candidate.requisition_id);

      await supabaseAdmin.from('hiring_profile_revisions').insert({
        requisition_id: candidate.requisition_id,
        revision: newRevision,
        source: 'recruiter_discovery',
        change_summary: result.hiring_profile_change_summary
          ? `${result.hiring_profile_change_summary} (via ${candidate.full_name}'s discovery chat)`
          : `Role-level correction surfaced via ${candidate.full_name}'s discovery chat.`,
        profile_snapshot: updatedProfile,
        changes: null
      });
    }

    // Course-correction, not a separate paid action — if this exchange
    // actually changed what's known about the candidate (or the model
    // itself changed), keep the evaluation current automatically rather
    // than waiting for a deliberate Re-evaluate click.
    let freshEvaluation = null;
    if (contextChanged || roleLevelChange) {
      const reevalResult = await reevaluateCandidate(params.id);
      if (reevalResult.success) freshEvaluation = reevalResult.evaluation;
    }

    return NextResponse.json({
      reply,
      updated_context: updatedContext,
      reevaluated: !!freshEvaluation,
      evaluation: freshEvaluation,
      profile_changed: roleLevelChange,
      profile: updatedProfile,
      revision: newRevision
    });
  } catch (err: any) {
    console.error('Candidate discovery failed:', err);
    return NextResponse.json({ error: err.message ?? 'Discovery failed' }, { status: 500 });
  }
}
