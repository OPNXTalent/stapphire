import { NextResponse } from 'next/server';
import { resolveCurrentEvaluationBasis } from '@/lib/evaluationBasis';
import { evaluateProspect, type ProspectSource } from '@/lib/prospectSourcing';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function resolveOrganization() {
  const { data, error } = await supabaseAdmin.from('organizations').select('id,credits_remaining').limit(2);
  if (error) throw error;
  return data && data.length === 1 ? data[0] : null;
}

export async function POST(_request: Request, { params }: { params: { id: string; prospectId: string } }) {
  try {
    const [{ data: requisition, error: requisitionError }, { data: prospect, error: prospectError }, organization, basis] = await Promise.all([
      supabaseAdmin.from('phase1_requisitions').select('id,title').eq('id', params.id).is('archived_at', null).maybeSingle(),
      supabaseAdmin.from('phase1_prospects').select('id,full_name,preliminary_score,headline,location,public_evidence,sources,evaluation,evaluation_score,evaluated_at,evaluation_basis_id').eq('id', params.prospectId).eq('requisition_id', params.id).maybeSingle(),
      resolveOrganization(),
      resolveCurrentEvaluationBasis(params.id)
    ]);
    if (requisitionError) throw requisitionError;
    if (prospectError) throw prospectError;
    if (!requisition || !prospect) return NextResponse.json({ error: 'Prospect not found.' }, { status: 404 });
    if (!organization) return NextResponse.json({ error: 'QC billing is not configured for this workspace.' }, { status: 409 });
    if (prospect.evaluation) {
      return NextResponse.json({
        charged: false,
        creditsRemaining: organization.credits_remaining,
        prospectId: prospect.id,
        evaluationScore: prospect.evaluation_score,
        evaluation: prospect.evaluation,
        sources: prospect.sources,
        evaluatedAt: prospect.evaluated_at
      });
    }
    if ((organization.credits_remaining as number) < 1) return NextResponse.json({ error: 'No QC credits remain.' }, { status: 402 });
    if (!basis || basis.basisType !== 'hiring_criteria' || basis.id !== prospect.evaluation_basis_id) {
      return NextResponse.json({ error: 'Hiring Criteria changed. Run a new prospect search before evaluating this person.' }, { status: 409 });
    }

    const initialSources = Array.isArray(prospect.sources) ? prospect.sources as ProspectSource[] : [];
    const result = await evaluateProspect({
      title: requisition.title,
      jobDescription: basis.jobDescriptionSnapshot,
      criteria: basis.criteria,
      prospect: {
        fullName: prospect.full_name,
        preliminaryScore: prospect.preliminary_score,
        headline: prospect.headline,
        location: prospect.location,
        publicEvidence: prospect.public_evidence,
        sources: initialSources
      }
    });
    const sources = [...initialSources, ...result.evaluation.sources].filter((source, index, all) => all.findIndex((candidate) => candidate.url === source.url) === index);
    const { data, error } = await supabaseAdmin.rpc('consume_qc_and_unlock_prospect_evaluation_v1', {
      p_org_id: organization.id,
      p_prospect_id: prospect.id,
      p_evaluation_basis_id: basis.id,
      p_evaluation_score: result.score,
      p_evaluation: result.evaluation,
      p_sources: sources,
      p_model_identifier: result.modelIdentifier
    });
    if (error) {
      if (error.message?.includes('INSUFFICIENT_QC')) return NextResponse.json({ error: 'No QC credits remain.' }, { status: 402 });
      if (error.message?.includes('STALE_EVALUATION_BASIS')) return NextResponse.json({ error: 'Hiring Criteria changed. Run a new prospect search before evaluating this person.' }, { status: 409 });
      throw error;
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Prospect evaluation failed', { requisitionId: params.id, prospectId: params.prospectId, error });
    return NextResponse.json({ error: 'Unable to complete the prospect evaluation. No QC was used.' }, { status: 500 });
  }
}
