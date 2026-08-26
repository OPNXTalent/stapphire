import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { buildQuestionBank, INTERVIEW_STAGES, type InterviewStageId } from '@/lib/interviewQuestionBank';

const LEGACY_STAGES = new Set(['phone-screen', 'round-1', 'round-2', 'final']);

type SnapshotQuestion = {
  id: string;
  sourceId?: string;
  text: string;
  areas: string[];
  commentBox?: boolean;
};

type RoundSnapshot = {
  stage?: string;
  title?: string;
  branding?: FormBranding;
  questions?: SnapshotQuestion[];
};

type InvitationRow = {
  id: string;
  stage: string;
  round_title: string;
  status: string;
  participant_name: string | null;
  invited_at: string;
  opened_at: string | null;
  submitted_at: string | null;
  submission_payload: unknown;
  round_snapshot: unknown;
};

type FormBranding = {
  paletteName?: string;
  primary?: string;
  accent?: string;
  logoUrl?: string;
  logoName?: string;
};

type ParticipantAssessment = {
  contributor: string;
  recommendation: string;
  comments: string;
  questionComments: Array<{ question: string; comment: string }>;
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

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

function buildRoundResults(stage: string, rows: InvitationRow[], configuredAreas: string[]) {
  const areaTotals = new Map<string, { total: number; count: number }>();
  const assessments: ParticipantAssessment[] = [];
  let total = 0;
  let ratingCount = 0;

  for (const row of rows) {
    if (row.stage !== stage || row.status !== 'submitted') continue;
    const payload = object(row.submission_payload);
    const ratings = object(payload.ratings);
    const questionComments = object(payload.questionComments);
    const snapshot = object(row.round_snapshot) as RoundSnapshot;
    const questions = Array.isArray(snapshot.questions) ? snapshot.questions : [];
    const questionById = new Map(questions.map((question) => [question.id, question]));

    for (const [key, rawValue] of Object.entries(ratings)) {
      const value = Number(rawValue);
      if (!Number.isInteger(value) || value < 1 || value > 5) continue;
      const separator = key.lastIndexOf(':');
      if (separator < 0) continue;
      const questionId = key.slice(0, separator);
      const area = key.slice(separator + 1);
      const question = questionById.get(questionId);
      if (!question || !question.areas.includes(area)) continue;

      const current = areaTotals.get(area) ?? { total: 0, count: 0 };
      current.total += value;
      current.count += 1;
      areaTotals.set(area, current);
      total += value;
      ratingCount += 1;
    }

    const assessmentQuestionComments = questions
      .filter((question) => question.commentBox)
      .map((question) => ({
        question: question.text,
        comment: String(questionComments[question.id] ?? '').trim()
      }))
      .filter((item) => item.comment.length > 0);

    assessments.push({
      contributor: row.participant_name || 'Interview participant',
      recommendation: String(payload.recommendation ?? ''),
      comments: String(payload.comments ?? ''),
      questionComments: assessmentQuestionComments
    });
  }

  const areas = Array.from(new Set([...configuredAreas, ...areaTotals.keys()]));
  return {
    overall: ratingCount > 0 ? Math.round((total / ratingCount) * 100) / 100 : null,
    rows: areas.map((area) => {
      const aggregate = areaTotals.get(area);
      return {
        area,
        timesRated: aggregate?.count ?? 0,
        average: aggregate && aggregate.count > 0
          ? Math.round((aggregate.total / aggregate.count) * 100) / 100
          : null
      };
    }),
    assessments
  };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const [{ data: invitationsData, error: invitationsError }, { data: candidate, error: candidateError }] = await Promise.all([
      supabaseAdmin
        .from('phase1_interview_invitations')
        .select('id, stage, round_title, status, participant_name, invited_at, opened_at, submitted_at, submission_payload, round_snapshot')
        .eq('candidate_id', params.id)
        .order('invited_at', { ascending: true }),
      supabaseAdmin
        .from('phase1_candidates')
        .select('requisition_id')
        .eq('id', params.id)
        .maybeSingle()
    ]);

    if (invitationsError) throw invitationsError;
    if (candidateError) throw candidateError;
    const invitations = (invitationsData ?? []) as InvitationRow[];
    const counts = summarize(invitations);

    let hasPlan = false;
    let rounds: Array<{
      stage: string;
      title: string;
      areas: string[];
      participants: number;
      submitted: number;
      overall: number | null;
      rows: Array<{ area: string; timesRated: number; average: number | null }>;
      assessments: ParticipantAssessment[];
    }> = [];

    if (candidate) {
      const { data: plan, error: planError } = await supabaseAdmin
        .from('phase1_interview_plans')
        .select('id')
        .eq('requisition_id', candidate.requisition_id)
        .maybeSingle();
      if (planError) throw planError;

      hasPlan = Boolean(plan);
      if (plan) {
        const { data: planRounds, error: roundsError } = await supabaseAdmin
          .from('phase1_interview_rounds')
          .select('id, stage, title, sort_order')
          .eq('plan_id', plan.id)
          .order('sort_order', { ascending: true });
        if (roundsError) throw roundsError;

        const roundIds = (planRounds ?? []).map((round) => round.id);
        let questionRows: Array<{ round_id: string; areas: string[] }> = [];
        if (roundIds.length > 0) {
          const { data, error } = await supabaseAdmin
            .from('phase1_interview_questions')
            .select('round_id, areas')
            .in('round_id', roundIds);
          if (error) throw error;
          questionRows = data ?? [];
        }

        rounds = (planRounds ?? []).map((round) => {
          const areas = Array.from(new Set(
            questionRows.filter((question) => question.round_id === round.id).flatMap((question) => question.areas ?? [])
          ));
          const results = buildRoundResults(round.stage, invitations, areas);
          return {
            stage: round.stage,
            title: round.title,
            areas,
            participants: counts[round.stage]?.participants ?? 0,
            submitted: counts[round.stage]?.submitted ?? 0,
            ...results
          };
        });
      }
    }

    return NextResponse.json({
      counts,
      hasPlan,
      rounds,
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
      branding?: FormBranding;
      questions: SnapshotQuestion[];
    };

    if (plan) {
      const { data: round, error: roundError } = await supabaseAdmin
        .from('phase1_interview_rounds')
        .select('id, stage, title, branding')
        .eq('plan_id', plan.id)
        .eq('stage', stage)
        .maybeSingle();

      if (roundError) throw roundError;
      if (!round) return NextResponse.json({ error: 'Interview not found in this plan.' }, { status: 404 });

      const { data: questions, error: questionsError } = await supabaseAdmin
        .from('phase1_interview_questions')
        .select('id, source_id, question_text, areas, comment_box, sort_order')
        .eq('round_id', round.id)
        .order('sort_order', { ascending: true });

      if (questionsError) throw questionsError;

      interviewRoundId = round.id;
      planRevision = plan.revision;
      roundTitle = round.title;
      snapshot = {
        stage: round.stage,
        title: round.title,
        branding: (round.branding ?? {}) as FormBranding,
        questions: (questions ?? []).map((question) => ({
          id: question.id,
          ...(question.source_id ? { sourceId: question.source_id } : {}),
          text: question.question_text,
          areas: question.areas ?? [],
          commentBox: Boolean(question.comment_box)
        }))
      };
    } else {
      if (!LEGACY_STAGES.has(stage)) {
        return NextResponse.json({ error: 'Save the Interview Plan before sharing this interview.' }, { status: 409 });
      }

      const fallbackQuestions = buildQuestionBank(requisition.title)
        .filter((question) => question.stage === stage as InterviewStageId)
        .map((question) => ({ id: question.id, sourceId: question.id, text: question.text, areas: question.areas, commentBox: false }));

      snapshot = { stage, title: roundTitle, questions: fallbackQuestions };
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