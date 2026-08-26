import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { interviewProgress, isYesNoResponse } from '@/lib/interviewCompletion';

export async function PATCH(request: Request, { params }: { params: { token: string } }) {
  try {
    const body = await request.json();

    if (body?.submit === true) {
      const participantName = String(body?.participantName ?? '').trim();
      const comments = String(body?.comments ?? '').trim();
      const recommendation = String(body?.recommendation ?? '');
      const ratings = body?.ratings && typeof body.ratings === 'object' && !Array.isArray(body.ratings)
        ? body.ratings as Record<string, unknown>
        : {};
      const questionCommentsInput = body?.questionComments && typeof body.questionComments === 'object' && !Array.isArray(body.questionComments)
        ? body.questionComments as Record<string, unknown>
        : {};
      const yesNoResponsesInput = body?.yesNoResponses && typeof body.yesNoResponses === 'object' && !Array.isArray(body.yesNoResponses)
        ? body.yesNoResponses as Record<string, unknown>
        : {};

      if (!participantName || participantName.length > 200) {
        return NextResponse.json({ error: 'Participant name is required.' }, { status: 400 });
      }
      if (!comments) {
        return NextResponse.json({ error: 'Overall comments are required.' }, { status: 400 });
      }

      const allowedRecommendations = new Set(['Proceed', 'Decline', 'Undecided - Need more information']);
      if (!allowedRecommendations.has(recommendation)) {
        return NextResponse.json({ error: 'Recommendation is required.' }, { status: 400 });
      }

      const { data: invitation, error: invitationError } = await supabaseAdmin
        .from('phase1_interview_invitations')
        .select('id, status, round_snapshot')
        .eq('token', params.token)
        .neq('status', 'revoked')
        .maybeSingle();

      if (invitationError) throw invitationError;
      if (!invitation) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });
      if (invitation.status === 'submitted') {
        return NextResponse.json({ error: 'Interview has already been submitted.' }, { status: 409 });
      }

      const snapshot = invitation.round_snapshot as {
        questions?: Array<{ id?: string; areas?: string[]; commentBox?: boolean; yesNo?: boolean }>;
      } | null;
      const questions = (snapshot?.questions ?? []).filter((question): question is { id: string; areas?: string[]; commentBox?: boolean; yesNo?: boolean } => Boolean(question?.id));
      const commentQuestionIds = new Set<string>();
      for (const question of questions) {
        if (question.commentBox) commentQuestionIds.add(question.id);
      }

      const questionComments: Record<string, string> = {};
      for (const [questionId, rawValue] of Object.entries(questionCommentsInput)) {
        if (!commentQuestionIds.has(questionId)) continue;
        const value = String(rawValue ?? '').trim();
        if (value.length > 4000) {
          return NextResponse.json({ error: 'A question comment is too long.' }, { status: 400 });
        }
        if (value) questionComments[questionId] = value;
      }
      const yesNoQuestionIds = new Set(questions.filter((question) => question.yesNo).map((question) => question.id));
      const yesNoResponses = Object.fromEntries(Object.entries(yesNoResponsesInput).filter(([questionId, value]) => yesNoQuestionIds.has(questionId) && isYesNoResponse(value)));
      if (!interviewProgress(questions, { ratings, questionComments, yesNoResponses }).complete) {
        return NextResponse.json({ error: 'Complete all required interview responses before submitting.' }, { status: 400 });
      }

      const now = new Date().toISOString();
      const { data, error } = await supabaseAdmin
        .from('phase1_interview_invitations')
        .update({
          participant_name: participantName,
          submission_payload: { ratings, yesNoResponses, questionComments, comments, recommendation },
          status: 'submitted',
          submitted_at: now,
          updated_at: now
        })
        .eq('id', invitation.id)
        .select('id, participant_name, status, submitted_at')
        .single();

      if (error) throw error;

      return NextResponse.json({
        invitation: {
          id: data.id,
          participantName: data.participant_name,
          status: data.status,
          submittedAt: data.submitted_at
        }
      });
    }

    const participantName = String(body?.participantName ?? '').trim();
    if (!participantName || participantName.length > 200) {
      return NextResponse.json({ error: 'Participant name is required.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('phase1_interview_invitations')
      .update({ participant_name: participantName, updated_at: new Date().toISOString() })
      .eq('token', params.token)
      .neq('status', 'revoked')
      .select('id, participant_name, status')
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });

    return NextResponse.json({
      invitation: {
        id: data.id,
        participantName: data.participant_name,
        status: data.status
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to update interview invitation.' }, { status: 500 });
  }
}
