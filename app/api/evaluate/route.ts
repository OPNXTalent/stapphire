import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { anthropic, EVALUATION_MODEL } from '@/lib/anthropic';
import { EVALUATION_SYSTEM_PROMPT, EVALUATION_TOOL, buildEvaluationUserMessage } from '@/lib/systemPrompt';
import { extractTextFromFile } from '@/lib/extractText';

// Vercel kills serverless functions at 10s by default on the Hobby plan.
// A full resume evaluation (text extraction + Claude call) routinely
// runs longer than that. This raises the ceiling to the Hobby plan's max.
export const maxDuration = 60;

// Streams newline-delimited JSON status events to the client so the
// upload button can show real progress instead of a static spinner for
// 10-15 seconds. Each line is one JSON object; the client reads the
// response body as a stream and parses line by line.
function sseLine(obj: unknown) {
  return new TextEncoder().encode(JSON.stringify(obj) + '\n');
}

export async function POST(req: NextRequest) {
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(sseLine(obj));

      try {
        const formData = await req.formData();
        const requisitionId = formData.get('requisition_id') as string | null;
        const file = formData.get('file') as File | null;

        if (!requisitionId || !file) {
          send({ type: 'error', message: 'requisition_id and file are required' });
          controller.close();
          return;
        }

        send({ type: 'status', message: 'Loading requisition' });

        const { data: requisition, error: reqError } = await supabaseAdmin
          .from('requisitions')
          .select('*, organizations(*)')
          .eq('id', requisitionId)
          .single();

        if (reqError || !requisition) {
          send({ type: 'error', message: 'Requisition not found' });
          controller.close();
          return;
        }

        const org = requisition.organizations as { id: string; credits_remaining: number };

        send({ type: 'status', message: 'Reading resume' });
        const resumeText = await extractTextFromFile(file);
        const contentHash = createHash('sha256').update(resumeText.trim().toLowerCase()).digest('hex');

        // Duplicate check — never re-evaluate, never charge twice, never mention it.
        const { data: existing } = await supabaseAdmin
          .from('candidates')
          .select('id, full_name, evaluations(*)')
          .eq('requisition_id', requisitionId)
          .eq('content_hash', contentHash)
          .maybeSingle();

        if (existing) {
          send({ type: 'done', candidate: existing, deduped: true });
          controller.close();
          return;
        }

        if (org.credits_remaining <= 0) {
          send({ type: 'error', message: 'No evaluation credits remaining' });
          controller.close();
          return;
        }

        send({ type: 'status', message: 'Checking evidence against the job description' });

        const userMessage = buildEvaluationUserMessage({
          jobDescription: requisition.job_description,
          evaluationPillars: requisition.evaluation_pillars,
          employerWatchlist: requisition.employer_watchlist ?? [],
          resumeText
        });

        const anthropicStream = anthropic.messages.stream({
          model: EVALUATION_MODEL,
          max_tokens: 4096,
          system: EVALUATION_SYSTEM_PROMPT,
          tools: [EVALUATION_TOOL],
          tool_choice: { type: 'tool', name: 'submit_evaluation' },
          messages: [{ role: 'user', content: userMessage }]
        });

        // Coarse progress signal: how much structured output has arrived
        // so far. Not exact, but enough to show real movement instead of
        // a frozen spinner.
        let charsSoFar = 0;
        let lastUpdate = 0;
        anthropicStream.on('streamEvent', (event) => {
          if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
            charsSoFar += event.delta.partial_json.length;
            const now = Date.now();
            if (now - lastUpdate > 400) {
              lastUpdate = now;
              send({ type: 'progress', message: 'Scoring against the weighted rubric', chars: charsSoFar });
            }
          }
        });

        const finalMessage = await anthropicStream.finalMessage();
        const toolUseBlock = finalMessage.content.find((b) => b.type === 'tool_use');
        if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
          send({ type: 'error', message: 'Model did not return a structured evaluation' });
          controller.close();
          return;
        }

        const evaluation = toolUseBlock.input as any;

        send({ type: 'status', message: 'Saving results' });

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

        // Non-resume uploads are stored but do not consume a credit and
        // are not scored — resolved decision from the spec: invalid
        // uploads are free.
        if (evaluation.document_type === 'non_resume') {
          send({ type: 'done', candidate, evaluation: null, skipped: 'non_resume' });
          controller.close();
          return;
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

        send({ type: 'done', candidate, evaluation: evalRow });
        controller.close();
      } catch (err: any) {
        console.error('Evaluation failed:', err);
        send({ type: 'error', message: err.message ?? 'Evaluation failed' });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' }
  });
}
