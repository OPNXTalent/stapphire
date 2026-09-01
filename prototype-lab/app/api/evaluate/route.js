import OpenAI from 'openai';
import { getVercelOidcToken } from '@vercel/oidc';

export const runtime = 'nodejs';
export const maxDuration = 300;
const AI_MODEL = process.env.AI_GATEWAY_MODEL || 'openai/gpt-5.6-sol';

const sourceSchema = { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } };

async function openai() {
  const apiKey = process.env.AI_GATEWAY_API_KEY || await getVercelOidcToken();
  if (!apiKey) throw new Error('AI Gateway authentication is unavailable.');
  return new OpenAI({ apiKey, baseURL: 'https://ai-gateway.vercel.sh/v1' });
}

function schema(criteria) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'strongestEvidence', 'gaps', 'unknowns', 'findings', 'sources'],
    properties: {
      summary: { type: 'string' },
      strongestEvidence: { type: 'array', items: { type: 'string' } },
      gaps: { type: 'array', items: { type: 'string' } },
      unknowns: { type: 'array', items: { type: 'string' } },
      findings: {
        type: 'array',
        minItems: criteria.length,
        maxItems: criteria.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterionId', 'score', 'status', 'evidence', 'assessment'],
          properties: {
            criterionId: { type: 'string', enum: criteria.map((item) => item.id) },
            score: { type: 'integer', enum: [0, 25, 50, 75, 100] },
            status: { type: 'string', enum: ['MET', 'NOT_MET', 'UNABLE_TO_DETERMINE'] },
            evidence: { type: 'string' },
            assessment: { type: 'string' }
          }
        }
      },
      sources: { type: 'array', minItems: 1, items: sourceSchema }
    }
  };
}

function verifiedSources(response, requested) {
  const actual = new Map();
  for (const item of response.output || []) if (item.type === 'web_search_call') for (const source of item.action?.sources || []) if (source.url) actual.set(source.url.replace(/\/$/, ''), { title: source.title || source.url, url: source.url });
  return requested.flatMap((source) => { const match = actual.get(String(source.url).replace(/\/$/, '')); return match ? [{ title: source.title || match.title, url: match.url }] : []; });
}

export async function POST(request) {
  const startedAt = Date.now();
  const requestId = request.headers.get('x-vercel-id');
  try {
    const { title, jobDescription, criteria, prospect } = await request.json();
    if (!title || !jobDescription || !Array.isArray(criteria) || !prospect?.fullName) return Response.json({ error: 'Evaluation input is incomplete.' }, { status: 400 });
    console.log(JSON.stringify({ level: 'info', message: 'Prospect evaluation started', requestId, prospect: prospect.fullName }));
    const client = await openai();
    const response = await client.responses.create({
      model: AI_MODEL,
      instructions: `Research the named person using public professional sources and evaluate only the supplied weighted criteria. Resolve identity carefully; never merge namesakes. Never seek contact details or protected traits. Do not invent experience. Missing, ambiguous, stale, or inaccessible evidence is UNABLE_TO_DETERMINE—not NOT_MET. NOT_MET requires an explicit contradiction. Score only 0, 25, 50, 75, or 100. Return every criterion exactly once with direct public sources. This is a sourcing evaluation, not an employment decision.`,
      input: `POSITION\n${title}\n\nJOB DESCRIPTION\n${jobDescription}\n\nWEIGHTED CRITERIA\n${JSON.stringify(criteria)}\n\nPROSPECT\n${JSON.stringify(prospect)}`,
      tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'], store: false, max_output_tokens: 14000,
      text: { format: { type: 'json_schema', name: 'prospect_evaluation', strict: true, schema: schema(criteria) } }
    });
    if (response.status !== 'completed' || !response.output_text) throw new Error('Evaluation did not complete.');
    const evaluation = JSON.parse(response.output_text);
    const expected = new Set(criteria.map((item) => item.id));
    if (evaluation.findings.length !== criteria.length || evaluation.findings.some((finding) => !expected.has(finding.criterionId))) throw new Error('Criterion coverage was incomplete.');
    evaluation.sources = verifiedSources(response, evaluation.sources);
    if (!evaluation.sources.length) throw new Error('No verified sources were returned.');
    const byId = new Map(evaluation.findings.map((finding) => [finding.criterionId, finding]));
    const score = Math.round(criteria.reduce((sum, criterion) => sum + (byId.get(criterion.id)?.score || 0) * criterion.weight, 0) / 100);
    console.log(JSON.stringify({ level: 'info', message: 'Prospect evaluation completed', requestId, prospect: prospect.fullName, score, durationMs: Date.now() - startedAt }));
    return Response.json({ evaluation, score });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: 'error', message: 'Prospect evaluation failed', requestId, error: message, durationMs: Date.now() - startedAt }));
    const authenticationFailed = message.includes('authentication is unavailable');
    return Response.json(
      { error: authenticationFailed ? 'The preview evaluation service is not authenticated yet.' : 'The full evaluation failed. No test QC was used.' },
      { status: authenticationFailed ? 503 : 500 }
    );
  }
}
