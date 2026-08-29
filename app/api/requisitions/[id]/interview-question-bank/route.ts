import { NextResponse } from 'next/server';
import { buildQuestionBank } from '@/lib/interviewQuestionBank';
import { activeAoeAreas, DEFAULT_AOE_PREFERENCES, type AoePreferences } from '@/lib/aoePreferences';
import { generateInterviewQuestions, generatePhoneScreenQuestions } from '@/lib/interviewQuestionGenerator';
import { isInterviewQuestionType, type InterviewQuestionType } from '@/lib/interviewQuestionTypes';
import { PHONE_SCREEN_QUESTION_TYPES, type PhoneScreenQuestionType } from '@/lib/phoneScreenQuestions';
import { resolveCurrentEvaluationBasis } from '@/lib/evaluationBasis';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type PhoneScreenGeneratableType = Exclude<PhoneScreenQuestionType, 'Custom'>;

function isPhoneScreenGeneratableType(value: unknown): value is PhoneScreenGeneratableType {
  return typeof value === 'string' && value !== 'Custom' && (PHONE_SCREEN_QUESTION_TYPES as readonly string[]).includes(value);
}

export const runtime = 'nodejs';
export const maxDuration = 60;

// This endpoint (and the AOE-driven generator it backs) is the
// Structured Interview bank - Phone Screen now has its own dedicated,
// fixed canonical bank (lib/phoneScreenQuestions.ts, served directly by
// InterviewQuestionBankPanel's phone-screen branch) and never reads
// this response. phone-screen is excluded here so its 20 canonical
// entries cannot crowd out round-1/round-2/final's own starter
// questions in this positional slice.
function starterQuestions(positionTitle: string) {
  return buildQuestionBank(positionTitle)
    .filter((question) => question.stage !== 'phone-screen')
    .slice(0, 15)
    .map((question) => ({
      id: question.id,
      text: question.text,
      areas: question.areas,
      questionType: question.questionType,
      cardTitle: question.cardTitle
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

// stage: 'phone-screen' loads only rows generated for Phone Screen;
// 'structured' loads everything else, including rows persisted before
// the stage column existed (stage is null there, which is treated as
// structured - the only kind of generation that existed at the time).
async function loadPersistedQuestions(requisitionId: string, stage: 'phone-screen' | 'structured') {
  let query = supabaseAdmin
    .from('phase1_interview_question_bank')
    .select('question_key,question_text,areas,created_at,question_type,stage,response_kind,response_options,response_unit')
    .eq('requisition_id', requisitionId);
  query = stage === 'phone-screen' ? query.eq('stage', 'phone-screen') : query.or('stage.is.null,stage.neq.phone-screen');
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) throw error;
  const fallbackType = stage === 'phone-screen' ? 'Custom' : 'General';
  return (data || []).map((question) => {
    const questionType = typeof question.question_type === 'string' && question.question_type ? question.question_type : fallbackType;
    const responseKind = question.response_kind as string | null;
    return {
      id: question.question_key as string,
      text: question.question_text as string,
      areas: Array.isArray(question.areas) ? question.areas as string[] : [],
      questionType,
      cardTitle: questionType,
      ...(stage === 'phone-screen' && responseKind
        ? {
            response: {
              kind: responseKind,
              ...(Array.isArray(question.response_options) ? { options: question.response_options } : {}),
              ...(question.response_unit ? { unit: question.response_unit } : {})
            }
          }
        : {})
    };
  });
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

// The generation request identifier the client mints once per
// generation attempt and preserves across a retry of that same
// attempt (see InterviewQuestionBankPanel.tsx). consume_qc_and_add_
// interview_questions (20260829010000_atomic_interview_question_
// generation.sql) uses it, plus the position-derived question ids
// generateInterviewQuestions/generatePhoneScreenQuestions produce, to
// recognize and safely replay an already-completed batch instead of
// charging QC or inserting a duplicate one - so this route no longer
// needs to reconstruct that decision itself.
function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 64;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const stageParam = new URL(request.url).searchParams.get('stage');
    const stage: 'phone-screen' | 'structured' = stageParam === 'phone-screen' ? 'phone-screen' : 'structured';
    const [requisition, organization] = await Promise.all([loadRequisition(params.id), resolveOrganization()]);
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });
    const [persisted, aoePreferences] = await Promise.all([
      loadPersistedQuestions(params.id, stage),
      loadAoePreferences(organization?.id ?? null)
    ]);
    return NextResponse.json({
      positionTitle: requisition.title,
      starterQuestions: stage === 'phone-screen' ? [] : starterQuestions(requisition.title),
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
    if (!isValidRequestId(body.requestId)) return NextResponse.json({ error: 'A generation request identifier is required.' }, { status: 400 });
    const requestId = body.requestId.trim();

    const requisition = await loadRequisition(params.id);
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });

    const organization = await resolveOrganization();
    if (!organization) return NextResponse.json({ error: 'QC billing is not configured for this workspace.' }, { status: 409 });
    // No pre-check against organization.credits_remaining here: a
    // retry of an already-completed generation request must still
    // succeed (as a free replay) even if credits are now at zero -
    // the RPC itself only enforces the credit minimum on a genuinely
    // fresh batch, after confirming this request id has not already
    // been fully persisted.

    if (body.stage === 'phone-screen') {
      let phoneScreenType: Exclude<PhoneScreenQuestionType, 'Custom'> | null = null;
      if (body.questionType != null && body.questionType !== '') {
        if (!isPhoneScreenGeneratableType(body.questionType)) return NextResponse.json({ error: 'Select a valid Question Type.' }, { status: 400 });
        phoneScreenType = body.questionType;
      }

      const [basis, persisted, planQuestions] = await Promise.all([
        resolveCurrentEvaluationBasis(params.id),
        loadPersistedQuestions(params.id, 'phone-screen'),
        loadPlanQuestionTexts(params.id)
      ]);
      if (!basis) return NextResponse.json({ error: 'Apply a Job Description or Hiring Criteria basis before generating questions.' }, { status: 409 });

      const existingQuestions = [...persisted.map((question) => question.text), ...planQuestions];
      const questions = await generatePhoneScreenQuestions({ basis, questionType: phoneScreenType, existingQuestions, requestId });

      const { data, error } = await supabaseAdmin.rpc('consume_qc_and_add_interview_questions', {
        p_org_id: organization.id,
        p_requisition_id: params.id,
        p_questions: questions.map((question) => ({
          id: question.id,
          text: question.text,
          areas: [],
          stage: 'phone-screen',
          questionType: question.questionType,
          responseKind: question.responseKind,
          ...(question.responseOptions ? { responseOptions: question.responseOptions } : {}),
          ...(question.responseUnit ? { responseUnit: question.responseUnit } : {}),
          requestId
        }))
      });
      if (error) {
        if (error.message?.includes('INSUFFICIENT_QC')) return NextResponse.json({ error: 'No QC credits remain.' }, { status: 402 });
        throw error;
      }
      if (!data || typeof data !== 'object' || !Array.isArray(data.questions)) throw new Error('Question generation persistence returned an invalid result.');

      // data.questions is the database's own record of what is
      // actually persisted - Question Type and response metadata
      // included, written atomically with the questions and the QC
      // charge (or, on a replay, read back from that atomic write) -
      // not a client-side reconstruction that could drift from it.
      return NextResponse.json({
        questions: data.questions,
        creditsRemaining: data.creditsRemaining,
        generated: data.questions
      }, { status: 201 });
    }

    const aoePreferences = await loadAoePreferences(organization.id);
    const availableAreas = activeAoeAreas(aoePreferences);
    const availableAreaSet = new Set(availableAreas);
    const selectedAreas = Array.isArray(body.selectedAreas)
      ? body.selectedAreas.map((area: unknown) => String(area)).filter((area: string) => availableAreaSet.has(area))
      : [];
    if (selectedAreas.length > 8) return NextResponse.json({ error: 'Select no more than 8 Areas of Evaluation.' }, { status: 400 });

    let questionType: InterviewQuestionType | null = null;
    if (body.questionType != null && body.questionType !== '') {
      if (!isInterviewQuestionType(body.questionType)) {
        return NextResponse.json({ error: 'Select a valid Question Type.' }, { status: 400 });
      }
      questionType = body.questionType;
    }

    const [basis, persisted, planQuestions] = await Promise.all([
      resolveCurrentEvaluationBasis(params.id),
      loadPersistedQuestions(params.id, 'structured'),
      loadPlanQuestionTexts(params.id)
    ]);
    if (!basis) return NextResponse.json({ error: 'Apply a Job Description or Hiring Criteria basis before generating questions.' }, { status: 409 });

    const existingQuestions = [
      ...starterQuestions(requisition.title).map((question) => question.text),
      ...persisted.map((question) => question.text),
      ...planQuestions
    ];
    const questions = await generateInterviewQuestions({ basis, selectedAreas, questionType, existingQuestions, availableAreas, requestId });

    const { data, error } = await supabaseAdmin.rpc('consume_qc_and_add_interview_questions', {
      p_org_id: organization.id,
      p_requisition_id: params.id,
      p_questions: questions.map((question) => ({
        id: question.id,
        text: question.text,
        areas: question.areas,
        questionType: question.questionType,
        requestId
      }))
    });
    if (error) {
      if (error.message?.includes('INSUFFICIENT_QC')) return NextResponse.json({ error: 'No QC credits remain.' }, { status: 402 });
      throw error;
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.questions)) throw new Error('Question generation persistence returned an invalid result.');

    return NextResponse.json({
      questions: data.questions,
      creditsRemaining: data.creditsRemaining,
      generated: data.questions
    }, { status: 201 });
  } catch (error) {
    console.error('Interview question generation failed', { requisitionId: params.id, error });
    return NextResponse.json({ error: 'Unable to generate interview questions. Try again.' }, { status: 500 });
  }
}
