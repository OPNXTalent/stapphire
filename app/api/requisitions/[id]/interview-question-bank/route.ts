import { NextResponse } from 'next/server';
import { buildQuestionBank } from '@/lib/interviewQuestionBank';
import { activeAoeAreas, DEFAULT_AOE_PREFERENCES, type AoePreferences } from '@/lib/aoePreferences';
import { generateInterviewQuestions } from '@/lib/interviewQuestionGenerator';
import { resolveCurrentEvaluationBasis } from '@/lib/evaluationBasis';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
export const maxDuration = 60;

function starterQuestions(positionTitle: string) {
  return buildQuestionBank(positionTitle).slice(0, 15).map((question) => ({
    id: question.id,
    text: question.text,
    areas: question.areas
  }));
}

async function loadRequisition(requisitionId: string) {
  const { data, error } = await supabaseAdmin
    .from('phase1_requisitions')
    .select('id,title')
    .eq('id', requisitionId)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadPersistedQuestions(requisitionId: string) {
  const { data, error } = await supabaseAdmin
    .from('phase1_interview_question_bank')
    .select('question_key,question_text,areas,created_at')
    .eq('requisition_id', requisitionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((question) => ({
    id: question.question_key as string,
    text: question.question_text as string,
    areas: Array.isArray(question.areas) ? question.areas as string[] : []
  }));
}

async function loadPlanQuestionTexts(requisitionId: string) {
  const { data: plan, error: planError } = await supabaseAdmin
    .from('phase1_interview_plans')
    .select('id')
    .eq('requisition_id', requisitionId)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan) return [] as string[];

  const { data: rounds, error: roundsError } = await supabaseAdmin
    .from('phase1_interview_rounds')
    .select('id')
    .eq('plan_id', plan.id);
  if (roundsError) throw roundsError;
  const roundIds = (rounds || []).map((round) => round.id as string);
  if (roundIds.length === 0) return [] as string[];

  const { data: questions, error: questionsError } = await supabaseAdmin
    .from('phase1_interview_questions')
    .select('question_text')
    .in('round_id', roundIds);
  if (questionsError) throw questionsError;
  return (questions || []).map((question) => String(question.question_text || '').trim()).filter(Boolean);
}

async function resolveOrganization() {
  const { data, error } = await supabaseAdmin.from('organizations').select('id,credits_remaining').limit(2);
  if (error) throw error;
  return data && data.length === 1 ? data[0] : null;
}

async function loadAoePreferences(orgId: string | null): Promise<AoePreferences> {
  if (!orgId) return DEFAULT_AOE_PREFERENCES;
  const { data, error } = await supabaseAdmin
    .from('phase1_aoe_preferences')
    .select('hidden_standard_areas,custom_areas')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? {
    hiddenStandardAreas: Array.isArray(data.hidden_standard_areas) ? data.hidden_standard_areas as string[] : [],
    customAreas: Array.isArray(data.custom_areas) ? data.custom_areas as string[] : []
  } : DEFAULT_AOE_PREFERENCES;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const [requisition, organization] = await Promise.all([loadRequisition(params.id), resolveOrganization()]);
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });
    const [persisted, aoePreferences] = await Promise.all([
      loadPersistedQuestions(params.id),
      loadAoePreferences(organization?.id ?? null)
    ]);
    return NextResponse.json({
      positionTitle: requisition.title,
      starterQuestions: starterQuestions(requisition.title),
      generatedQuestions: persisted,
      aoePreferences,
      availableAreas: activeAoeAreas(aoePreferences)
    });
  } catch (error) {
    console.error('Interview question bank load failed', { requisitionId: params.id, error });
    return NextResponse.json({ error: 'Unable to load interview questions.' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const requisition = await loadRequisition(params.id);
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });

    const organization = await resolveOrganization();
    if (!organization) return NextResponse.json({ error: 'QC billing is not configured for this workspace.' }, { status: 409 });
    const aoePreferences = await loadAoePreferences(organization.id);
    const availableAreas = activeAoeAreas(aoePreferences);
    const availableAreaSet = new Set(availableAreas);
    const selectedAreas = Array.isArray(body.selectedAreas)
      ? body.selectedAreas.map((area: unknown) => String(area)).filter((area: string) => availableAreaSet.has(area))
      : [];
    if (selectedAreas.length > 8) return NextResponse.json({ error: 'Select no more than 8 Areas of Evaluation.' }, { status: 400 });
    if ((organization.credits_remaining as number) < 1) return NextResponse.json({ error: 'No QC credits remain.' }, { status: 402 });

    const [basis, persisted, planQuestions] = await Promise.all([
      resolveCurrentEvaluationBasis(params.id),
      loadPersistedQuestions(params.id),
      loadPlanQuestionTexts(params.id)
    ]);
    if (!basis) return NextResponse.json({ error: 'Apply a Job Description or Hiring Criteria basis before generating questions.' }, { status: 409 });

    const existingQuestions = [
      ...starterQuestions(requisition.title).map((question) => question.text),
      ...persisted.map((question) => question.text),
      ...planQuestions
    ];
    const questions = await generateInterviewQuestions({ basis, selectedAreas, existingQuestions, availableAreas });

    const { data, error } = await supabaseAdmin.rpc('consume_qc_and_add_interview_questions', {
      p_org_id: organization.id,
      p_requisition_id: params.id,
      p_questions: questions
    });
    if (error) {
      if (error.message?.includes('INSUFFICIENT_QC')) return NextResponse.json({ error: 'No QC credits remain.' }, { status: 402 });
      throw error;
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.questions)) throw new Error('Question generation persistence returned an invalid result.');

    return NextResponse.json({ questions: data.questions, creditsRemaining: data.creditsRemaining }, { status: 201 });
  } catch (error) {
    console.error('Interview question generation failed', { requisitionId: params.id, error });
    return NextResponse.json({ error: 'Unable to generate interview questions. Try again.' }, { status: 500 });
  }
}
