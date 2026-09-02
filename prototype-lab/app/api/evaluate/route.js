import OpenAI from 'openai';
import { getVercelOidcToken } from '@vercel/oidc';

export const runtime = 'nodejs';
export const maxDuration = 300;
const AI_MODEL = process.env.AI_GATEWAY_MODEL || 'openai/gpt-5.4';

const sourceSchema = { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } };

async function openai() {
  const apiKey = process.env.AI_GATEWAY_API_KEY || await getVercelOidcToken();
  if (!apiKey) throw new Error('AI Gateway authentication is unavailable.');
  return new OpenAI({ apiKey, baseURL: 'https://ai-gateway.vercel.sh/v1' });
}

function schema(criteria, gates) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'location', 'compensation', 'receptivity', 'strongestEvidence', 'gaps', 'unknowns', 'gateFindings', 'findings', 'sources'],
    properties: {
      summary: { type: 'string' },
      location: {
        type: 'object', additionalProperties: false, required: ['label', 'confidence', 'evidence'], properties: {
          label: { type: 'string' },
          confidence: { type: 'string', enum: ['CONFIRMED', 'PROBABLE', 'UNKNOWN'] },
          evidence: { type: 'string' }
        }
      },
      compensation: {
        type: 'object', additionalProperties: false, required: ['estimatedMarketRange', 'targetAlignment', 'confidence', 'rationale'], properties: {
          estimatedMarketRange: { type: 'string' },
          targetAlignment: { type: 'string', enum: ['LIKELY', 'STRETCH', 'UNLIKELY', 'UNKNOWN'] },
          confidence: { type: 'string', enum: ['HIGH', 'MODERATE', 'LOW'] },
          rationale: { type: 'string' }
        }
      },
      receptivity: {
        type: 'object', additionalProperties: false, required: ['level', 'confidence', 'signals', 'rationale'], properties: {
          level: { type: 'string', enum: ['HIGH', 'MODERATE', 'LOW', 'UNKNOWN'] },
          confidence: { type: 'string', enum: ['HIGH', 'MODERATE', 'LOW'] },
          signals: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' }
        }
      },
      strongestEvidence: { type: 'array', items: { type: 'string' } },
      gaps: { type: 'array', items: { type: 'string' } },
      unknowns: { type: 'array', items: { type: 'string' } },
      gateFindings: {
        type: 'array', minItems: gates.length, maxItems: gates.length, items: {
          type: 'object', additionalProperties: false, required: ['gateId', 'status', 'evidence', 'assessment'], properties: {
            gateId: { type: 'string', enum: gates.map((gate) => gate.id) },
            status: { type: 'string', enum: ['MET', 'NOT_MET', 'UNABLE_TO_DETERMINE'] },
            evidence: { type: 'string' },
            assessment: { type: 'string' }
          }
        }
      },
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
    const { title, targetLocation, searchScope, targetCompensation, jobDescription, gates, criteria, prospect } = await request.json();
    if (!title || !jobDescription || !Array.isArray(gates) || !gates.length || !Array.isArray(criteria) || !prospect?.fullName) return Response.json({ error: 'Evaluation input is incomplete.' }, { status: 400 });
    console.log(JSON.stringify({ level: 'info', message: 'Prospect evaluation started', requestId, prospect: prospect.fullName }));
    const client = await openai();
    const response = await client.responses.create({
      model: AI_MODEL,
      instructions: `Research the named person using public professional sources. Resolve identity carefully; never merge namesakes. Never seek contact details or protected traits. Do not invent experience.

First evaluate every non-negotiable sourcing gate exactly once. Similar titles and transferable skills do not satisfy an occupational or industry gate. Missing, ambiguous, stale, or inaccessible evidence is UNABLE_TO_DETERMINE—not NOT_MET. NOT_MET requires an explicit contradiction.

Then evaluate every weighted criterion exactly once. Score only 0, 25, 50, 75, or 100. Estimate market compensation as a broad range from role, seniority, geography, employer context, and reliable public benchmarks; do not claim to know present salary. Treat opportunity receptivity as an outreach hypothesis based only on observable professional signals. Use UNKNOWN and LOW confidence when evidence is weak. Compensation and receptivity must never affect qualification scoring. Return direct public sources. This is sourcing intelligence, not an employment decision.`,
      input: `POSITION\n${title}\n\nTARGET WORK LOCATION\n${targetLocation?.trim() || 'Not specified'}\n\nSEARCH SCOPE\n${searchScope || '50_MILES'}\n\nTARGET COMPENSATION RANGE\n${targetCompensation?.trim() || 'Not specified; return UNKNOWN alignment'}\n\nJOB DESCRIPTION\n${jobDescription}\n\nNON-NEGOTIABLE SOURCING GATES\n${JSON.stringify(gates)}\n\nWEIGHTED CRITERIA\n${JSON.stringify(criteria)}\n\nPROSPECT\n${JSON.stringify(prospect)}`,
      tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'], store: false, max_output_tokens: 14000,
      text: { format: { type: 'json_schema', name: 'prospect_evaluation', strict: true, schema: schema(criteria, gates) } }
    });
    if (response.status !== 'completed' || !response.output_text) throw new Error('Evaluation did not complete.');
    const evaluation = JSON.parse(response.output_text);
    const expectedGates = new Set(gates.map((gate) => gate.id));
    const expected = new Set(criteria.map((item) => item.id));
    if (evaluation.gateFindings.length !== gates.length || evaluation.gateFindings.some((finding) => !expectedGates.has(finding.gateId))) throw new Error('Sourcing-gate coverage was incomplete.');
    if (evaluation.findings.length !== criteria.length || evaluation.findings.some((finding) => !expected.has(finding.criterionId))) throw new Error('Criterion coverage was incomplete.');
    evaluation.sources = verifiedSources(response, evaluation.sources);
    if (!evaluation.sources.length) throw new Error('No verified sources were returned.');
    const byId = new Map(evaluation.findings.map((finding) => [finding.criterionId, finding]));
    const score = Math.round(criteria.reduce((sum, criterion) => sum + (byId.get(criterion.id)?.score || 0) * criterion.weight, 0) / 100);
    const sourcingFit = evaluation.gateFindings.some((finding) => finding.status === 'NOT_MET') ? 'EXCLUDED' : evaluation.gateFindings.some((finding) => finding.status === 'UNABLE_TO_DETERMINE') ? 'POSSIBLE' : 'QUALIFIED';
    console.log(JSON.stringify({ level: 'info', message: 'Prospect evaluation completed', requestId, prospect: prospect.fullName, score, sourcingFit, durationMs: Date.now() - startedAt }));
    return Response.json({ evaluation, score, sourcingFit });
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
