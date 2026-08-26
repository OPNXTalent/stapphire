import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type PlanQuestionInput = {
  sourceId?: string;
  text: string;
  areas: string[];
  commentBox: boolean;
  yesNo: boolean;
};

type PlanRoundInput = {
  stage: string;
  title: string;
  questions: PlanQuestionInput[];
};

function normalizeRounds(value: unknown): PlanRoundInput[] {
  if (!Array.isArray(value) || value.length > 10) {
    throw new Error('Interview plan must contain a valid rounds array.');
  }

  const seenStages = new Set<string>();

  return value.map((rawRound) => {
    if (!rawRound || typeof rawRound !== 'object') {
      throw new Error('Interview round is invalid.');
    }

    const candidate = rawRound as Record<string, unknown>;
    const stage = String(candidate.stage ?? '').trim();
    const title = String(candidate.title ?? '').trim();
    const rawQuestions = candidate.questions;

    if (!stage || stage.length > 120 || seenStages.has(stage)) {
      throw new Error('Interview round key is invalid or duplicated.');
    }
    seenStages.add(stage);

    if (!title || title.length > 200) {
      throw new Error('Interview round title is invalid.');
    }
    if (!Array.isArray(rawQuestions) || rawQuestions.length > 100) {
      throw new Error('Interview round questions are invalid.');
    }

    const questions = rawQuestions.map((rawQuestion) => {
      if (!rawQuestion || typeof rawQuestion !== 'object') {
        throw new Error('Interview question is invalid.');
      }

      const question = rawQuestion as Record<string, unknown>;
      const text = String(question.text ?? '');
      const sourceId = String(question.sourceId ?? '').trim();
      const rawAreas = question.areas;
      const commentBox = question.commentBox === true;
      const yesNo = question.yesNo === true;

      if (text.length > 1000) {
        throw new Error('Interview question is too long.');
      }
      if (!Array.isArray(rawAreas) || rawAreas.length > 4) {
        throw new Error('Interview question Areas of Evaluation are invalid.');
      }

      const areas = rawAreas.map((area) => String(area).trim()).filter(Boolean);
      if (new Set(areas).size !== areas.length) {
        throw new Error('Interview question Areas of Evaluation contain duplicates.');
      }

      return {
        ...(sourceId ? { sourceId } : {}),
        text,
        areas,
        commentBox,
        yesNo
      };
    });

    return { stage, title, questions };
  });
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { data: plan, error: planError } = await supabaseAdmin
      .from('phase1_interview_plans')
      .select('id, revision, updated_at')
      .eq('requisition_id', params.id)
      .maybeSingle();

    if (planError) throw planError;
    if (!plan) return NextResponse.json({ plan: null });

    const { data: rounds, error: roundsError } = await supabaseAdmin
      .from('phase1_interview_rounds')
      .select('id, stage, title, sort_order')
      .eq('plan_id', plan.id)
      .order('sort_order', { ascending: true });

    if (roundsError) throw roundsError;

    const roundIds = (rounds ?? []).map((round) => round.id);
    let questions: Array<{
      id: string;
      round_id: string;
      source_id: string | null;
      question_text: string;
      areas: string[];
      comment_box: boolean;
      yes_no: boolean;
      sort_order: number;
    }> = [];

    if (roundIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('phase1_interview_questions')
        .select('id, round_id, source_id, question_text, areas, comment_box, yes_no, sort_order')
        .in('round_id', roundIds)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      questions = data ?? [];
    }

    return NextResponse.json({
      plan: {
        id: plan.id,
        revision: plan.revision,
        updatedAt: plan.updated_at,
        rounds: (rounds ?? []).map((round) => ({
          id: round.id,
          stage: round.stage,
          title: round.title,
          questions: questions
            .filter((question) => question.round_id === round.id)
            .map((question) => ({
              id: question.id,
              ...(question.source_id ? { sourceId: question.source_id } : {}),
              text: question.question_text,
              areas: question.areas ?? [],
              commentBox: Boolean(question.comment_box),
              yesNo: Boolean(question.yes_no)
            }))
        }))
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to load the Interview Plan.' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const rounds = normalizeRounds(body?.rounds);

    const { data, error } = await supabaseAdmin.rpc('phase1_replace_interview_plan', {
      p_requisition_id: params.id,
      p_rounds: rounds
    });

    if (error) throw error;

    const saved = Array.isArray(data) ? data[0] : null;
    return NextResponse.json({
      plan: saved
        ? {
            id: saved.plan_id,
            revision: saved.revision,
            updatedAt: saved.updated_at
          }
        : null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const validationError = message.startsWith('Interview ');
    if (!validationError) console.error(error);
    return NextResponse.json(
      { error: validationError ? message : 'Unable to save the Interview Plan.' },
      { status: validationError ? 400 : 500 }
    );
  }
}
