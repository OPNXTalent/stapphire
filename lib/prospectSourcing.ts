import OpenAI from 'openai';
import { getVercelOidcToken } from '@vercel/oidc';
import { validateNeutralCriterionFindings, type AppliedCriterion, type CriterionScore, type KnockoutStatus } from './criteriaEvaluation';
import { projectCriterionFindings, type CriterionFinding } from './criterionProjection';

export const SOURCING_MODEL = process.env.AI_GATEWAY_MODEL || 'openai/gpt-5.4';
const MAX_PROSPECTS = 8;
const SOURCING_FIT_UPLIFT = 4;
const MIN_SHORTLIST_SCORE = 70;
const MIN_DIRECT_EVIDENCE_WEIGHT = 40;
export const PROSPECT_SCREENING_VERSION = 'evidence_v2';

export const SEARCH_SCOPES = ['25_MILES', '50_MILES', '100_MILES', '500_MILES', 'NATIONAL', 'GLOBAL'] as const;
export type SearchScope = typeof SEARCH_SCOPES[number];
export type SourcingGate = { id: string; label: string };
export type ProspectLocation = { label: string; confidence: 'CONFIRMED' | 'PROBABLE' | 'UNKNOWN'; evidence: string };
export type GateFinding = { gateId: string; status: KnockoutStatus; evidence: string; assessment?: string };
export type CriterionSignal = { criterionId: string; score: CriterionScore; evidence: string; evidenceStrength: 'DIRECT' | 'INFERRED' | 'UNKNOWN' };
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
  criterionSignals: CriterionSignal[];
  sources: ProspectSource[];
};
export type ProspectSearchResult = {
  booleanQuery: string;
  strategyRationale: string;
  marketAnalysis: MarketAnalysis;
  prospects: SourcedProspect[];
  modelIdentifier: string;
};
export type ProspectSearchTrack = { id: string; label: string; query: string; rationale: string };
export type ProspectSearchPlan = {
  booleanQuery: string;
  strategyRationale: string;
  tracks: ProspectSearchTrack[];
  marketAnalysis: Omit<MarketAnalysis, 'observedProspects'>;
  modelIdentifier: string;
};
export type DiscoveredProspect = {
  identityKey: string;
  fullName: string;
  headline: string;
  locationLabel: string;
  discoveryEvidence: string;
  sources: ProspectSource[];
};
export type ProspectScreenOutcome = {
  identityKey: string;
  prospect: SourcedProspect | null;
  rejectionReason: string | null;
};
type ProspectSearchResponse = Omit<ProspectSearchResult, 'prospects' | 'modelIdentifier'> & {
  prospects: Array<Omit<SourcedProspect, 'preliminaryScore' | 'sourcingFit'>>;
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
  return { type: 'array' as const, minItems: gates.length, maxItems: gates.length, items: { type: 'object' as const, additionalProperties: false, required: includeAssessment ? ['gateId', 'status', 'evidence', 'assessment'] : ['gateId', 'status', 'evidence'], properties: { gateId: gates.length ? { type: 'string' as const, enum: gates.map((gate) => gate.id) } : { type: 'string' as const }, status: { type: 'string' as const, enum: ['MET', 'NOT_MET', 'UNABLE_TO_DETERMINE'] }, evidence: { type: 'string' as const }, ...(includeAssessment ? { assessment: { type: 'string' as const } } : {}) } } };
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
          required: ['fullName', 'headline', 'location', 'geographicFit', 'publicEvidence', 'gateFindings', 'criterionSignals', 'sources'],
          properties: {
            fullName: { type: 'string' as const },
            headline: { type: 'string' as const },
            location: locationSchema,
            geographicFit: { type: 'string' as const, enum: ['WITHIN_SCOPE', 'OUTSIDE_SCOPE', 'UNABLE_TO_DETERMINE'] },
            publicEvidence: { type: 'string' as const },
            gateFindings: gateSchema(gates),
            criterionSignals: { type: 'array' as const, minItems: criteria.length, maxItems: criteria.length, items: { type: 'object' as const, additionalProperties: false, required: ['criterionId', 'score', 'evidence', 'evidenceStrength'], properties: {
              criterionId: criterionIdSchema(criteria),
              score: { type: 'integer' as const, enum: [0, 25, 50, 75, 100] },
              evidence: { type: 'string' as const },
              evidenceStrength: { type: 'string' as const, enum: ['DIRECT', 'INFERRED', 'UNKNOWN'] }
            } } },
            sources: { type: 'array' as const, minItems: 2, items: sourceSchema }
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

const marketAnalysisSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['scarcityLevel', 'confidence', 'summary', 'constraintDrivers', 'relaxationLevers', 'evidenceCaveat'],
  properties: {
    scarcityLevel: { type: 'string' as const, enum: ['BROAD', 'COMPETITIVE', 'SCARCE', 'UNICORN'] },
    confidence: { type: 'string' as const, enum: ['HIGH', 'MODERATE', 'LOW'] },
    summary: { type: 'string' as const },
    constraintDrivers: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: false, required: ['constraint', 'impact', 'explanation'], properties: { constraint: { type: 'string' as const }, impact: { type: 'string' as const, enum: ['HIGH', 'MODERATE', 'LOW'] }, explanation: { type: 'string' as const } } } },
    relaxationLevers: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: false, required: ['change', 'likelyEffect', 'tradeoff'], properties: { change: { type: 'string' as const }, likelyEffect: { type: 'string' as const }, tradeoff: { type: 'string' as const } } } },
    evidenceCaveat: { type: 'string' as const }
  }
};

function sourcingInput(input: { title: string; jobDescription: string; criteria: AppliedCriterion[]; gates: SourcingGate[]; targetLocation: string; searchScope: SearchScope; targetCompensation: string }) {
  return `POSITION\n${input.title}\n\nTARGET LOCATION\n${input.targetLocation || 'Not specified'}\n\nSEARCH SCOPE\n${input.searchScope}\n\nTARGET COMPENSATION\n${input.targetCompensation || 'Not specified'}\n\nJOB DESCRIPTION\n${input.jobDescription}\n\nNON-NEGOTIABLES\n${JSON.stringify(input.gates)}\n\nWEIGHTED CRITERIA\n${JSON.stringify(input.criteria)}`;
}

export async function planProspectSearch(input: { title: string; jobDescription: string; criteria: AppliedCriterion[]; gates: SourcingGate[]; targetLocation: string; searchScope: SearchScope; targetCompensation: string }): Promise<ProspectSearchPlan> {
  const response = await (await client()).responses.create({
    model: SOURCING_MODEL,
    instructions: `Design a broad but disciplined public-web sourcing plan. Create 5 materially different discovery tracks: exact occupational titles, adjacent credible titles, employer/industry targets, associations/conferences, and credential/publication evidence. Queries must preserve the occupational domain and geography but should not require every weighted criterion in the discovery query. Discovery is recall-oriented; a later evidence screen will determine qualification. Do not seek contact data or protected traits. Estimate market scarcity provisionally and be explicit that final confidence depends on the observed funnel.`,
    input: sourcingInput(input),
    max_output_tokens: 5000,
    store: false,
    text: { format: { type: 'json_schema', name: 'prospect_search_plan', strict: true, schema: {
      type: 'object', additionalProperties: false,
      required: ['booleanQuery', 'strategyRationale', 'tracks', 'marketAnalysis'],
      properties: {
        booleanQuery: { type: 'string' }, strategyRationale: { type: 'string' },
        tracks: { type: 'array', minItems: 5, maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['id', 'label', 'query', 'rationale'], properties: { id: { type: 'string' }, label: { type: 'string' }, query: { type: 'string' }, rationale: { type: 'string' } } } },
        marketAnalysis: marketAnalysisSchema
      }
    } } }
  });
  if (response.status !== 'completed' || !response.output_text) throw new Error('Prospect search planning did not complete.');
  const result = parseJson<Omit<ProspectSearchPlan, 'modelIdentifier'>>(response.output_text, 'prospect search plan');
  return { ...result, tracks: result.tracks.map((track, index) => ({ ...track, id: track.id.trim() || `track-${index + 1}` })), modelIdentifier: response.model };
}

export async function discoverProspects(input: { title: string; targetLocation: string; searchScope: SearchScope; track: ProspectSearchTrack }): Promise<{ prospects: DiscoveredProspect[]; modelIdentifier: string }> {
  const response = await (await client()).responses.create({
    model: SOURCING_MODEL,
    instructions: `Find up to 8 real, named professionals for this sourcing track. This pass is intentionally recall-oriented: require credible occupational relevance, but do not attempt the final weighted evaluation. Resolve identities carefully, avoid namesakes, and cite public professional pages actually found with web search. Prefer a LinkedIn public profile, employer bio, association bio, conference page, portfolio, certification, or publication. Never seek contact data or protected traits. Return fewer people if identity cannot be resolved.`,
    input: `POSITION\n${input.title}\n\nTARGET LOCATION\n${input.targetLocation || 'Not specified'}\n\nSEARCH SCOPE\n${input.searchScope}\n\nDISCOVERY TRACK\n${JSON.stringify(input.track)}`,
    tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'], max_output_tokens: 6500, store: false,
    text: { format: { type: 'json_schema', name: 'prospect_discovery', strict: true, schema: { type: 'object', additionalProperties: false, required: ['prospects'], properties: { prospects: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['fullName', 'headline', 'locationLabel', 'discoveryEvidence', 'sources'], properties: { fullName: { type: 'string' }, headline: { type: 'string' }, locationLabel: { type: 'string' }, discoveryEvidence: { type: 'string' }, sources: { type: 'array', minItems: 1, items: sourceSchema } } } } } } } }
  });
  if (response.status !== 'completed' || !response.output_text) throw new Error('Prospect discovery did not complete.');
  const parsed = parseJson<{ prospects: Array<Omit<DiscoveredProspect, 'identityKey'>> }>(response.output_text, 'prospect discovery');
  const prospects = parsed.prospects.flatMap((prospect) => {
    const sources = verifiedWebSources(response, prospect.sources);
    if (!prospect.fullName.trim() || !prospect.discoveryEvidence.trim() || sources.length === 0) return [];
    const profile = sources.find((source) => /linkedin\.com\/in\//i.test(source.url));
    const identityKey = canonicalUrl(profile?.url || '') || `${prospect.fullName.trim().toLowerCase()}|${prospect.locationLabel.trim().toLowerCase()}`;
    return [{ ...prospect, fullName: prospect.fullName.trim(), sources, identityKey }];
  });
  return { prospects, modelIdentifier: response.model };
}

export async function screenDiscoveredProspects(input: { title: string; jobDescription: string; criteria: AppliedCriterion[]; gates: SourcingGate[]; targetLocation: string; searchScope: SearchScope; targetCompensation: string; candidates: DiscoveredProspect[] }): Promise<{ outcomes: ProspectScreenOutcome[]; modelIdentifier: string }> {
  if (!input.candidates.length) return { outcomes: [], modelIdentifier: SOURCING_MODEL };
  const candidateKeys = input.candidates.map((candidate) => candidate.identityKey);
  const response = await (await client()).responses.create({
    model: SOURCING_MODEL,
    instructions: `Independently research and screen every supplied identity against the position. Return exactly one result per identityKey. This is a qualification screen, not lead generation. Similar titles and transferable skills do not prove occupational fit. Every explicit non-negotiable and geography must be MET. DIRECT evidence explicitly demonstrates the work; INFERRED may never score above 50; UNKNOWN scores 0. Use 100 only for unusually strong direct evidence, 75 for clear direct evidence, 50 for partial or inferred alignment, 25 for weak adjacent evidence, and 0 when credible evidence is absent. Find at least two independent public professional sources. Never merge namesakes or seek contact details, salary, or protected traits.`,
    input: `${sourcingInput(input)}\n\nDISCOVERED IDENTITIES\n${JSON.stringify(input.candidates)}`,
    tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'], max_output_tokens: 10000, store: false,
    text: { format: { type: 'json_schema', name: 'prospect_screen_batch', strict: true, schema: { type: 'object', additionalProperties: false, required: ['prospects'], properties: { prospects: { type: 'array', minItems: input.candidates.length, maxItems: input.candidates.length, items: { type: 'object', additionalProperties: false, required: ['identityKey', 'fullName', 'headline', 'location', 'geographicFit', 'publicEvidence', 'gateFindings', 'criterionSignals', 'sources'], properties: { identityKey: { type: 'string', enum: candidateKeys }, fullName: { type: 'string' }, headline: { type: 'string' }, location: locationSchema, geographicFit: { type: 'string', enum: ['WITHIN_SCOPE', 'OUTSIDE_SCOPE', 'UNABLE_TO_DETERMINE'] }, publicEvidence: { type: 'string' }, gateFindings: gateSchema(input.gates), criterionSignals: { type: 'array', minItems: input.criteria.length, maxItems: input.criteria.length, items: { type: 'object', additionalProperties: false, required: ['criterionId', 'score', 'evidence', 'evidenceStrength'], properties: { criterionId: criterionIdSchema(input.criteria), score: { type: 'integer', enum: [0, 25, 50, 75, 100] }, evidence: { type: 'string' }, evidenceStrength: { type: 'string', enum: ['DIRECT', 'INFERRED', 'UNKNOWN'] } } } }, sources: { type: 'array', minItems: 2, items: sourceSchema } } } } } } } }
  });
  if (response.status !== 'completed' || !response.output_text) throw new Error('Prospect screening did not complete.');
  const parsed = parseJson<{ prospects: Array<{ identityKey: string } & Omit<SourcedProspect, 'preliminaryScore' | 'sourcingFit'>> }>(response.output_text, 'prospect screen');
  const returned = new Map(parsed.prospects.map((prospect) => [prospect.identityKey, prospect]));
  const outcomes = input.candidates.map((candidate): ProspectScreenOutcome => {
    const prospect = returned.get(candidate.identityKey);
    if (!prospect) return { identityKey: candidate.identityKey, prospect: null, rejectionReason: 'The evidence screen returned no resolved identity.' };
    const sources = verifiedWebSources(response, prospect.sources);
    const byCriterion = new Map(prospect.criterionSignals.map((signal) => [signal.criterionId, signal]));
    const criterionSignals = input.criteria.map((criterion) => {
      const signal = byCriterion.get(criterion.id) || { criterionId: criterion.id, score: 0 as CriterionScore, evidence: 'No public evidence was returned.', evidenceStrength: 'UNKNOWN' as const };
      const score = signal.evidenceStrength === 'UNKNOWN' ? 0 : signal.evidenceStrength === 'INFERRED' ? Math.min(signal.score, 50) as CriterionScore : signal.score;
      return { ...signal, score };
    });
    const evidenceWeightedScore = Math.round(input.criteria.reduce((sum, criterion, index) => sum + criterionSignals[index].score * criterion.appliedWeight, 0) / 100);
    const preliminaryScore = Math.min(100, evidenceWeightedScore + SOURCING_FIT_UPLIFT);
    const directEvidenceWeight = input.criteria.reduce((sum, criterion, index) => sum + (!criterion.isKnockout && criterionSignals[index].evidenceStrength === 'DIRECT' && criterionSignals[index].score >= 75 ? criterion.appliedWeight : 0), 0);
    const sourcingFit = preliminaryScore >= 80 && directEvidenceWeight >= 60 ? 'QUALIFIED' as const : 'POSSIBLE' as const;
    const screenedProspect: SourcedProspect = { ...prospect, sources, preliminaryScore, criterionSignals, sourcingFit };
    if (!exactCoverage(input.gates.map((gate) => gate.id), prospect.gateFindings.map((item) => item.gateId))) return { identityKey: candidate.identityKey, prospect: screenedProspect, rejectionReason: 'Non-negotiable evidence was incomplete.' };
    if (!exactCoverage(input.criteria.map((criterion) => criterion.id), prospect.criterionSignals.map((item) => item.criterionId))) return { identityKey: candidate.identityKey, prospect: screenedProspect, rejectionReason: 'Weighted-criteria evidence was incomplete.' };
    if (sources.length < 2) return { identityKey: candidate.identityKey, prospect: screenedProspect, rejectionReason: 'Fewer than two independent public sources were verified.' };
    if (prospect.geographicFit !== 'WITHIN_SCOPE') return { identityKey: candidate.identityKey, prospect: screenedProspect, rejectionReason: 'Location was outside or could not be confirmed within the search scope.' };
    if (prospect.gateFindings.some((item) => item.status !== 'MET')) return { identityKey: candidate.identityKey, prospect: screenedProspect, rejectionReason: 'A non-negotiable was not positively established.' };
    if (preliminaryScore < MIN_SHORTLIST_SCORE) return { identityKey: candidate.identityKey, prospect: screenedProspect, rejectionReason: `Evidence fit ${preliminaryScore}% was below the 70% shortlist threshold.` };
    if (directEvidenceWeight < MIN_DIRECT_EVIDENCE_WEIGHT) return { identityKey: candidate.identityKey, prospect: screenedProspect, rejectionReason: 'Too much of the apparent fit depended on inference rather than direct evidence.' };
    return { identityKey: candidate.identityKey, prospect: { ...screenedProspect, geographicFit: 'WITHIN_SCOPE' }, rejectionReason: null };
  });
  return { outcomes, modelIdentifier: response.model };
}

export async function searchForProspects(input: { title: string; jobDescription: string; criteria: AppliedCriterion[]; gates: SourcingGate[]; targetLocation: string; searchScope: SearchScope; targetCompensation: string }): Promise<ProspectSearchResult> {
  const response = await (await client()).responses.create({
    model: SOURCING_MODEL,
    instructions: `You are Stapphire's public-web talent sourcing researcher. Translate the non-negotiables and immutable weighted Hiring Criteria into a precise Boolean search strategy, then identify up to ${MAX_PROSPECTS} real people with identity-resolved public evidence. This is a qualification screen, not a lead-generation exercise. Return fewer people—or none—rather than adjacent candidates.

Non-negotiables are admission checks, not weighted preferences. Every non-negotiable and the stated geography must be positively established before returning a person. Similar titles, transferable skills, broad HR leadership, or proximity to the occupation never prove the required professional domain. Evaluate every weighted criterion with a criterionSignal. DIRECT means a public source explicitly demonstrates the work; INFERRED means only a reasonable role-based implication and may never score above 50; UNKNOWN must score 0. Use 100 only for unusually strong direct evidence, 75 for clear direct evidence, 50 for partial or inferred alignment, 25 for weak adjacent evidence, and 0 when credible evidence is absent. Keep the calibration consistent with a full candidate evaluation. Materially overlapping criteria must receive consistent scores when supported by the same experience. Find at least two independent public professional sources per person. Search employer and government bios, associations, conferences, portfolios, certifications, publications, and professional profiles. Never seek contact details, current salary, protected traits, or merge namesakes.

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
  const screenedProspects = result.prospects.flatMap((prospect) => {
    if (!exactCoverage(gateIds, prospect.gateFindings.map((item) => item.gateId))) return [];
    if (!exactCoverage(input.criteria.map((criterion) => criterion.id), prospect.criterionSignals.map((item) => item.criterionId))) return [];
    const sources = verifiedWebSources(response, prospect.sources);
    if (!prospect.fullName.trim() || !prospect.publicEvidence.trim() || sources.length < 2 || prospect.geographicFit !== 'WITHIN_SCOPE' || prospect.gateFindings.some((item) => item.status !== 'MET')) return [];
    const byCriterion = new Map(prospect.criterionSignals.map((signal) => [signal.criterionId, signal]));
    const criterionSignals = input.criteria.map((criterion) => {
      const signal = byCriterion.get(criterion.id)!;
      const score = signal.evidenceStrength === 'UNKNOWN' ? 0 : signal.evidenceStrength === 'INFERRED' ? Math.min(signal.score, 50) as CriterionScore : signal.score;
      return { ...signal, score };
    });
    if (criterionSignals.some((signal) => !signal.evidence.trim())) return [];
    const evidenceWeightedScore = Math.round(input.criteria.reduce((sum, criterion, index) => sum + criterionSignals[index].score * criterion.appliedWeight, 0) / 100);
    const preliminaryScore = Math.min(100, evidenceWeightedScore + SOURCING_FIT_UPLIFT);
    const directEvidenceWeight = input.criteria.reduce((sum, criterion, index) => sum + (!criterion.isKnockout && criterionSignals[index].evidenceStrength === 'DIRECT' && criterionSignals[index].score >= 75 ? criterion.appliedWeight : 0), 0);
    if (preliminaryScore < MIN_SHORTLIST_SCORE || directEvidenceWeight < MIN_DIRECT_EVIDENCE_WEIGHT) return [];
    const sourcingFit = preliminaryScore >= 80 && directEvidenceWeight >= 60 ? 'QUALIFIED' as const : 'POSSIBLE' as const;
    return [{ ...prospect, sources, preliminaryScore, criterionSignals, sourcingFit, geographicFit: 'WITHIN_SCOPE' as const }];
  });
  const deduplicated = new Map<string, SourcedProspect>();
  for (const prospect of screenedProspects) {
    const profile = prospect.sources.find((source) => /linkedin\.com\/in\//i.test(source.url));
    const key = canonicalUrl(profile?.url || '') || `${prospect.fullName.trim().toLowerCase()}|${prospect.location.label.trim().toLowerCase()}`;
    const existing = deduplicated.get(key);
    if (!existing || prospect.preliminaryScore > existing.preliminaryScore) deduplicated.set(key, prospect);
  }
  const prospects = [...deduplicated.values()].sort((a, b) => a.sourcingFit === b.sourcingFit ? b.preliminaryScore - a.preliminaryScore : a.sourcingFit === 'QUALIFIED' ? -1 : 1).slice(0, MAX_PROSPECTS);
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
  const initialSources = cleanSources(input.prospect.sources);
  const newlyVerifiedSources = verifiedWebSources(response, evaluation.sources);
  evaluation.sources = cleanSources([...initialSources, ...newlyVerifiedSources]);
  if (evaluation.sources.length === 0) throw new Error('The evaluation did not contain verifiable public sources.');
  const projection = projectCriterionFindings(input.criteria, evaluation.criterionFindings);
  if (!projection.complete || projection.overallMatch === null) throw new Error('The evaluation did not cover every applied criterion.');
  const sourcingFit = evaluation.gateFindings.some((item) => item.status === 'NOT_MET') ? 'EXCLUDED' : evaluation.gateFindings.some((item) => item.status === 'UNABLE_TO_DETERMINE') ? 'POSSIBLE' : 'QUALIFIED';
  return { evaluation, score: projection.overallMatch, sourcingFit, modelIdentifier: response.model };
}
