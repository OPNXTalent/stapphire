import OpenAI from 'openai';
import { getVercelOidcToken } from '@vercel/oidc';
import { validateNeutralCriterionFindings, type AppliedCriterion, type CriterionScore, type KnockoutStatus } from './criteriaEvaluation';
import { projectCriterionFindings, type CriterionFinding } from './criterionProjection';

const SOURCING_MODEL = process.env.AI_GATEWAY_MODEL || 'openai/gpt-5.4';
const MAX_PROSPECTS = 8;
const SOURCING_FIT_UPLIFT = 4;

export const SEARCH_SCOPES = ['25_MILES', '50_MILES', '100_MILES', '500_MILES', 'NATIONAL', 'GLOBAL'] as const;
export type SearchScope = typeof SEARCH_SCOPES[number];
export type SourcingGate = { id: string; label: string };
export type ProspectLocation = { label: string; confidence: 'CONFIRMED' | 'PROBABLE' | 'UNKNOWN'; evidence: string };
export type GateFinding = { gateId: string; status: KnockoutStatus; evidence: string; assessment?: string };
export type MarketAnalysis = { scarcityLevel: 'BROAD' | 'COMPETITIVE' | 'SCARCE' | 'UNICORN'; confidence: 'HIGH' | 'MODERATE' | 'LOW'; summary: string; constraintDrivers: Array<{ constraint: string; impact: 'HIGH' | 'MODERATE' | 'LOW'; explanation: string }>; relaxationLevers: Array<{ change: string; likelyEffect: string; tradeoff: string }>; evidenceCaveat: string; observedProspects: number };

export type ProspectSource = { title: string; url: string };
export type SourcedProspect = {
  fullName: string;
  preliminaryScore: number;
  sourcingFit: 'QUALIFIED' | 'POSSIBLE';
  headline: string;
  location: ProspectLocation;
  geographicFit: 'WITHIN_SCOPE' | 'OUTSIDE_SCOPE' | 'UNABLE_TO_DETERMINE';
  publicEvidence: string;
  gateFindings: GateFinding[];
  criterionSignals: Array<{ criterionId: string; score: CriterionScore; evidence: string }>;
  sources: ProspectSource[];
};
export type ProspectSearchResult = {
  booleanQuery: string;
  strategyRationale: string;
  marketAnalysis: MarketAnalysis;
  prospects: SourcedProspect[];
  modelIdentifier: string;
};
type ProspectSearchResponse = Omit<ProspectSearchResult, 'prospects' | 'modelIdentifier'> & {
  prospects: Array<Omit<SourcedProspect, 'preliminaryScore' | 'criterionSignals'> & { criterionScores: CriterionScore[] }>;
};
export type ProspectEvaluation = {
  summary: string;
  location: ProspectLocation;
  compensation: { estimatedMarketRange: string; targetAlignment: 'LIKELY' | 'STRETCH' | 'UNLIKELY' | 'UNKNOWN'; confidence: 'HIGH' | 'MODERATE' | 'LOW'; rationale: string };
  receptivity: { level: 'HIGH' | 'MODERATE' | 'LOW' | 'UNKNOWN'; confidence: 'HIGH' | 'MODERATE' | 'LOW'; signals: string[]; rationale: string };
  strongestEvidence: string[];
  gaps: string[];
  unknowns: string[];
  gateFindings: Array<GateFinding & { assessment: string }>;
  criterionFindings: CriterionFinding[];
  sources: ProspectSource[];
};

async function client() {
  const apiKey = process.env.AI_GATEWAY_API_KEY || await getVercelOidcToken();
  if (!apiKey) throw new Error('AI Gateway authentication is unavailable.');
  return new OpenAI({ apiKey, baseURL: 'https://ai-gateway.vercel.sh/v1' });
}

const sourceSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['title', 'url'],
  properties: { title: { type: 'string' as const }, url: { type: 'string' as const } }
};
const locationSchema = { type: 'object' as const, additionalProperties: false, required: ['label', 'confidence', 'evidence'], properties: { label: { type: 'string' as const }, confidence: { type: 'string' as const, enum: ['CONFIRMED', 'PROBABLE', 'UNKNOWN'] }, evidence: { type: 'string' as const } } };

function gateSchema(gates: SourcingGate[], includeAssessment = false) {
  return { type: 'array' as const, minItems: gates.length, maxItems: gates.length, items: { type: 'object' as const, additionalProperties: false, required: includeAssessment ? ['gateId', 'status', 'evidence', 'assessment'] : ['gateId', 'status', 'evidence'], properties: { gateId: { type: 'string' as const, enum: gates.map((gate) => gate.id) }, status: { type: 'string' as const, enum: ['MET', 'NOT_MET', 'UNABLE_TO_DETERMINE'] }, evidence: { type: 'string' as const }, ...(includeAssessment ? { assessment: { type: 'string' as const } } : {}) } } };
}

function criterionIdSchema(criteria: AppliedCriterion[]) {
  return { type: 'string' as const, enum: criteria.map((criterion) => criterion.id) };
}

function searchSchema(criteria: AppliedCriterion[], gates: SourcingGate[]) {
  return {
    type: 'object' as const,
    additionalProperties: false,
    required: ['booleanQuery', 'strategyRationale', 'marketAnalysis', 'prospects'],
    properties: {
      booleanQuery: { type: 'string' as const },
      strategyRationale: { type: 'string' as const },
      marketAnalysis: { type: 'object' as const, additionalProperties: false, required: ['scarcityLevel', 'confidence', 'summary', 'constraintDrivers', 'relaxationLevers', 'evidenceCaveat'], properties: {
        scarcityLevel: { type: 'string' as const, enum: ['BROAD', 'COMPETITIVE', 'SCARCE', 'UNICORN'] }, confidence: { type: 'string' as const, enum: ['HIGH', 'MODERATE', 'LOW'] }, summary: { type: 'string' as const },
        constraintDrivers: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: false, required: ['constraint', 'impact', 'explanation'], properties: { constraint: { type: 'string' as const }, impact: { type: 'string' as const, enum: ['HIGH', 'MODERATE', 'LOW'] }, explanation: { type: 'string' as const } } } },
        relaxationLevers: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: false, required: ['change', 'likelyEffect', 'tradeoff'], properties: { change: { type: 'string' as const }, likelyEffect: { type: 'string' as const }, tradeoff: { type: 'string' as const } } } }, evidenceCaveat: { type: 'string' as const }
      } },
      prospects: {
        type: 'array' as const,
        maxItems: MAX_PROSPECTS,
        items: {
          type: 'object' as const,
          additionalProperties: false,
          required: ['fullName', 'headline', 'location', 'geographicFit', 'publicEvidence', 'gateFindings', 'criterionScores', 'sources'],
          properties: {
            fullName: { type: 'string' as const },
            headline: { type: 'string' as const },
            location: locationSchema,
            geographicFit: { type: 'string' as const, enum: ['WITHIN_SCOPE', 'OUTSIDE_SCOPE', 'UNABLE_TO_DETERMINE'] },
            publicEvidence: { type: 'string' as const },
            gateFindings: gateSchema(gates),
            criterionScores: { type: 'array' as const, minItems: criteria.length, maxItems: criteria.length, items: { type: 'integer' as const, enum: [0, 25, 50, 75, 100] } },
            sources: { type: 'array' as const, minItems: 1, items: sourceSchema }
          }
        }
      }
    }
  };
}

function evaluationSchema(criteria: AppliedCriterion[], gates: SourcingGate[]) {
  return {
    type: 'object' as const,
    additionalProperties: false,
    required: ['summary', 'location', 'compensation', 'receptivity', 'strongestEvidence', 'gaps', 'unknowns', 'gateFindings', 'criterionFindings', 'sources'],
    properties: {
      summary: { type: 'string' as const },
      location: locationSchema,
      compensation: { type: 'object' as const, additionalProperties: false, required: ['estimatedMarketRange', 'targetAlignment', 'confidence', 'rationale'], properties: { estimatedMarketRange: { type: 'string' as const }, targetAlignment: { type: 'string' as const, enum: ['LIKELY', 'STRETCH', 'UNLIKELY', 'UNKNOWN'] }, confidence: { type: 'string' as const, enum: ['HIGH', 'MODERATE', 'LOW'] }, rationale: { type: 'string' as const } } },
      receptivity: { type: 'object' as const, additionalProperties: false, required: ['level', 'confidence', 'signals', 'rationale'], properties: { level: { type: 'string' as const, enum: ['HIGH', 'MODERATE', 'LOW', 'UNKNOWN'] }, confidence: { type: 'string' as const, enum: ['HIGH', 'MODERATE', 'LOW'] }, signals: { type: 'array' as const, items: { type: 'string' as const } }, rationale: { type: 'string' as const } } },
      strongestEvidence: { type: 'array' as const, items: { type: 'string' as const } },
      gaps: { type: 'array' as const, items: { type: 'string' as const } },
      unknowns: { type: 'array' as const, items: { type: 'string' as const } },
      gateFindings: gateSchema(gates, true),
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

function exactCoverage(expected: string[], actual: string[]): boolean { return actual.length === expected.length && new Set(actual).size === expected.length && actual.every((id) => expected.includes(id)); }

export async function searchForProspects(input: { title: string; jobDescription: string; criteria: AppliedCriterion[]; gates: SourcingGate[]; targetLocation: string; searchScope: SearchScope; targetCompensation: string }): Promise<ProspectSearchResult> {
  const response = await (await client()).responses.create({
    model: SOURCING_MODEL,
    instructions: `You are Stapphire's public-web talent sourcing researcher. Translate the non-negotiable sourcing gates and immutable weighted Hiring Criteria into a precise Boolean search strategy, then identify up to ${MAX_PROSPECTS} real people with identity-resolved public evidence.

Gates are occupational identity checks, not weighted preferences. Similar titles and transferable skills never prove the required professional domain. Exclude contradicted gates and known out-of-scope locations. Evaluate every gate. For each person, return criterionScores in the exact same order as WEIGHTED CRITERIA, using only 0, 25, 50, 75, or 100. Score probable professional alignment for sourcing: use direct public evidence plus reasonable role-based inference, while reserving 0 for contradiction or no credible related signal. Materially overlapping criteria must receive consistent scores when supported by the same experience. Do not emit criterion IDs or criterion evidence during sourcing; the paid evaluation performs that evidence audit. Missing public evidence is unknown rather than proof that a criterion is not met. Search public professional pages, employer and government bios, associations, conferences, portfolios, certifications, and publications. Never seek contact details, current salary, protected traits, or merge namesakes.

Classify the discoverable market as BROAD, COMPETITIVE, SCARCE, or UNICORN from the intersection of domain, seniority, requirements, geography, and gates. Distinguish genuine scarcity from weak public visibility. Missing evidence is unknown, not negative.`,
    input: `POSITION\n${input.title}\n\nTARGET LOCATION\n${input.targetLocation || 'Not specified'}\n\nSEARCH SCOPE\n${input.searchScope}\n\nTARGET COMPENSATION\n${input.targetCompensation || 'Not specified'}\n\nJOB DESCRIPTION\n${input.jobDescription}\n\nNON-NEGOTIABLE GATES\n${JSON.stringify(input.gates)}\n\nWEIGHTED CRITERIA\n${JSON.stringify(input.criteria)}`,
    tools: [{ type: 'web_search' }],
    include: ['web_search_call.action.sources'],
    max_output_tokens: 12000,
    store: false,
    text: { format: { type: 'json_schema', name: 'prospect_search_results', strict: true, schema: searchSchema(input.criteria, input.gates) } }
  });
  if (response.status !== 'completed' || !response.output_text) {
    console.error('Public-web prospect search incomplete', { status: response.status, incompleteDetails: response.incomplete_details });
    throw new Error('Public-web prospect search did not complete.');
  }
  const result = parseJson<ProspectSearchResponse>(response.output_text, 'prospect search result');
  const gateIds = input.gates.map((gate) => gate.id);
  const prospects = result.prospects.flatMap((prospect) => {
    if (!exactCoverage(gateIds, prospect.gateFindings.map((item) => item.gateId))) return [];
    if (prospect.criterionScores.length !== input.criteria.length) return [];
    const sources = verifiedWebSources(response, prospect.sources);
    if (!prospect.fullName.trim() || !prospect.publicEvidence.trim() || !sources.length || prospect.geographicFit === 'OUTSIDE_SCOPE' || prospect.gateFindings.some((item) => item.status === 'NOT_MET')) return [];
    const criterionSignals = input.criteria.map((criterion, index) => ({ criterionId: criterion.id, score: prospect.criterionScores[index], evidence: '' }));
    const evidenceWeightedScore = Math.round(input.criteria.reduce((sum, criterion, index) => sum + prospect.criterionScores[index] * criterion.appliedWeight, 0) / 100);
    const preliminaryScore = Math.min(100, evidenceWeightedScore + SOURCING_FIT_UPLIFT);
    const sourcingFit = prospect.gateFindings.some((item) => item.status === 'UNABLE_TO_DETERMINE') ? 'POSSIBLE' as const : 'QUALIFIED' as const;
    const { criterionScores: _criterionScores, ...identity } = prospect;
    return [{ ...identity, sources, preliminaryScore, criterionSignals, sourcingFit, geographicFit: prospect.geographicFit as 'WITHIN_SCOPE' | 'UNABLE_TO_DETERMINE' }];
  }).sort((a, b) => a.sourcingFit === b.sourcingFit ? b.preliminaryScore - a.preliminaryScore : a.sourcingFit === 'QUALIFIED' ? -1 : 1)
    .slice(0, MAX_PROSPECTS);
  return { ...result, prospects, marketAnalysis: { ...result.marketAnalysis, observedProspects: prospects.length }, modelIdentifier: response.model };
}

export async function evaluateProspect(input: { title: string; jobDescription: string; criteria: AppliedCriterion[]; gates: SourcingGate[]; targetLocation: string; searchScope: SearchScope; targetCompensation: string; prospect: SourcedProspect }): Promise<{ evaluation: ProspectEvaluation; score: number; sourcingFit: 'QUALIFIED' | 'POSSIBLE' | 'EXCLUDED'; modelIdentifier: string }> {
  const response = await (await client()).responses.create({
    model: SOURCING_MODEL,
    instructions: `Research the named person using public professional sources. Resolve identity carefully and never merge namesakes. Evaluate every non-negotiable gate and weighted criterion exactly once.

Similar titles and transferable skills do not satisfy an occupational gate. Missing evidence is UNABLE_TO_DETERMINE; NOT_MET requires contradiction. Estimate a broad market compensation range, never present salary. Treat receptivity as an outreach hypothesis from observable signals. Compensation and receptivity never affect qualification scoring. Never seek contact details or protected traits.`,
    input: `POSITION\n${input.title}\n\nTARGET LOCATION\n${input.targetLocation || 'Not specified'}\n\nSEARCH SCOPE\n${input.searchScope}\n\nTARGET COMPENSATION\n${input.targetCompensation || 'Not specified'}\n\nJOB DESCRIPTION\n${input.jobDescription}\n\nGATES\n${JSON.stringify(input.gates)}\n\nCRITERIA\n${JSON.stringify(input.criteria)}\n\nPROSPECT\n${JSON.stringify(input.prospect)}`,
    tools: [{ type: 'web_search' }],
    include: ['web_search_call.action.sources'],
    max_output_tokens: 14000,
    store: false,
    text: { format: { type: 'json_schema', name: 'prospect_evaluation', strict: true, schema: evaluationSchema(input.criteria, input.gates) } }
  });
  if (response.status !== 'completed' || !response.output_text) throw new Error('Public-web prospect evaluation did not complete.');
  const evaluation = parseJson<ProspectEvaluation>(response.output_text, 'prospect evaluation');
  if (!exactCoverage(input.gates.map((gate) => gate.id), evaluation.gateFindings.map((item) => item.gateId))) throw new Error('Sourcing-gate coverage was incomplete.');
  validateNeutralCriterionFindings(input.criteria, evaluation.criterionFindings as Array<CriterionFinding & { alignmentScore: CriterionScore; satisfactionStatus: KnockoutStatus }>);
  evaluation.sources = verifiedWebSources(response, evaluation.sources);
  if (evaluation.sources.length === 0) throw new Error('The evaluation did not contain verifiable public sources.');
  const projection = projectCriterionFindings(input.criteria, evaluation.criterionFindings);
  if (!projection.complete || projection.overallMatch === null) throw new Error('The evaluation did not cover every applied criterion.');
  const sourcingFit = evaluation.gateFindings.some((item) => item.status === 'NOT_MET') ? 'EXCLUDED' : evaluation.gateFindings.some((item) => item.status === 'UNABLE_TO_DETERMINE') ? 'POSSIBLE' : 'QUALIFIED';
  return { evaluation, score: projection.overallMatch, sourcingFit, modelIdentifier: response.model };
}
