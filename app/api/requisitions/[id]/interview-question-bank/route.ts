import { NextResponse } from 'next/server';
import { AREAS_OF_EVALUATION, buildQuestionBank } from '@/lib/interviewQuestionBank';
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

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const requisition = await loadRequisition(params.id);
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });
    const persisted = await loadPersistedQuestions(params.id);
    return NextResponse.json({
      positionTitle: requisition.title,
      starterQuestions: starterQuestions(requisition.title),
      generatedQuestions: persisted
    });
  } catch (error) {
    console.error('Interview question bank load failed', { requisitionId: params.id, error });
    return NextResponse.json({ error: 'Unable to load interview questions.' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const selectedAreas = Array.isArray(body.selectedAreas)
      ? body.selectedAreas.map((area: unknown) => String(area)).filter((area: string) => AREAS_OF_EVALUATION.includes(area as (typeof AREAS_OF_EVALUATION)[number]))
      : [];
    if (selectedAreas.length > 8) return NextResponse.json({ error: 'Select no more than 8 Areas of Evaluation.' }, { status: 400 });

    const requisition = await loadRequisition(params.id);
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });

    const [basis, persisted, planQuestions, organizations] = await Promise.all([
      resolveCurrentEvaluationBasis(params.id),
      loadPersistedQuestions(params.id),
      loadPlanQuestionTexts(params.id),
      supabaseAdmin.from('organizations').select('id,credits_remaining').limit(2)
    ]);
    if (!basis) return NextResponse.json({ error: 'Apply a Job Description or Hiring Criteria basis before generating questions.' }, { status: 409 });
    if (organizations.error) throw organizations.error;
    if (!organizations.data || organizations.data.length !== 1) {
      return NextResponse.json({ error: 'QC billing is not configured for this workspace.' }, { status: 409 });
    }
    const organization = organizations.data[0];
    if ((organization.credits_remaining as number) < 1) return NextResponse.json({ error: 'No QC credits remain.' }, { status: 402 });

    const existingQuestions = [
      ...starterQuestions(requisition.title).map((question) => question.text),
      ...persisted.map((question) => question.text),
      ...planQuestions
    ];
    const questions = await generateInterviewQuestions({ basis, selectedAreas, existingQuestions });

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
