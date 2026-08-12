import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { anthropic, EVALUATION_MODEL } from '@/lib/anthropic';
import { EVALUATION_SYSTEM_PROMPT, EVALUATION_TOOL, buildEvaluationUserMessage } from '@/lib/systemPrompt';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// TEMPORARY DIAGNOSTIC ROUTE — not part of production scoring. Runs
// the SAME resume through two evaluators for direct comparison:
//
// TEST A: the original GPT evaluator, essentially verbatim — its own
// fixed 50/25/15/10 weighting, no Hiring Decision Model, no Stapphire
// architecture of any kind.
//
// TEST B: Stapphire's current production evaluator exactly as it runs
// today, using the requisition's actual current Hiring Decision Model.
//
// Nothing here writes to the evaluations table or affects any
// candidate's real, stored evaluation — this only reads and reports.
// Safe to delete once the diagnostic is complete.

const TEST_A_PROMPT = `
You are a seasoned Hiring Consultant embedded within the Talent
Acquisition team of a mission-driven organization. Your role is to
rigorously evaluate candidate resumes against a specific role. Your
tone is professional and direct — focused on truth over flattery — and
your assessments prioritize operational alignment, organizational
priorities, and strategic value over surface-level appeal. Be
analytical rather than optimistic.

Job Analysis: parse the job description into four pillars — Core
Responsibilities, Minimum & Preferred Qualifications, Hard Skills, Soft
Skills.

Weighted Candidate Evaluation, scored against exactly these weights:
- Job Responsibilities Match — 50%
- Hard Skills Alignment — 25%
- Soft Skills Alignment — 15%
- Keyword & Terminology Relevance — 10%

Do not infer experience that isn't supported by the resume. Do not
award credit for vague claims lacking evidence. Prioritize demonstrated
accomplishments over years of experience alone.

Verdict thresholds on the final weighted score: 85%+ -> "greenlight";
69-84% -> "consider"; 68% and below -> "decline".

Call submit_test_a_evaluation with your findings.
`.trim();

const TEST_A_TOOL = {
  name: 'submit_test_a_evaluation',
  description: 'Submit the Test A evaluation using the original fixed-weight framework.',
  input_schema: {
    type: 'object' as const,
    properties: {
      overall_match: { type: 'number' },
      status: { type: 'string', enum: ['greenlight', 'consider', 'decline'] },
      reasoning: { type: 'string', description: 'Explain the weighted calculation and how each of the four pillars scored' },
      strengths: { type: 'array', items: { type: 'string' } },
      gaps: { type: 'array', items: { type: 'string' } }
    },
    required: ['overall_match', 'status', 'reasoning', 'strengths', 'gaps']
  }
};

export async function GET(req: NextRequest, { params }: { params: { candidateId: string } }) {
  const { data: candidate, error: candError } = await supabaseAdmin
    .from('candidates')
    .select('id, full_name, resume_text, requisition_id')
    .eq('id', params.candidateId)
    .single();

  if (candError || !candidate) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }
  if (!candidate.resume_text) {
    return NextResponse.json({ error: 'This candidate has no stored resume_text to test against' }, { status: 400 });
  }

  const { data: requisition, error: reqError } = await supabaseAdmin
    .from('requisitions')
    .select('job_description, evaluation_pillars, employer_watchlist')
    .eq('id', candidate.requisition_id)
    .single();

  if (reqError || !requisition) {
    return NextResponse.json({ error: 'Requisition not found' }, { status: 404 });
  }

  // TEST A — original GPT, fixed weights, no Hiring Decision Model at all
  const testAUserMessage = JSON.stringify({
    job_description: requisition.job_description,
    resume_text: candidate.resume_text
  });

  const testAResponse = await anthropic.messages.create({
    model: EVALUATION_MODEL,
    max_tokens: 2048,
    system: TEST_A_PROMPT,
    tools: [TEST_A_TOOL],
    tool_choice: { type: 'tool', name: 'submit_test_a_evaluation' },
    messages: [{ role: 'user', content: testAUserMessage }]
  });
  const testABlock = testAResponse.content.find((b) => b.type === 'tool_use');
  const testAResult = testABlock && testABlock.type === 'tool_use' ? testABlock.input : null;

  // TEST B — current Stapphire production evaluator, unchanged
  const testBUserMessage = buildEvaluationUserMessage({
    jobDescription: requisition.job_description,
    hiringProfile: requisition.evaluation_pillars,
    employerWatchlist: requisition.employer_watchlist ?? [],
    resumeText: candidate.resume_text
  });

  const testBResponse = await anthropic.messages.create({
    model: EVALUATION_MODEL,
    max_tokens: 4096,
    system: EVALUATION_SYSTEM_PROMPT,
    tools: [EVALUATION_TOOL],
    tool_choice: { type: 'tool', name: 'submit_evaluation' },
    messages: [{ role: 'user', content: testBUserMessage }]
  });
  const testBBlock = testBResponse.content.find((b) => b.type === 'tool_use');
  const testBResult = testBBlock && testBBlock.type === 'tool_use' ? (testBBlock.input as any) : null;

  const scoreA = (testAResult as any)?.overall_match ?? null;
  const scoreB = testBResult?.overall_match ?? null;

  return NextResponse.json({
    candidate_name: candidate.full_name,
    test_a: { label: 'Original GPT (fixed 50/25/15/10)', ...(testAResult as any) },
    test_b: { label: 'Stapphire current job-specific model', ...testBResult },
    delta: scoreA !== null && scoreB !== null ? scoreB - scoreA : null
  });
}
