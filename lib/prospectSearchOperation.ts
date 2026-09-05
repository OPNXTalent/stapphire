import 'server-only';
import { randomUUID } from 'crypto';
import type { AppliedCriterion } from './criteriaEvaluation';
import { resolveEvaluationBasisById } from './evaluationBasis';
import { operationQueue } from './operationQueue';
import {
  discoverProspects,
  planProspectSearch,
  screenDiscoveredProspects,
  type DiscoveredProspect,
  type MarketAnalysis,
  type ProspectSearchTrack,
  type SearchScope,
  type SourcingGate
} from './prospectSourcing';
import { supabaseAdmin } from './supabaseAdmin';
import { observedScarcityLevel } from './prospectMarketRead';

const TARGET_SHORTLIST = 8;
const SCREEN_BATCH_SIZE = 2;

type PipelineProgress = {
  totalTracks: number;
  completedTracks: number;
  discovered: number;
  reviewed: number;
  qualified: number;
  rejected: number;
  target: number;
  coverageConfidence: 'LOW' | 'MODERATE' | 'HIGH';
};

type SearchStrategy = {
  rationale?: string;
  tracks?: ProspectSearchTrack[];
  marketAnalysis?: Omit<MarketAnalysis, 'observedProspects'> & { observedProspects?: number };
  config: {
    targetLocation: string;
    targetCompensation: string;
    searchScope: SearchScope;
    gates: SourcingGate[];
    screeningVersion: string;
  };
};

type SearchRow = {
  id: string;
  requisition_id: string;
  evaluation_basis_id: string;
  status: string;
  stage: string;
  search_strategy: SearchStrategy;
};

function initialProgress(): PipelineProgress {
  return { totalTracks: 0, completedTracks: 0, discovered: 0, reviewed: 0, qualified: 0, rejected: 0, target: TARGET_SHORTLIST, coverageConfidence: 'LOW' };
}

async function counts(searchId: string, completedTracks: number, totalTracks: number): Promise<PipelineProgress> {
  const results = await Promise.all([
    supabaseAdmin.from('phase1_prospect_discoveries').select('*', { count: 'exact', head: true }).eq('search_id', searchId),
    supabaseAdmin.from('phase1_prospect_discoveries').select('*', { count: 'exact', head: true }).eq('search_id', searchId).in('status', ['qualified', 'rejected']),
    supabaseAdmin.from('phase1_prospect_discoveries').select('*', { count: 'exact', head: true }).eq('search_id', searchId).eq('status', 'qualified'),
    supabaseAdmin.from('phase1_prospect_discoveries').select('*', { count: 'exact', head: true }).eq('search_id', searchId).eq('status', 'rejected')
  ]);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  const [{ count: discovered }, { count: reviewed }, { count: qualified }, { count: rejected }] = results;
  const reviewedCount = reviewed || 0;
  const allTracksComplete = totalTracks > 0 && completedTracks >= totalTracks;
  const coverageConfidence = allTracksComplete && reviewedCount >= 16 ? 'HIGH' : reviewedCount >= 8 || completedTracks >= 3 ? 'MODERATE' : 'LOW';
  return { totalTracks, completedTracks, discovered: discovered || 0, reviewed: reviewedCount, qualified: qualified || 0, rejected: rejected || 0, target: TARGET_SHORTLIST, coverageConfidence };
}

async function updateSearch(searchId: string, leaseToken: string, values: Record<string, unknown>, resetAttempts = true) {
  const { error } = await supabaseAdmin.from('phase1_prospect_searches').update({ ...values, ...(resetAttempts ? { attempt_count: 0 } : {}), updated_at: new Date().toISOString() }).eq('id', searchId).eq('lease_token', leaseToken);
  if (error) throw error;
}

async function finishSearch(search: SearchRow, leaseToken: string, progress: PipelineProgress) {
  const strategy = search.search_strategy;
  const existingMarket = strategy.marketAnalysis;
  const observedScarcity = observedScarcityLevel(progress, existingMarket?.scarcityLevel || 'COMPETITIVE', true);
  const marketAnalysis = existingMarket ? {
    ...existingMarket,
    scarcityLevel: observedScarcity,
    observedProspects: progress.qualified,
    confidence: progress.coverageConfidence,
    summary: `${existingMarket.summary} The completed sourcing funnel reads as ${observedScarcity.toLowerCase()}: ${progress.qualified} of ${progress.reviewed} reviewed identities cleared the evidence threshold.`,
    evidenceCaveat: `${existingMarket.evidenceCaveat} Funnel evidence: ${progress.discovered} identities discovered across ${progress.completedTracks} search tracks; ${progress.reviewed} reviewed and ${progress.qualified} cleared the evidence threshold.`
  } : undefined;
  await updateSearch(search.id, leaseToken, {
    status: 'completed', stage: 'completed', progress,
    search_strategy: { ...strategy, marketAnalysis },
    completed_at: new Date().toISOString(), lease_token: null, lease_expires_at: null
  });
}

async function release(searchId: string, leaseToken: string) {
  const { data, error } = await supabaseAdmin.rpc('release_phase1_prospect_search_v1', { p_search_id: searchId, p_lease_token: leaseToken });
  if (error) throw error;
  if (data !== true) throw new Error('Prospect search lease was lost.');
}

async function advance(searchId: string, leaseToken: string) {
  await release(searchId, leaseToken);
  await operationQueue.enqueueProspectSearch({ searchId });
}

async function plan(search: SearchRow, leaseToken: string, title: string, jobDescription: string, criteria: AppliedCriterion[]) {
  const config = search.search_strategy.config;
  const result = await planProspectSearch({ title, jobDescription, criteria, gates: config.gates, targetLocation: config.targetLocation, targetCompensation: config.targetCompensation, searchScope: config.searchScope });
  const progress = { ...initialProgress(), totalTracks: result.tracks.length };
  await updateSearch(search.id, leaseToken, {
    stage: 'discovering', boolean_query: result.booleanQuery, model_identifier: result.modelIdentifier, progress,
    search_strategy: { ...search.search_strategy, rationale: result.strategyRationale, tracks: result.tracks, marketAnalysis: result.marketAnalysis }
  });
  await advance(search.id, leaseToken);
}

async function discover(search: SearchRow, leaseToken: string, title: string) {
  const strategy = search.search_strategy;
  const tracks = strategy.tracks || [];
  const progressRow = await supabaseAdmin.from('phase1_prospect_searches').select('progress').eq('id', search.id).single();
  if (progressRow.error) throw progressRow.error;
  const completedTracks = Number(progressRow.data.progress?.completedTracks || 0);
  const progress = await counts(search.id, completedTracks, tracks.length);
  if (progress.qualified >= TARGET_SHORTLIST || completedTracks >= tracks.length) {
    const { count: pending, error } = await supabaseAdmin.from('phase1_prospect_discoveries').select('*', { count: 'exact', head: true }).eq('search_id', search.id).eq('status', 'discovered');
    if (error) throw error;
    if ((pending || 0) > 0) {
      await updateSearch(search.id, leaseToken, { stage: 'screening', progress });
      await advance(search.id, leaseToken);
    } else {
      await finishSearch(search, leaseToken, progress);
    }
    return;
  }
  const track = tracks[completedTracks];
  const result = await discoverProspects({ title, targetLocation: strategy.config.targetLocation, searchScope: strategy.config.searchScope, track });
  if (result.prospects.length) {
    const { error } = await supabaseAdmin.from('phase1_prospect_discoveries').upsert(result.prospects.map((prospect) => ({
      search_id: search.id, requisition_id: search.requisition_id, identity_key: prospect.identityKey, full_name: prospect.fullName,
      discovery_track: track.id, discovery_data: prospect
    })), { onConflict: 'search_id,identity_key', ignoreDuplicates: true });
    if (error) throw error;
  }
  const nextProgress = await counts(search.id, completedTracks + 1, tracks.length);
  await updateSearch(search.id, leaseToken, { stage: 'screening', progress: nextProgress, model_identifier: result.modelIdentifier });
  await advance(search.id, leaseToken);
}

async function screen(search: SearchRow, leaseToken: string, title: string, jobDescription: string, criteria: AppliedCriterion[]) {
  const strategy = search.search_strategy;
  const tracks = strategy.tracks || [];
  const { data: rows, error } = await supabaseAdmin.from('phase1_prospect_discoveries')
    .select('id,identity_key,discovery_data').eq('search_id', search.id).eq('status', 'discovered').order('created_at').limit(SCREEN_BATCH_SIZE);
  if (error) throw error;
  const progressRow = await supabaseAdmin.from('phase1_prospect_searches').select('progress').eq('id', search.id).single();
  if (progressRow.error) throw progressRow.error;
  const completedTracks = Number(progressRow.data.progress?.completedTracks || 0);
  if (!rows?.length) {
    const progress = await counts(search.id, completedTracks, tracks.length);
    if (progress.qualified >= TARGET_SHORTLIST || completedTracks >= tracks.length) await finishSearch(search, leaseToken, progress);
    else {
      await updateSearch(search.id, leaseToken, { stage: 'discovering', progress });
      await advance(search.id, leaseToken);
    }
    return;
  }

  const ids = rows.map((row) => row.id);
  const { error: lockError } = await supabaseAdmin.from('phase1_prospect_discoveries').update({ status: 'screening', updated_at: new Date().toISOString() }).in('id', ids).eq('status', 'discovered');
  if (lockError) throw lockError;
  const candidates = rows.map((row) => row.discovery_data as DiscoveredProspect);
  const result = await screenDiscoveredProspects({ title, jobDescription, criteria, gates: strategy.config.gates, targetLocation: strategy.config.targetLocation, targetCompensation: strategy.config.targetCompensation, searchScope: strategy.config.searchScope, candidates });
  for (const outcome of result.outcomes) {
    const row = rows.find((candidate) => candidate.identity_key === outcome.identityKey);
    if (!row) continue;
    if (outcome.prospect) {
      const prospect = outcome.prospect;
      const { error: insertError } = await supabaseAdmin.from('phase1_prospects').upsert({
        search_id: search.id, requisition_id: search.requisition_id, evaluation_basis_id: search.evaluation_basis_id,
        full_name: prospect.fullName, preliminary_score: prospect.preliminaryScore, sourcing_fit: prospect.sourcingFit,
        headline: prospect.headline, location: prospect.location, geographic_fit: prospect.geographicFit,
        public_evidence: prospect.publicEvidence, gate_findings: prospect.gateFindings,
        criterion_signals: prospect.criterionSignals, sources: prospect.sources,
        screening_status: outcome.rejectionReason ? 'NOT_CLEARED' : 'CLEARED',
        screening_disposition: outcome.rejectionReason
      }, { onConflict: 'search_id,full_name', ignoreDuplicates: true });
      if (insertError) throw insertError;
    }
    const { error: reviewError } = await supabaseAdmin.from('phase1_prospect_discoveries').update({
      status: outcome.rejectionReason ? 'rejected' : 'qualified', rejection_reason: outcome.rejectionReason,
      screen_attempts: 1, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq('id', row.id);
    if (reviewError) throw reviewError;
  }
  const progress = await counts(search.id, completedTracks, tracks.length);
  const { count: pending, error: pendingError } = await supabaseAdmin.from('phase1_prospect_discoveries').select('*', { count: 'exact', head: true }).eq('search_id', search.id).eq('status', 'discovered');
  if (pendingError) throw pendingError;
  if (progress.qualified >= TARGET_SHORTLIST) await finishSearch(search, leaseToken, progress);
  else {
    await updateSearch(search.id, leaseToken, { stage: (pending || 0) > 0 ? 'screening' : 'discovering', progress, model_identifier: result.modelIdentifier });
    await advance(search.id, leaseToken);
  }
}

export async function processProspectSearch(searchId: string): Promise<void> {
  const leaseToken = randomUUID();
  const { data: claimed, error: claimError } = await supabaseAdmin.rpc('claim_phase1_prospect_search_v1', { p_search_id: searchId, p_lease_token: leaseToken, p_lease_seconds: 330 });
  if (claimError) throw claimError;
  if (claimed !== true) return;
  try {
    const { data, error } = await supabaseAdmin.from('phase1_prospect_searches').select('id,requisition_id,evaluation_basis_id,status,stage,search_strategy').eq('id', searchId).single();
    if (error) throw error;
    const search = data as SearchRow;
    const [basis, requisitionResult] = await Promise.all([
      resolveEvaluationBasisById(search.requisition_id, search.evaluation_basis_id),
      supabaseAdmin.from('phase1_requisitions').select('title').eq('id', search.requisition_id).single()
    ]);
    if (!basis || basis.basisType !== 'hiring_criteria') throw new Error('The search evaluation basis is unavailable.');
    if (requisitionResult.error) throw requisitionResult.error;
    if (search.stage === 'queued' || search.stage === 'planning') await plan(search, leaseToken, requisitionResult.data.title, basis.jobDescriptionSnapshot, basis.criteria);
    else if (search.stage === 'discovering') await discover(search, leaseToken, requisitionResult.data.title);
    else if (search.stage === 'screening') await screen(search, leaseToken, requisitionResult.data.title, basis.jobDescriptionSnapshot, basis.criteria);
    else await finishSearch(search, leaseToken, await counts(search.id, search.search_strategy.tracks?.length || 0, search.search_strategy.tracks?.length || 0));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown prospect search failure.';
    await supabaseAdmin.from('phase1_prospect_discoveries').update({ status: 'discovered', updated_at: new Date().toISOString() }).eq('search_id', searchId).eq('status', 'screening');
    const { data: row } = await supabaseAdmin.from('phase1_prospect_searches').select('attempt_count').eq('id', searchId).single();
    const terminal = Number(row?.attempt_count || 0) >= 12;
    await updateSearch(searchId, leaseToken, terminal ? { status: 'failed', stage: 'failed', error_summary: message, lease_token: null, lease_expires_at: null } : { error_summary: message, lease_token: null, lease_expires_at: null }, false);
    if (!terminal) throw error;
  }
}
