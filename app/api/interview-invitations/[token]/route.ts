import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

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

      const snapshot = invitation.round_snapshot as { questions?: Array<{ id?: string; areas?: string[] }> } | null;
      const expectedKeys: string[] = [];
      for (const question of snapshot?.questions ?? []) {
        if (!question?.id) continue;
        for (const area of question.areas ?? []) expectedKeys.push(`${question.id}:${area}`);
      }

      for (const key of expectedKeys) {
        const value = Number(ratings[key]);
        if (!Number.isInteger(value) || value < 1 || value > 5) {
          return NextResponse.json({ error: 'Complete all interview ratings before submitting.' }, { status: 400 });
        }
      }

      const now = new Date().toISOString();
      const { data, error } = await supabaseAdmin
        .from('phase1_interview_invitations')
        .update({
          participant_name: participantName,
          submission_payload: { ratings, comments, recommendation },
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
