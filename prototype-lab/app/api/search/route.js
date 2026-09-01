import OpenAI from 'openai';
import { getVercelOidcToken } from '@vercel/oidc';

export const runtime = 'nodejs';
export const maxDuration = 300;

const sourceSchema = { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } };
const schema = {
  type: 'object', additionalProperties: false, required: ['booleanQuery', 'strategyRationale', 'prospects'], properties: {
    booleanQuery: { type: 'string' }, strategyRationale: { type: 'string' },
    prospects: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['fullName', 'preliminaryScore', 'headline', 'location', 'publicEvidence', 'sources'], properties: {
      fullName: { type: 'string' }, preliminaryScore: { type: 'integer', minimum: 0, maximum: 100 }, headline: { type: 'string' }, location: { type: 'string' }, publicEvidence: { type: 'string' }, sources: { type: 'array', minItems: 1, items: sourceSchema }
    } } }
  }
};

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
    const { title, jobDescription, criteria } = await request.json();
    if (!title?.trim() || !jobDescription?.trim() || !Array.isArray(criteria) || !criteria.length) return Response.json({ error: 'Position, job description, and weighted criteria are required.' }, { status: 400 });
    const total = criteria.reduce((sum, item) => sum + Number(item.weight || 0), 0);
    if (total !== 100) return Response.json({ error: `Criteria weights total ${total}%. They must equal 100%.` }, { status: 400 });

    console.log(JSON.stringify({ level: 'info', message: 'Prospect search started', requestId }));
    const client = await openai();
    const response = await client.responses.create({
      model: 'openai/gpt-5.6',
      instructions: `You are Stapphire's public-web talent sourcing researcher. Translate the supplied weighted criteria into a precise Boolean search strategy, then use web search to identify up to 8 real people with identity-resolved public professional evidence.

Prioritize the highest weights and exact occupational context. A similar title is not proof of relevant duties. Explicitly exclude false-positive industries and meanings. Search public professional profiles, employer and government bios, associations, conferences, portfolios, certifications, and publications. Never seek contact details or protected traits. Never merge namesakes. Return a person only when sources establish both identity and relevant experience. Preliminary score means available-evidence alignment—not a hiring decision. Missing evidence is unknown, not negative.`,
      input: `POSITION\n${title}\n\nJOB DESCRIPTION\n${jobDescription}\n\nWEIGHTED CRITERIA\n${JSON.stringify(criteria)}`,
      tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'], store: false, max_output_tokens: 12000,
      text: { format: { type: 'json_schema', name: 'prospect_search', strict: true, schema } }
    });
    if (response.status !== 'completed' || !response.output_text) throw new Error('Search did not complete.');
    const result = JSON.parse(response.output_text);
    result.prospects = result.prospects.map((prospect) => ({ ...prospect, sources: verifySources(response, prospect.sources) })).filter((prospect) => prospect.fullName?.trim() && prospect.publicEvidence?.trim() && prospect.sources.length).sort((a, b) => b.preliminaryScore - a.preliminaryScore);
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
