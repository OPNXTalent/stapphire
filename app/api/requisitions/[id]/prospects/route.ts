import { NextResponse } from 'next/server';
import { resolveCurrentEvaluationBasis, resolveEvaluationBasisById, type HiringCriteriaEvaluationBasis } from '@/lib/evaluationBasis';
import { SEARCH_SCOPES, searchForProspects, type SearchScope, type SourcingGate } from '@/lib/prospectSourcing';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getLatestRequisitionIntelligence } from '@/lib/requisitionIntelligence';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function loadRequisition(requisitionId: string) {
  const { data, error } = await supabaseAdmin
    .from('phase1_requisitions')
    .select('id,title,job_description')
    .eq('id', requisitionId)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

type SourcingCriterion = { id: string; label: string; weight: number; isKnockout: boolean };

async function loadReadyCriteriaDraft(requisitionId: string): Promise<SourcingCriterion[] | null> {
  const { data: model, error: modelError } = await supabaseAdmin
    .from('phase1_hiring_criteria_models')
    .select('id,extraction_status')
    .eq('requisition_id', requisitionId)
    .maybeSingle();
  if (modelError) throw modelError;
  if (!model || model.extraction_status !== 'ready') return null;
  const { data: items, error: itemsError } = await supabaseAdmin
    .from('phase1_hiring_criteria_items')
    .select('id,label,draft_weight,is_knockout')
    .eq('model_id', model.id);
  if (itemsError) throw itemsError;
  const weighted = (items || []).filter((item) => !item.is_knockout);
  if (!weighted.length || weighted.reduce((sum, item) => sum + Number(item.draft_weight || 0), 0) !== 100) return null;
  return (items || []).map((item) => ({
    id: item.id,
    label: item.label,
    weight: Number(item.draft_weight || 0),
    isKnockout: item.is_knockout === true
  }));
}

async function resolveOrApplySourcingBasis(requisitionId: string): Promise<HiringCriteriaEvaluationBasis | null> {
  const currentBasis = await resolveCurrentEvaluationBasis(requisitionId);
  if (currentBasis?.basisType === 'hiring_criteria') return currentBasis;
  if (!await loadReadyCriteriaDraft(requisitionId)) return null;

  const { data, error } = await supabaseAdmin.rpc('apply_phase1_hiring_criteria', { p_requisition_id: requisitionId });
  if (error) throw error;
  if (!data || typeof data !== 'object' || typeof data.basisId !== 'string') {
    throw new Error('Automatic Hiring Criteria activation returned an invalid state.');
  }
  const appliedBasis = await resolveEvaluationBasisById(requisitionId, data.basisId);
  if (!appliedBasis || appliedBasis.basisType !== 'hiring_criteria') {
    throw new Error('Automatic Hiring Criteria activation did not create a sourcing basis.');
  }
  return appliedBasis;
}

async function loadSearch(requisitionId: string, searchId?: string | null) {
  let query = supabaseAdmin
    .from('phase1_prospect_searches')
    .select('id,evaluation_basis_id,boolean_query,search_strategy,created_at')
    .eq('requisition_id', requisitionId);
  query = searchId
    ? query.eq('id', searchId)
    : query.order('created_at', { ascending: false }).limit(1);
  const { data: search, error: searchError } = await query.maybeSingle();
  if (searchError) throw searchError;
  if (!search) return null;

  const { data: prospects, error: prospectsError } = await supabaseAdmin
    .from('phase1_prospects')
    .select('id,full_name,preliminary_score,sourcing_fit,headline,location,geographic_fit,gate_findings,criterion_signals,sources,evaluation_score,evaluation,evaluated_at')
    .eq('search_id', search.id)
    .eq('requisition_id', requisitionId)
    .order('preliminary_score', { ascending: false });
  if (prospectsError) throw prospectsError;
  return {
    ...search,
    prospects: (prospects || []).map((prospect) => prospect.evaluation ? prospect : {
      id: prospect.id,
      full_name: prospect.full_name,
      preliminary_score: prospect.preliminary_score,
      sourcing_fit: prospect.sourcing_fit,
      location: prospect.location,
      evaluation_score: null,
      evaluation: null,
      evaluated_at: null,
      sources: []
    })
  };
}

async function searchHistory(requisitionId: string, currentEvaluationBasisId?: string | null) {
  const { data: searches, error: searchesError } = await supabaseAdmin
    .from('phase1_prospect_searches')
    .select('id,evaluation_basis_id,search_strategy,created_at')
    .eq('requisition_id', requisitionId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (searchesError) throw searchesError;
  if (!searches?.length) return [];

  const { data: prospectRows, error: prospectsError } = await supabaseAdmin
    .from('phase1_prospects')
    .select('search_id')
    .eq('requisition_id', requisitionId)
    .in('search_id', searches.map((search) => search.id));
  if (prospectsError) throw prospectsError;
  const counts = new Map<string, number>();
  for (const prospect of prospectRows || []) counts.set(prospect.search_id, (counts.get(prospect.search_id) || 0) + 1);

  return searches.map((search) => ({
    ...search,
    prospectCount: counts.get(search.id) || 0,
    isCurrentCriteria: search.evaluation_basis_id === currentEvaluationBasisId
  }));
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const requestedSearchId = searchParams.get('searchId');
    if (searchParams.get('view') === 'history') {
      const [requisition, basis] = await Promise.all([
        loadRequisition(params.id),
        resolveCurrentEvaluationBasis(params.id)
      ]);
      if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });
      const history = await searchHistory(params.id, basis?.id);
      return NextResponse.json({ search: history[0] ? { id: history[0].id } : null, history });
    }
    const [requisition, basis, search, intelligence, readyCriteria] = await Promise.all([
      loadRequisition(params.id),
      resolveCurrentEvaluationBasis(params.id),
      loadSearch(params.id, requestedSearchId),
      getLatestRequisitionIntelligence(params.id),
      loadReadyCriteriaDraft(params.id)
    ]);
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });
    if (requestedSearchId && !search) return NextResponse.json({ error: 'Saved search not found.' }, { status: 404 });
    const appliedCriteria = basis?.basisType === 'hiring_criteria' ? basis.criteria.map((criterion) => ({
      id: criterion.id,
      label: criterion.label,
      weight: criterion.appliedWeight,
      isKnockout: criterion.isKnockout
    })) : null;
    const sourcingCriteria = appliedCriteria || readyCriteria || [];
    return NextResponse.json({
      criteriaApplied: basis?.basisType === 'hiring_criteria',
      criteriaReadyToApply: basis?.basisType !== 'hiring_criteria' && Boolean(readyCriteria),
      currentEvaluationBasisId: basis?.id ?? null,
      criteria: sourcingCriteria,
      defaults: {
        targetLocation: intelligence?.internalEvidence?.location || '',
        targetCompensation: intelligence?.internalEvidence?.compensation?.minimum || intelligence?.internalEvidence?.compensation?.maximum ? `${intelligence.internalEvidence.compensation.minimum ?? ''}-${intelligence.internalEvidence.compensation.maximum ?? ''} ${intelligence.internalEvidence.compensation.currency || ''} per ${intelligence.internalEvidence.compensation.unit}` : '',
        searchScope: '50_MILES',
        gates: sourcingCriteria.length ? [
          { id: 'occupational-domain', label: `Direct professional experience in the ${requisition.title} occupational domain` },
          ...sourcingCriteria.filter((criterion) => criterion.isKnockout).map((criterion) => ({ id: `criterion-${criterion.id}`, label: criterion.label }))
        ] : []
      },
      search,
      stale: Boolean(search && search.evaluation_basis_id !== basis?.id)
    });
  } catch (error) {
    console.error('Prospect search load failed', { requisitionId: params.id, error });
    return NextResponse.json({ error: 'Unable to load sourced prospects.' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const [requisition, basis] = await Promise.all([loadRequisition(params.id), resolveOrApplySourcingBasis(params.id)]);
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });
    if (!basis || basis.basisType !== 'hiring_criteria') {
      return NextResponse.json({ error: 'Complete Hiring Criteria with a total weight of 100% before sourcing prospects.' }, { status: 409 });
    }

    const body = await request.json().catch(() => ({})) as { targetLocation?: string; targetCompensation?: string; searchScope?: string; gates?: SourcingGate[] };
    const searchScope = SEARCH_SCOPES.includes(body.searchScope as SearchScope) ? body.searchScope as SearchScope : '50_MILES';
    const gates = Array.isArray(body.gates) ? body.gates.filter((gate) => typeof gate?.id === 'string' && typeof gate?.label === 'string' && gate.label.trim()).slice(0, 8) : [];
    if (!gates.length) return NextResponse.json({ error: 'Confirm at least one non-negotiable sourcing gate.' }, { status: 400 });
    const result = await searchForProspects({
      title: requisition.title,
      jobDescription: basis.jobDescriptionSnapshot,
      criteria: basis.criteria,
      gates,
      targetLocation: body.targetLocation?.trim() || '',
      targetCompensation: body.targetCompensation?.trim() || '',
      searchScope
    });

    const { data: search, error: searchError } = await supabaseAdmin
      .from('phase1_prospect_searches')
      .insert({
        requisition_id: params.id,
        evaluation_basis_id: basis.id,
        boolean_query: result.booleanQuery,
        search_strategy: { rationale: result.strategyRationale, marketAnalysis: result.marketAnalysis, config: { targetLocation: body.targetLocation?.trim() || '', targetCompensation: body.targetCompensation?.trim() || '', searchScope, gates } },
        model_identifier: result.modelIdentifier
      })
      .select('id,evaluation_basis_id,boolean_query,search_strategy,created_at')
      .single();
    if (searchError) throw searchError;

    const { error: prospectsError } = await supabaseAdmin.from('phase1_prospects').insert(result.prospects.map((prospect) => ({
      search_id: search.id,
      requisition_id: params.id,
      evaluation_basis_id: basis.id,
      full_name: prospect.fullName,
      preliminary_score: prospect.preliminaryScore,
      sourcing_fit: prospect.sourcingFit,
      headline: prospect.headline,
      location: prospect.location,
      geographic_fit: prospect.geographicFit,
      public_evidence: prospect.publicEvidence,
      gate_findings: prospect.gateFindings,
      criterion_signals: prospect.criterionSignals,
      sources: prospect.sources
    })));
    if (prospectsError) {
      await supabaseAdmin.from('phase1_prospect_searches').delete().eq('id', search.id).eq('requisition_id', params.id);
      throw prospectsError;
    }

    return NextResponse.json({
      search: await loadSearch(params.id, search.id),
      stale: false,
      criteriaApplied: true,
      criteriaReadyToApply: false,
      currentEvaluationBasisId: basis.id,
      defaults: { targetLocation: body.targetLocation?.trim() || '', targetCompensation: body.targetCompensation?.trim() || '', searchScope, gates },
      criteria: basis.criteria.map((criterion) => ({ id: criterion.id, label: criterion.label, weight: criterion.appliedWeight, isKnockout: criterion.isKnockout }))
    }, { status: 201 });
  } catch (error) {
    console.error('Prospect search failed', { requisitionId: params.id, error });
    return NextResponse.json({ error: 'Unable to complete the public-web prospect search. No QC was used.' }, { status: 500 });
  }
}
