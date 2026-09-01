import { NextResponse } from 'next/server';
import { resolveCurrentEvaluationBasis } from '@/lib/evaluationBasis';
import { searchForProspects } from '@/lib/prospectSourcing';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

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
    .select('id,full_name,preliminary_score,headline,location,sources,evaluation_score,evaluation,evaluated_at')
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
      evaluation_score: null,
      evaluation: null,
      evaluated_at: null,
      sources: []
    })
  };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const [requisition, basis, search] = await Promise.all([
      loadRequisition(params.id),
      resolveCurrentEvaluationBasis(params.id),
      latestSearch(params.id)
    ]);
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });
    return NextResponse.json({
      criteriaApplied: basis?.basisType === 'hiring_criteria',
      currentEvaluationBasisId: basis?.id ?? null,
      criteria: basis?.basisType === 'hiring_criteria' ? basis.criteria.map((criterion) => ({
        id: criterion.id,
        label: criterion.label,
        weight: criterion.appliedWeight,
        isKnockout: criterion.isKnockout
      })) : [],
      search,
      stale: Boolean(search && search.evaluation_basis_id !== basis?.id)
    });
  } catch (error) {
    console.error('Prospect search load failed', { requisitionId: params.id, error });
    return NextResponse.json({ error: 'Unable to load sourced prospects.' }, { status: 500 });
  }
}

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const [requisition, basis] = await Promise.all([loadRequisition(params.id), resolveCurrentEvaluationBasis(params.id)]);
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });
    if (!basis || basis.basisType !== 'hiring_criteria') {
      return NextResponse.json({ error: 'Apply weighted Hiring Criteria before sourcing prospects.' }, { status: 409 });
    }

    const result = await searchForProspects({
      title: requisition.title,
      jobDescription: basis.jobDescriptionSnapshot,
      criteria: basis.criteria
    });
    if (result.prospects.length === 0) {
      return NextResponse.json({ error: 'No identity-resolved prospects had enough public evidence. Try refining the Hiring Criteria.' }, { status: 422 });
    }

    const { data: search, error: searchError } = await supabaseAdmin
      .from('phase1_prospect_searches')
      .insert({
        requisition_id: params.id,
        evaluation_basis_id: basis.id,
        boolean_query: result.booleanQuery,
        search_strategy: { rationale: result.strategyRationale },
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
      headline: prospect.headline,
      location: prospect.location,
      public_evidence: prospect.publicEvidence,
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
      criteria: basis.criteria.map((criterion) => ({ id: criterion.id, label: criterion.label, weight: criterion.appliedWeight, isKnockout: criterion.isKnockout }))
    }, { status: 201 });
  } catch (error) {
    console.error('Prospect search failed', { requisitionId: params.id, error });
    return NextResponse.json({ error: 'Unable to complete the public-web prospect search. No QC was used.' }, { status: 500 });
  }
}
