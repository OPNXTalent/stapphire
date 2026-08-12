import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { anthropic, EVALUATION_MODEL } from '@/lib/anthropic';
import {
  EVALUATION_SYSTEM_PROMPT,
  EVALUATION_TOOL,
  buildEvaluationUserMessage,
  EVALUATION_PROMPT_VERSION,
  calculateMatch,
  calculateStatus
} from '@/lib/systemPrompt';
import { extractTextFromBuffer } from '@/lib/extractText';

// Re-running an evaluation against a candidate you've already paid to
// evaluate once isn't a new product — it's Stapphire staying accurate
// as understanding of the role or the candidate improves. That should
// never cost anything, and shouldn't require a separate deliberate
// click every time context changes: it should just happen. This never
// overwrites a prior evaluation — it adds a new one, same as always,
// preserving full history.
export async function reevaluateCandidate(
  candidateId: string
): Promise<{ success: true; evaluation: any } | { success: false; error: string }> {
  const { data: candidate, error: candError } = await supabaseAdmin
    .from('candidates')
    .select('id, full_name, source_filename, original_file_url, requisition_id, additional_context')
    .eq('id', candidateId)
    .single();

  if (candError || !candidate) {
    return { success: false, error: 'Candidate not found' };
  }

  if (!candidate.original_file_url) {
    return { success: false, error: 'The original resume file is not available for this candidate.' };
  }

  const { data: requisition, error: reqError } = await supabaseAdmin
    .from('requisitions')
    .select('*')
    .eq('id', candidate.requisition_id)
    .single();

  if (reqError || !requisition) {
    return { success: false, error: 'Requisition not found' };
  }

  const { data: fileData, error: downloadError } = await supabaseAdmin.storage
    .from('resumes')
    .download(candidate.original_file_url);

  if (downloadError || !fileData) {
    return { success: false, error: 'Could not retrieve the original resume file' };
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  const resumeText = await extractTextFromBuffer(buffer, candidate.source_filename ?? 'resume', undefined);

  // Relative context only — informational, never allowed to change this
  // candidate's own absolute score. Deliberately a compact headline per
  // candidate, not their full evaluation, to keep the prompt small as
  // the pool grows.
  const { data: otherCandidateRows } = await supabaseAdmin
    .from('candidates')
    .select('id, full_name, evaluations(overall_match, thesis, strengths, created_at)')
    .eq('requisition_id', candidate.requisition_id)
    .is('deleted_at', null)
    .neq('id', candidate.id);

  const otherCandidates = (otherCandidateRows ?? [])
    .map((c: any) => {
      const latest = (c.evaluations ?? []).sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];
      if (!latest) return null;
      const headline = latest.thesis || latest.strengths?.[0] || '';
      return { name: c.full_name, overall_match: latest.overall_match, headline };
    })
    .filter((c): c is { name: string; overall_match: number; headline: string } => c !== null);

  const userMessage = buildEvaluationUserMessage({
    jobDescription: requisition.job_description,
    hiringProfile: requisition.evaluation_pillars,
    employerWatchlist: requisition.employer_watchlist ?? [],
    additionalContext: candidate.additional_context,
    resumeText,
    otherCandidates
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
    return { success: false, error: 'Model did not return a structured evaluation' };
  }

  const evaluation = toolUseBlock.input as any;

  // The one and only place this candidate's Match and verdict get
  // computed — deterministically, from Claude's four category scores.
  // Claude never sees this arithmetic and never returns a final number
  // itself, so there's no way for a holistic-but-unverified guess to
  // drift from the category-level reasoning that's supposed to support it.
  const categoryScores = {
    job_responsibilities_score: evaluation.job_responsibilities_score,
    hard_skills_score: evaluation.hard_skills_score,
    soft_skills_score: evaluation.soft_skills_score,
    keyword_terminology_score: evaluation.keyword_terminology_score
  };
  const dealBreakers: string[] = evaluation.deal_breakers ?? [];
  const overallMatch = calculateMatch(categoryScores);
  const status = calculateStatus(overallMatch, dealBreakers);

  await supabaseAdmin.from('candidates').update({ resume_text: resumeText }).eq('id', candidate.id);

  const { data: evalRow, error: evalError } = await supabaseAdmin
    .from('evaluations')
    .insert({
      candidate_id: candidate.id,
      requisition_id: requisition.id,
      overall_match: overallMatch,
      profile_revision: requisition.profile_revision ?? null,
      additional_context_snapshot: candidate.additional_context ?? null,
      context_assessment: evaluation.context_assessment ?? null,
      resume_gap_flag: evaluation.resume_gap_flag ?? null,
      prompt_version: EVALUATION_PROMPT_VERSION,
      status,
      scores: categoryScores,
      deal_breakers: dealBreakers.length > 0 ? dealBreakers : null,
      signals: evaluation.signals,
      strengths: evaluation.strengths,
      gaps: (evaluation.gaps_structured ?? []).map((g: any) => g.description),
      gaps_structured: evaluation.gaps_structured ?? null,
      ats_compatibility: evaluation.ats_compatibility,
      employment_history: evaluation.employment_history,
      risk_flags: evaluation.risk_flags,
      interview_recommendations: evaluation.interview_recommendations,
      matrix_dimensions: evaluation.matrix_dimensions,
      dimension_tiers: evaluation.dimension_tiers ?? null,
      thesis: evaluation.thesis ?? null,
      standout_reasons: evaluation.standout_reasons ?? null,
      strongest_job_specific_matches: evaluation.strongest_job_specific_matches ?? null,
      most_important_concern: evaluation.most_important_concern ?? null,
      candidate_comparison: evaluation.candidate_comparison ?? null,
      raw_model_response: evaluation
    })
    .select()
    .single();

  if (evalError) {
    return { success: false, error: evalError.message };
  }

  return { success: true, evaluation: evalRow };
}
