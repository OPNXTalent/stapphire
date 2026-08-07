import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { anthropic, EVALUATION_MODEL } from '@/lib/anthropic';
import { EVALUATION_SYSTEM_PROMPT, EVALUATION_TOOL, buildEvaluationUserMessage } from '@/lib/systemPrompt';
import { extractTextFromBuffer } from '@/lib/extractText';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Re-runs the AI evaluation for a candidate already in the system,
// against the requisition's CURRENT job description and priorities —
// useful once a hiring manager's thinking has shifted since the first
// pass. This is a genuinely new AI call, so it costs a credit like any
// other evaluation; it never overwrites the original evaluation row,
// it adds a new one, preserving history the same way every other
// evaluation in this app is preserved.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { data: candidate, error: candError } = await supabaseAdmin
      .from('candidates')
      .select('id, full_name, source_filename, original_file_url, requisition_id')
      .eq('id', params.id)
      .single();

    if (candError || !candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
    }

    if (!candidate.original_file_url) {
      return NextResponse.json(
        { error: 'The original resume file is not available for this candidate, so it cannot be re-evaluated.' },
        { status: 400 }
      );
    }

    const { data: requisition, error: reqError } = await supabaseAdmin
      .from('requisitions')
      .select('*, organizations(*)')
      .eq('id', candidate.requisition_id)
      .single();

    if (reqError || !requisition) {
      return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
    }

    const org = requisition.organizations as { id: string; credits_remaining: number; credits_total: number };

    let usingFreeTrial = false;
    if (org.credits_remaining <= 0) {
      if (org.credits_total > 0) {
        return NextResponse.json({ error: 'No evaluation credits remaining' }, { status: 402 });
      }
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from('free_trial_usage')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', org.id)
        .gte('used_at', dayAgo);

      if ((count ?? 0) >= 5) {
        return NextResponse.json(
          { error: 'Free trial limit reached — 5 evaluations per 24 hours. Upgrade for more.' },
          { status: 402 }
        );
      }
      usingFreeTrial = true;
    }

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('resumes')
      .download(candidate.original_file_url);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: 'Could not retrieve the original resume file' }, { status: 500 });
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const resumeText = await extractTextFromBuffer(buffer, candidate.source_filename ?? 'resume', undefined);

    const userMessage = buildEvaluationUserMessage({
      jobDescription: requisition.job_description,
      evaluationPillars: requisition.evaluation_pillars,
      employerWatchlist: requisition.employer_watchlist ?? [],
      evaluationPriorities: requisition.evaluation_priorities,
      resumeText
    });

    const response = await anthropic.messages.create({
      model: EVALUATION_MODEL,
      max_tokens: 4096,
      system: EVALUATION_SYSTEM_PROMPT,
      tools: [EVALUATION_TOOL],
      tool_choice: { type: 'tool', name: 'submit_evaluation' },
      messages: [{ role: 'user', content: userMessage }]
    });

    const toolUseBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      return NextResponse.json({ error: 'Model did not return a structured evaluation' }, { status: 500 });
    }

    const evaluation = toolUseBlock.input as any;

    const { data: evalRow, error: evalError } = await supabaseAdmin
      .from('evaluations')
      .insert({
        candidate_id: candidate.id,
        requisition_id: requisition.id,
        overall_match: evaluation.overall_match,
        status: evaluation.status,
        scores: evaluation.scores,
        signals: evaluation.signals,
        strengths: evaluation.strengths,
        gaps: evaluation.gaps,
        ats_compatibility: evaluation.ats_compatibility,
        employment_history: evaluation.employment_history,
        risk_flags: evaluation.risk_flags,
        interview_recommendations: evaluation.interview_recommendations,
        matrix_dimensions: evaluation.matrix_dimensions,
        raw_model_response: evaluation
      })
      .select()
      .single();

    if (evalError) throw evalError;

    if (usingFreeTrial) {
      await supabaseAdmin.from('free_trial_usage').insert({ org_id: org.id });
    } else {
      await supabaseAdmin.rpc('decrement_credit_and_log', {
        p_org_id: org.id,
        p_candidate_id: candidate.id
      });
    }

    return NextResponse.json({ evaluation: evalRow });
  } catch (err: any) {
    console.error('Re-evaluation failed:', err);
    return NextResponse.json({ error: err.message ?? 'Re-evaluation failed' }, { status: 500 });
  }
}
