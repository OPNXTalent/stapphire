import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { anthropic, EVALUATION_MODEL } from '@/lib/anthropic';
import { EVALUATION_SYSTEM_PROMPT, EVALUATION_TOOL, buildEvaluationUserMessage } from '@/lib/systemPrompt';
import { extractTextFromBuffer } from '@/lib/extractText';

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

        const org = requisition.organizations as { id: string; credits_remaining: number; credits_total: number };

        send({ type: 'status', message: 'Reading resume' });
        const buffer = Buffer.from(await file.arrayBuffer());
        const resumeText = await extractTextFromBuffer(buffer, file.name, file.type);
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

        // No paid credits doesn't automatically mean "blocked" — orgs
        // trying the product get 5 free evaluations per rolling 24
        // hours, checked against real timestamps rather than a
        // calendar-day reset.
        let usingFreeTrial = false;
        if (org.credits_remaining <= 0) {
          if (org.credits_total > 0) {
            // Has purchased before, just currently at zero — the free
            // trial isn't a leak valve for paying customers who ran
            // out; that's what upgrading is for.
            send({ type: 'error', message: 'No evaluation credits remaining' });
            controller.close();
            return;
          }
          const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { count, error: trialCheckError } = await supabaseAdmin
            .from('free_trial_usage')
            .select('*', { count: 'exact', head: true })
            .eq('org_id', org.id)
            .gte('used_at', dayAgo);

          if (trialCheckError) {
            send({ type: 'error', message: trialCheckError.message });
            controller.close();
            return;
          }

          if ((count ?? 0) >= 5) {
            send({
              type: 'error',
              message: 'Free trial limit reached — 5 evaluations per 24 hours. Upgrade for more.'
            });
            controller.close();
            return;
          }
          usingFreeTrial = true;
        }

        send({ type: 'status', message: 'Checking evidence against the job description' });

        const userMessage = buildEvaluationUserMessage({
          jobDescription: requisition.job_description,
          evaluationPillars: requisition.evaluation_pillars,
          employerWatchlist: requisition.employer_watchlist ?? [],
          evaluationPriorities: requisition.evaluation_priorities,
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

        // Store the original file so recruiters can download exactly
        // what the candidate submitted, not just the extracted text.
        // Non-critical path — a storage failure shouldn't sink the whole
        // evaluation, so it's logged rather than thrown.
        let storagePath: string | null = null;
        try {
          const ext = file.name.includes('.') ? file.name.split('.').pop() : 'dat';
          storagePath = `${requisitionId}/${contentHash}.${ext}`;
          console.log('[resume-storage] attempting upload to path:', storagePath, 'bytes:', buffer.length);

          const { data: uploadData, error: storageError } = await supabaseAdmin.storage
            .from('resumes')
            .upload(storagePath, buffer, {
              contentType: file.type || 'application/octet-stream',
              upsert: true
            });

          if (storageError) {
            console.error('[resume-storage] upload returned an error:', JSON.stringify(storageError));
            storagePath = null;
          } else {
            console.log('[resume-storage] upload succeeded, response data:', JSON.stringify(uploadData));
          }
        } catch (storageErr: any) {
          console.error('[resume-storage] upload threw an exception:', storageErr?.message ?? storageErr);
          storagePath = null;
        }

        console.log('[resume-storage] final storagePath being inserted into candidates row:', storagePath);

        const { data: candidate, error: candidateError } = await supabaseAdmin
          .from('candidates')
          .insert({
            requisition_id: requisitionId,
            full_name: evaluation.candidate_name,
            source_filename: file.name,
            original_file_url: storagePath,
            content_hash: contentHash,
            document_type: evaluation.document_type
          })
          .select()
          .single();

        if (candidateError) throw candidateError;
        console.log('[resume-storage] candidate row after insert, original_file_url:', candidate?.original_file_url);

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

        if (usingFreeTrial) {
          await supabaseAdmin.from('free_trial_usage').insert({ org_id: org.id });
        } else {
          await supabaseAdmin.rpc('decrement_credit_and_log', {
            p_org_id: org.id,
            p_candidate_id: candidate.id
          });
        }

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
