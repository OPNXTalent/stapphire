import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { anthropic, EVALUATION_MODEL } from '@/lib/anthropic';
import { EVALUATION_SYSTEM_PROMPT, buildEvaluationUserMessage } from '@/lib/systemPrompt';
import { extractTextFromFile } from '@/lib/extractText';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const requisitionId = formData.get('requisition_id') as string | null;
    const file = formData.get('file') as File | null;

    if (!requisitionId || !file) {
      return NextResponse.json({ error: 'requisition_id and file are required' }, { status: 400 });
    }

    // ── Load requisition + org ──────────────────────────────────
    const { data: requisition, error: reqError } = await supabaseAdmin
      .from('requisitions')
      .select('*, organizations(*)')
      .eq('id', requisitionId)
      .single();

    if (reqError || !requisition) {
      return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
    }

    const org = requisition.organizations as { id: string; credits_remaining: number };

    // ── Extract text + fingerprint BEFORE spending a credit ────
    const resumeText = await extractTextFromFile(file);
    const contentHash = createHash('sha256').update(resumeText.trim().toLowerCase()).digest('hex');

    // ── Duplicate check — never re-evaluate, never charge twice,
    //    never mention it ─────────────────────────────────────
    const { data: existing } = await supabaseAdmin
      .from('candidates')
      .select('id, full_name, evaluations(*)')
      .eq('requisition_id', requisitionId)
      .eq('content_hash', contentHash)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ candidate: existing, deduped: true });
    }

    // ── Credit check ─────────────────────────────────────────
    if (org.credits_remaining <= 0) {
      return NextResponse.json({ error: 'No evaluation credits remaining' }, { status: 402 });
    }

    // ── Run the evaluation ───────────────────────────────────
    const userMessage = buildEvaluationUserMessage({
      jobDescription: requisition.job_description,
      evaluationPillars: requisition.evaluation_pillars,
      employerWatchlist: requisition.employer_watchlist ?? [],
      resumeText
    });

    const response = await anthropic.messages.create({
      model: EVALUATION_MODEL,
      max_tokens: 4096,
      system: EVALUATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from evaluation model');
    }

    const evaluation = JSON.parse(textBlock.text);

    // ── Persist: candidate profile + evaluation + credit ledger,
    //    as one logical unit ─────────────────────────────────
    const { data: candidate, error: candidateError } = await supabaseAdmin
      .from('candidates')
      .insert({
        requisition_id: requisitionId,
        full_name: evaluation.candidate_name,
        source_filename: file.name,
        content_hash: contentHash,
        document_type: evaluation.document_type
      })
      .select()
      .single();

    if (candidateError) throw candidateError;

    // Non-resume uploads are stored (so the file isn't silently lost)
    // but do not consume a credit and do not get scored — open decision
    // #1 from the spec, resolved here: invalid uploads are free.
    if (evaluation.document_type === 'non_resume') {
      return NextResponse.json({ candidate, evaluation: null, skipped: 'non_resume' });
    }

    const { data: evalRow, error: evalError } = await supabaseAdmin
      .from('evaluations')
      .insert({
        candidate_id: candidate.id,
        requisition_id: requisitionId,
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

    await supabaseAdmin.rpc('decrement_credit_and_log', {
      p_org_id: org.id,
      p_candidate_id: candidate.id
    });

    return NextResponse.json({ candidate, evaluation: evalRow });
  } catch (err: any) {
    console.error('Evaluation failed:', err);
    return NextResponse.json({ error: err.message ?? 'Evaluation failed' }, { status: 500 });
  }
}
