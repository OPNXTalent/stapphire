import OpenAI from 'openai';
import { getVercelOidcToken } from '@vercel/oidc';

export const runtime = 'nodejs';
export const maxDuration = 300;
const AI_MODEL = process.env.AI_GATEWAY_MODEL || 'openai/gpt-5.4';

const sourceSchema = { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } };

function schema(criteria, gates) {
  return {
    type: 'object', additionalProperties: false, required: ['booleanQuery', 'strategyRationale', 'prospects'], properties: {
      booleanQuery: { type: 'string' }, strategyRationale: { type: 'string' },
      prospects: { type: 'array', maxItems: 8, items: {
        type: 'object', additionalProperties: false,
        required: ['fullName', 'headline', 'location', 'geographicFit', 'publicEvidence', 'gateFindings', 'criterionSignals', 'sources'],
        properties: {
          fullName: { type: 'string' },
          headline: { type: 'string' },
          location: {
            type: 'object', additionalProperties: false, required: ['label', 'confidence', 'evidence'], properties: {
              label: { type: 'string' },
              confidence: { type: 'string', enum: ['CONFIRMED', 'PROBABLE', 'UNKNOWN'] },
              evidence: { type: 'string' }
            }
          },
          geographicFit: { type: 'string', enum: ['WITHIN_SCOPE', 'OUTSIDE_SCOPE', 'UNABLE_TO_DETERMINE'] },
          publicEvidence: { type: 'string' },
          gateFindings: {
            type: 'array', minItems: gates.length, maxItems: gates.length, items: {
              type: 'object', additionalProperties: false, required: ['gateId', 'status', 'evidence'], properties: {
                gateId: { type: 'string', enum: gates.map((gate) => gate.id) },
                status: { type: 'string', enum: ['MET', 'NOT_MET', 'UNABLE_TO_DETERMINE'] },
                evidence: { type: 'string' }
              }
            }
          },
          criterionSignals: {
            type: 'array', minItems: criteria.length, maxItems: criteria.length, items: {
              type: 'object', additionalProperties: false, required: ['criterionId', 'score', 'evidence'], properties: {
                criterionId: { type: 'string', enum: criteria.map((criterion) => criterion.id) },
                score: { type: 'integer', enum: [0, 25, 50, 75, 100] },
                evidence: { type: 'string' }
              }
            }
          },
          sources: { type: 'array', minItems: 1, items: sourceSchema }
        }
      } }
    }
  };
}

async function openai() {
  const apiKey = process.env.AI_GATEWAY_API_KEY || await getVercelOidcToken();
  if (!apiKey) throw new Error('AI Gateway authentication is unavailable.');
  return new OpenAI({ apiKey, baseURL: 'https://ai-gateway.vercel.sh/v1' });
}

function actualSources(response) {
  const sources = [];
  for (const item of response.output || []) {
    if (item.type !== 'web_search_call') continue;
    for (const source of item.action?.sources || []) if (source.url) sources.push({ title: source.title || source.url, url: source.url });
  }
  return sources;
}

function verifySources(response, requested) {
  const actual = new Map(actualSources(response).map((source) => [source.url.replace(/\/$/, ''), source]));
  return requested.flatMap((source) => {
    const match = actual.get(String(source.url).replace(/\/$/, ''));
    return match ? [{ title: source.title || match.title, url: match.url }] : [];
  });
}

export async function POST(request) {
  const startedAt = Date.now();
  const requestId = request.headers.get('x-vercel-id');
  try {
    const { title, targetLocation, searchScope, jobDescription, gates, criteria } = await request.json();
    if (!title?.trim() || !jobDescription?.trim() || !Array.isArray(gates) || !gates.length || !Array.isArray(criteria) || !criteria.length) return Response.json({ error: 'Position, job description, sourcing gates, and weighted criteria are required.' }, { status: 400 });
    const total = criteria.reduce((sum, item) => sum + Number(item.weight || 0), 0);
    if (total !== 100) return Response.json({ error: `Criteria weights total ${total}%. They must equal 100%.` }, { status: 400 });

    console.log(JSON.stringify({ level: 'info', message: 'Prospect search started', requestId }));
    const client = await openai();
    const response = await client.responses.create({
      model: AI_MODEL,
      instructions: `You are Stapphire's public-web talent sourcing researcher. Translate the supplied sourcing gates and weighted criteria into a precise Boolean search strategy, then use web search to identify up to 8 real people with identity-resolved public professional evidence.

Treat SOURCING GATES as non-negotiable occupational identity checks, not weighted preferences. A candidate with a contradicted gate must not be returned. A candidate with an uncertain gate may be returned only when the remaining evidence is unusually strong. Evaluate every gate and criterion exactly once. Similar titles and transferable skills are not proof of the required professional domain. Explicitly exclude false-positive industries, occupations, and alternate meanings.

Apply SEARCH SCOPE to the target work location. For a mileage radius, use credible location evidence and ordinary geographic distance. National means anywhere in the target location's country; Global means no country restriction. Do not return a prospect known to be outside scope. A strong prospect with uncertain location may be returned as UNABLE_TO_DETERMINE.

Search public professional profiles, employer and government bios, associations, conferences, portfolios, certifications, and publications. Never seek contact details, current salary, or protected traits. Never merge namesakes. Return a person only when sources establish identity and relevant experience. Location must be reported only at the precision supported by public evidence; use UNKNOWN when it cannot be established. Criterion scores describe available-evidence alignment, not a hiring decision. Missing evidence is unknown, not negative.`,
      input: `POSITION\n${title}\n\nTARGET WORK LOCATION\n${targetLocation?.trim() || 'Not specified'}\n\nSEARCH SCOPE\n${searchScope || '50_MILES'}\n\nJOB DESCRIPTION\n${jobDescription}\n\nNON-NEGOTIABLE SOURCING GATES\n${JSON.stringify(gates)}\n\nWEIGHTED CRITERIA\n${JSON.stringify(criteria)}`,
      tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'], store: false, max_output_tokens: 12000,
      text: { format: { type: 'json_schema', name: 'prospect_search', strict: true, schema: schema(criteria, gates) } }
    });
    if (response.status !== 'completed' || !response.output_text) throw new Error('Search did not complete.');
    const result = JSON.parse(response.output_text);
    const expectedGateIds = new Set(gates.map((gate) => gate.id));
    const expectedCriterionIds = new Set(criteria.map((criterion) => criterion.id));
    result.prospects = result.prospects.flatMap((prospect) => {
      const gateIds = new Set(prospect.gateFindings?.map((finding) => finding.gateId));
      const criterionIds = new Set(prospect.criterionSignals?.map((finding) => finding.criterionId));
      if (gateIds.size !== gates.length || [...gateIds].some((id) => !expectedGateIds.has(id))) return [];
      if (criterionIds.size !== criteria.length || [...criterionIds].some((id) => !expectedCriterionIds.has(id))) return [];
      const sources = verifySources(response, prospect.sources);
      if (!prospect.fullName?.trim() || !prospect.publicEvidence?.trim() || !sources.length || prospect.geographicFit === 'OUTSIDE_SCOPE') return [];
      const hasContradiction = prospect.gateFindings.some((finding) => finding.status === 'NOT_MET');
      if (hasContradiction) return [];
      const sourcingFit = prospect.gateFindings.some((finding) => finding.status === 'UNABLE_TO_DETERMINE') ? 'POSSIBLE' : 'QUALIFIED';
      const byId = new Map(prospect.criterionSignals.map((finding) => [finding.criterionId, finding]));
      const preliminaryScore = Math.round(criteria.reduce((sum, criterion) => sum + (byId.get(criterion.id)?.score || 0) * criterion.weight, 0) / 100);
      return [{ ...prospect, sources, sourcingFit, preliminaryScore }];
    }).sort((a, b) => (a.sourcingFit === b.sourcingFit ? b.preliminaryScore - a.preliminaryScore : a.sourcingFit === 'QUALIFIED' ? -1 : 1));
    if (!result.prospects.length) return Response.json({ error: 'The search found no people with sufficiently verified public evidence. Refine the criteria and try again.' }, { status: 422 });
    console.log(JSON.stringify({ level: 'info', message: 'Prospect search completed', requestId, prospects: result.prospects.length, durationMs: Date.now() - startedAt }));
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: 'error', message: 'Prospect search failed', requestId, error: message, durationMs: Date.now() - startedAt }));
    const authenticationFailed = message.includes('authentication is unavailable');
    return Response.json(
      { error: authenticationFailed ? 'The preview search service is not authenticated yet.' : 'The public-web search failed. Try again.' },
      { status: authenticationFailed ? 503 : 500 }
    );
  }
}
