import OpenAI from 'openai';
import { validateNeutralCriterionFindings, type AppliedCriterion, type CriterionScore, type KnockoutStatus } from './criteriaEvaluation';
import { projectCriterionFindings, type CriterionFinding } from './criterionProjection';

const SOURCING_MODEL = process.env.OPENAI_SOURCING_MODEL || process.env.OPENAI_EVALUATION_MODEL || 'gpt-5.6';
const MAX_PROSPECTS = 8;

export type ProspectSource = { title: string; url: string };
export type SourcedProspect = {
  fullName: string;
  preliminaryScore: number;
  headline: string;
  location: string;
  publicEvidence: string;
  sources: ProspectSource[];
};
export type ProspectSearchResult = {
  booleanQuery: string;
  strategyRationale: string;
  prospects: SourcedProspect[];
  modelIdentifier: string;
};
export type ProspectEvaluation = {
  summary: string;
  strongestEvidence: string[];
  gaps: string[];
  unknowns: string[];
  criterionFindings: CriterionFinding[];
  sources: ProspectSource[];
};

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  return new OpenAI({ apiKey });
}

const sourceSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['title', 'url'],
  properties: { title: { type: 'string' as const }, url: { type: 'string' as const } }
};

function criterionIdSchema(criteria: AppliedCriterion[]) {
  return { type: 'string' as const, enum: criteria.map((criterion) => criterion.id) };
}

function searchSchema() {
  return {
    type: 'object' as const,
    additionalProperties: false,
    required: ['booleanQuery', 'strategyRationale', 'prospects'],
    properties: {
      booleanQuery: { type: 'string' as const },
      strategyRationale: { type: 'string' as const },
      prospects: {
        type: 'array' as const,
        maxItems: MAX_PROSPECTS,
        items: {
          type: 'object' as const,
          additionalProperties: false,
          required: ['fullName', 'preliminaryScore', 'headline', 'location', 'publicEvidence', 'sources'],
          properties: {
            fullName: { type: 'string' as const },
            preliminaryScore: { type: 'integer' as const, minimum: 0, maximum: 100 },
            headline: { type: 'string' as const },
            location: { type: 'string' as const },
            publicEvidence: { type: 'string' as const },
            sources: { type: 'array' as const, minItems: 1, items: sourceSchema }
          }
        }
      }
    }
  };
}

function evaluationSchema(criteria: AppliedCriterion[]) {
  return {
    type: 'object' as const,
    additionalProperties: false,
    required: ['summary', 'strongestEvidence', 'gaps', 'unknowns', 'criterionFindings', 'sources'],
    properties: {
      summary: { type: 'string' as const },
      strongestEvidence: { type: 'array' as const, items: { type: 'string' as const } },
      gaps: { type: 'array' as const, items: { type: 'string' as const } },
      unknowns: { type: 'array' as const, items: { type: 'string' as const } },
      criterionFindings: {
        type: 'array' as const,
        minItems: criteria.length,
        maxItems: criteria.length,
        items: {
          type: 'object' as const,
          additionalProperties: false,
          required: ['criterionId', 'alignmentScore', 'satisfactionStatus', 'evidence', 'assessment'],
          properties: {
            criterionId: criterionIdSchema(criteria),
            alignmentScore: { type: 'integer' as const, enum: [0, 25, 50, 75, 100] },
            satisfactionStatus: { type: 'string' as const, enum: ['MET', 'NOT_MET', 'UNABLE_TO_DETERMINE'] },
            evidence: { type: 'string' as const },
            assessment: { type: 'string' as const }
          }
        }
      },
      sources: { type: 'array' as const, minItems: 1, items: sourceSchema }
    }
  };
}

function parseJson<T>(outputText: string, label: string): T {
  try { return JSON.parse(outputText) as T; }
  catch { throw new Error(`OpenAI returned an invalid ${label}.`); }
}

function validUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; }
  catch { return false; }
}

function cleanSources(sources: ProspectSource[]): ProspectSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (!source.title.trim() || !validUrl(source.url) || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.toString();
  } catch { return null; }
}

function verifiedWebSources(response: unknown, requested: ProspectSource[]): ProspectSource[] {
  const source = response !== null && typeof response === 'object' ? response as Record<string, unknown> : {};
  const output = Array.isArray(source.output) ? source.output : [];
  const actual = output.flatMap((item) => {
    const call = item !== null && typeof item === 'object' ? item as Record<string, unknown> : {};
    if (call.type !== 'web_search_call') return [];
    const action = call.action !== null && typeof call.action === 'object' ? call.action as Record<string, unknown> : {};
    return Array.isArray(action.sources) ? action.sources.flatMap((raw) => {
      const candidate = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      return typeof candidate.url === 'string' ? [{ title: typeof candidate.title === 'string' ? candidate.title : candidate.url, url: candidate.url }] : [];
    }) : [];
  });
  const actualByUrl = new Map(cleanSources(actual).map((item) => [canonicalUrl(item.url), item]));
  return cleanSources(requested).flatMap((item) => {
    const verified = actualByUrl.get(canonicalUrl(item.url));
    return verified ? [{ title: item.title.trim() || verified.title, url: verified.url }] : [];
  });
}

export async function searchForProspects(input: { title: string; jobDescription: string; criteria: AppliedCriterion[] }): Promise<ProspectSearchResult> {
  const response = await client().responses.create({
    model: SOURCING_MODEL,
    instructions: `You are Stapphire's public-web talent sourcing researcher. Translate the immutable weighted Hiring Criteria into a precise Boolean search strategy, then use web search to identify up to ${MAX_PROSPECTS} real people with strong, identity-resolved public professional evidence.

Prioritize the highest-weight criteria and exact occupational context. Treat title synonyms as supporting signals, never substitutes for duties. Exclude false-positive industries and meanings explicitly. Search public professional pages, employer bios, government or association pages, conference biographies, portfolios, certifications, publications, and public profile pages. Never seek or return contact details, protected traits, or inferred sensitive information.

Return a person only when at least one source clearly supports both identity and relevant professional evidence. Do not merge namesakes. Preliminary score is available-evidence alignment to the supplied weights, not a hiring decision. Missing public evidence is unknown, not a negative fact. Every prospect must have at least one working source URL.`,
    input: `POSITION\n${input.title}\n\nJOB DESCRIPTION SNAPSHOT\n${input.jobDescription}\n\nIMMUTABLE WEIGHTED HIRING CRITERIA\n${JSON.stringify(input.criteria)}`,
    tools: [{ type: 'web_search' }],
    include: ['web_search_call.action.sources'],
    max_output_tokens: 12000,
    store: false,
    text: { format: { type: 'json_schema', name: 'prospect_search_results', strict: true, schema: searchSchema() } }
  });
  if (response.status !== 'completed' || !response.output_text) throw new Error('Public-web prospect search did not complete.');
  const result = parseJson<Omit<ProspectSearchResult, 'modelIdentifier'>>(response.output_text, 'prospect search result');
  const prospects = result.prospects
    .map((prospect) => ({ ...prospect, fullName: prospect.fullName.trim(), publicEvidence: prospect.publicEvidence.trim(), sources: verifiedWebSources(response, prospect.sources) }))
    .filter((prospect) => prospect.fullName && prospect.publicEvidence && prospect.sources.length > 0)
    .sort((a, b) => b.preliminaryScore - a.preliminaryScore)
    .slice(0, MAX_PROSPECTS);
  return { ...result, prospects, modelIdentifier: response.model };
}

export async function evaluateProspect(input: { title: string; jobDescription: string; criteria: AppliedCriterion[]; prospect: SourcedProspect }): Promise<{ evaluation: ProspectEvaluation; score: number; modelIdentifier: string }> {
  const response = await client().responses.create({
    model: SOURCING_MODEL,
    instructions: `You are Stapphire's evidence-based public-profile evaluator. Research the named person using public professional sources and evaluate only the exact immutable Hiring Criteria supplied.

Resolve identity carefully and do not merge namesakes. Use public professional evidence only. Do not seek contact details or use protected traits. Do not invent experience. Missing, ambiguous, stale, or inaccessible evidence must be UNABLE_TO_DETERMINE rather than NOT_MET. NOT_MET requires an explicit contradiction. Use the alignment scale 0, 25, 50, 75, or 100. Return every criterion exactly once. This is a sourcing evaluation, not an employment decision. Include direct source URLs supporting the evaluation.`,
    input: `POSITION\n${input.title}\n\nJOB DESCRIPTION SNAPSHOT\n${input.jobDescription}\n\nIMMUTABLE WEIGHTED HIRING CRITERIA\n${JSON.stringify(input.criteria)}\n\nPROSPECT IDENTITY AND INITIAL PUBLIC EVIDENCE\n${JSON.stringify(input.prospect)}`,
    tools: [{ type: 'web_search' }],
    include: ['web_search_call.action.sources'],
    max_output_tokens: 14000,
    store: false,
    text: { format: { type: 'json_schema', name: 'prospect_evaluation', strict: true, schema: evaluationSchema(input.criteria) } }
  });
  if (response.status !== 'completed' || !response.output_text) throw new Error('Public-web prospect evaluation did not complete.');
  const evaluation = parseJson<ProspectEvaluation>(response.output_text, 'prospect evaluation');
  validateNeutralCriterionFindings(input.criteria, evaluation.criterionFindings as Array<CriterionFinding & { alignmentScore: CriterionScore; satisfactionStatus: KnockoutStatus }>);
  evaluation.sources = verifiedWebSources(response, evaluation.sources);
  if (evaluation.sources.length === 0) throw new Error('The evaluation did not contain verifiable public sources.');
  const projection = projectCriterionFindings(input.criteria, evaluation.criterionFindings);
  if (!projection.complete || projection.overallMatch === null) throw new Error('The evaluation did not cover every applied criterion.');
  return { evaluation, score: projection.overallMatch, modelIdentifier: response.model };
}
