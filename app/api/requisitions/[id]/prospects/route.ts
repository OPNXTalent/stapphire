import { NextResponse } from 'next/server';
import { resolveCurrentEvaluationBasis } from '@/lib/evaluationBasis';
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

async function criteriaReadyToApply(requisitionId: string) {
  const { data: model, error: modelError } = await supabaseAdmin
    .from('phase1_hiring_criteria_models')
    .select('id,extraction_status')
    .eq('requisition_id', requisitionId)
    .maybeSingle();
  if (modelError) throw modelError;
  if (!model || model.extraction_status !== 'ready') return false;
  const { data: items, error: itemsError } = await supabaseAdmin
    .from('phase1_hiring_criteria_items')
    .select('draft_weight,is_knockout')
    .eq('model_id', model.id);
  if (itemsError) throw itemsError;
  const weighted = (items || []).filter((item) => !item.is_knockout);
  return weighted.length > 0 && weighted.reduce((sum, item) => sum + Number(item.draft_weight || 0), 0) === 100;
}

async function latestSearch(requisitionId: string) {
  const { data: search, error: searchError } = await supabaseAdmin
    .from('phase1_prospect_searches')
    .select('id,evaluation_basis_id,boolean_query,search_strategy,created_at')
    .eq('requisition_id', requisitionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
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

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const [requisition, basis, search, intelligence, readyToApply] = await Promise.all([
      loadRequisition(params.id),
      resolveCurrentEvaluationBasis(params.id),
      latestSearch(params.id),
      getLatestRequisitionIntelligence(params.id),
      criteriaReadyToApply(params.id)
    ]);
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });
    return NextResponse.json({
      criteriaApplied: basis?.basisType === 'hiring_criteria',
      criteriaReadyToApply: basis?.basisType !== 'hiring_criteria' && readyToApply,
      currentEvaluationBasisId: basis?.id ?? null,
      criteria: basis?.basisType === 'hiring_criteria' ? basis.criteria.map((criterion) => ({
        id: criterion.id,
        label: criterion.label,
        weight: criterion.appliedWeight,
        isKnockout: criterion.isKnockout
      })) : [],
      defaults: {
        targetLocation: intelligence?.internalEvidence?.location || '',
        targetCompensation: intelligence?.internalEvidence?.compensation?.minimum || intelligence?.internalEvidence?.compensation?.maximum ? `${intelligence.internalEvidence.compensation.minimum ?? ''}-${intelligence.internalEvidence.compensation.maximum ?? ''} ${intelligence.internalEvidence.compensation.currency || ''} per ${intelligence.internalEvidence.compensation.unit}` : '',
        searchScope: '50_MILES',
        gates: basis?.basisType === 'hiring_criteria' ? [
          { id: 'occupational-domain', label: `Direct professional experience in the ${requisition.title} occupational domain` },
          ...basis.criteria.filter((criterion) => criterion.isKnockout).map((criterion) => ({ id: `criterion-${criterion.id}`, label: criterion.label }))
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
    const [requisition, basis] = await Promise.all([loadRequisition(params.id), resolveCurrentEvaluationBasis(params.id)]);
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });
    if (!basis || basis.basisType !== 'hiring_criteria') {
      return NextResponse.json({ error: 'Apply weighted Hiring Criteria before sourcing prospects.' }, { status: 409 });
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
      search: await latestSearch(params.id),
      stale: false,
      criteriaApplied: true,
      currentEvaluationBasisId: basis.id,
      defaults: { targetLocation: body.targetLocation?.trim() || '', targetCompensation: body.targetCompensation?.trim() || '', searchScope, gates },
      criteria: basis.criteria.map((criterion) => ({ id: criterion.id, label: criterion.label, weight: criterion.appliedWeight, isKnockout: criterion.isKnockout }))
    }, { status: 201 });
  } catch (error) {
    console.error('Prospect search failed', { requisitionId: params.id, error });
    return NextResponse.json({ error: 'Unable to complete the public-web prospect search. No QC was used.' }, { status: 500 });
  }
}
