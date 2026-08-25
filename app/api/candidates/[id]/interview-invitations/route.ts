import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { buildQuestionBank, INTERVIEW_STAGES, type InterviewStageId } from '@/lib/interviewQuestionBank';

const LEGACY_STAGES = new Set(['phone-screen', 'round-1', 'round-2', 'final']);

type InvitationRow = {
  id: string;
  stage: string;
  round_title: string;
  status: string;
  participant_name: string | null;
  invited_at: string;
  opened_at: string | null;
  submitted_at: string | null;
};

function summarize(rows: InvitationRow[]) {
  const result: Record<string, { participants: number; submitted: number }> = {};

  for (const row of rows) {
    if (row.status === 'revoked') continue;
    if (!result[row.stage]) result[row.stage] = { participants: 0, submitted: 0 };
    result[row.stage].participants += 1;
    if (row.status === 'submitted') result[row.stage].submitted += 1;
  }

  return result;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { data, error } = await supabaseAdmin
      .from('phase1_interview_invitations')
      .select('id, stage, round_title, status, participant_name, invited_at, opened_at, submitted_at')
      .eq('candidate_id', params.id)
      .order('invited_at', { ascending: true });

    if (error) throw error;
    const invitations = (data ?? []) as InvitationRow[];

    return NextResponse.json({
      counts: summarize(invitations),
      invitations: invitations.map((row) => ({
        id: row.id,
        stage: row.stage,
        roundTitle: row.round_title,
        status: row.status,
        participantName: row.participant_name,
        invitedAt: row.invited_at,
        openedAt: row.opened_at,
        submittedAt: row.submitted_at
      }))
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to load interview invitations.' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const stage = String(body?.stage ?? '').trim();
    if (!stage || stage.length > 120) {
      return NextResponse.json({ error: 'Interview key is invalid.' }, { status: 400 });
    }

    const { data: candidate, error: candidateError } = await supabaseAdmin
      .from('phase1_candidates')
      .select('id, requisition_id, full_name')
      .eq('id', params.id)
      .maybeSingle();

    if (candidateError) throw candidateError;
    if (!candidate) return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });

    const { data: requisition, error: requisitionError } = await supabaseAdmin
      .from('phase1_requisitions')
      .select('title')
      .eq('id', candidate.requisition_id)
      .maybeSingle();

    if (requisitionError) throw requisitionError;
    if (!requisition) return NextResponse.json({ error: 'Requisition not found.' }, { status: 404 });

    const { data: plan, error: planError } = await supabaseAdmin
      .from('phase1_interview_plans')
      .select('id, revision')
      .eq('requisition_id', candidate.requisition_id)
      .maybeSingle();

    if (planError) throw planError;

    let interviewRoundId: string | null = null;
    let planRevision = 1;
    let roundTitle = INTERVIEW_STAGES.find((item) => item.id === stage)?.label || 'Interview';
    let snapshot: {
      stage: string;
      title: string;
      questions: Array<{ id: string; sourceId?: string; text: string; areas: string[] }>;
    };

    if (plan) {
      const { data: round, error: roundError } = await supabaseAdmin
        .from('phase1_interview_rounds')
        .select('id, stage, title')
        .eq('plan_id', plan.id)
        .eq('stage', stage)
        .maybeSingle();

      if (roundError) throw roundError;
      if (!round) return NextResponse.json({ error: 'Interview not found in this plan.' }, { status: 404 });

      const { data: questions, error: questionsError } = await supabaseAdmin
        .from('phase1_interview_questions')
        .select('id, source_id, question_text, areas, sort_order')
        .eq('round_id', round.id)
        .order('sort_order', { ascending: true });

      if (questionsError) throw questionsError;

      interviewRoundId = round.id;
      planRevision = plan.revision;
      roundTitle = round.title;
      snapshot = {
        stage: round.stage,
        title: round.title,
        questions: (questions ?? []).map((question) => ({
          id: question.id,
          ...(question.source_id ? { sourceId: question.source_id } : {}),
          text: question.question_text,
          areas: question.areas ?? []
        }))
      };
    } else {
      if (!LEGACY_STAGES.has(stage)) {
        return NextResponse.json({ error: 'Save the Interview Plan before sharing this interview.' }, { status: 409 });
      }

      const fallbackQuestions = buildQuestionBank(requisition.title)
        .filter((question) => question.stage === stage as InterviewStageId)
        .map((question) => ({
          id: question.id,
          sourceId: question.id,
          text: question.text,
          areas: question.areas
        }));

      snapshot = {
        stage,
        title: roundTitle,
        questions: fallbackQuestions
      };
    }

    const { data: invitation, error: invitationError } = await supabaseAdmin
      .from('phase1_interview_invitations')
      .insert({
        candidate_id: candidate.id,
        requisition_id: candidate.requisition_id,
        interview_round_id: interviewRoundId,
        stage,
        round_title: roundTitle,
        plan_revision: planRevision,
        round_snapshot: snapshot
      })
      .select('id, token, status, invited_at')
      .single();

    if (invitationError) throw invitationError;

    const origin = new URL(request.url).origin;
    return NextResponse.json({
      invitation: {
        id: invitation.id,
        status: invitation.status,
        invitedAt: invitation.invited_at,
        url: `${origin}/interview/invite/${invitation.token}`
      }
    }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to create interview invitation.' }, { status: 500 });
  }
}
