import { getHiringCriteriaModel } from '@/lib/hiringCriteria';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type EvaluationRow = {
  overall_match: number | null;
  job_responsibilities_score: number | null;
  hard_skills_score: number | null;
  soft_skills_score: number | null;
  keyword_terminology_score: number | null;
  assessment: unknown;
  created_at: string;
};

export async function loadSharedTeamworkWorkspace(requisitionId: string) {
  const [
    { data: requisition, error: requisitionError },
    hiringCriteria,
    { data: candidates, error: candidateError },
    { data: search, error: searchError },
    { data: plan, error: planError },
    { data: requisitionNotes, error: requisitionNotesError }
  ] = await Promise.all([
    supabaseAdmin.from('phase1_requisitions').select('id,title,job_description,created_at').eq('id', requisitionId).is('archived_at', null).maybeSingle(),
    getHiringCriteriaModel(requisitionId),
    // Deliberately omit resume_text, source_storage_path, source_filename, disposition and private-note relations.
    supabaseAdmin.from('phase1_candidates').select('id,full_name,created_at,phase1_evaluations!phase1_evaluations_candidate_id_fkey(overall_match,job_responsibilities_score,hard_skills_score,soft_skills_score,keyword_terminology_score,assessment,created_at)').eq('requisition_id', requisitionId).is('deleted_at', null).order('created_at', { ascending: false }),
    supabaseAdmin.from('phase1_prospect_searches').select('id,boolean_query,search_strategy,created_at').eq('requisition_id', requisitionId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('phase1_interview_plans').select('id,revision,updated_at').eq('requisition_id', requisitionId).maybeSingle(),
    supabaseAdmin.from('phase1_requisition_notes').select('id,author_name,body,created_at,teamwork_participant_id').eq('requisition_id', requisitionId).order('created_at', { ascending: true })
  ]);
  if (requisitionError) throw requisitionError;
  if (candidateError) throw candidateError;
  if (searchError) throw searchError;
  if (planError) throw planError;
  if (requisitionNotesError) throw requisitionNotesError;
  if (!requisition) return null;

  const candidateRows = candidates || [];
  const candidateIds = candidateRows.map((candidate) => candidate.id);
  const [prospectResult, roundsResult, candidateNotesResult] = await Promise.all([
    search
      ? supabaseAdmin.from('phase1_prospects').select('id,full_name,preliminary_score,sourcing_fit,headline,location,geographic_fit,gate_findings,criterion_signals,sources,evaluation_score,evaluation,evaluated_at').eq('search_id', search.id).eq('requisition_id', requisitionId).order('preliminary_score', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    plan
      ? supabaseAdmin.from('phase1_interview_rounds').select('id,stage,title,sort_order').eq('plan_id', plan.id).order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    candidateIds.length
      ? supabaseAdmin.from('phase1_candidate_teamwork_notes').select('id,candidate_id,author_name,body,created_at,teamwork_participant_id').in('candidate_id', candidateIds).order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null })
  ]);
  if (prospectResult.error) throw prospectResult.error;
  if (roundsResult.error) throw roundsResult.error;
  if (candidateNotesResult.error) throw candidateNotesResult.error;

  const rounds = roundsResult.data || [];
  const questionResult = rounds.length
    ? await supabaseAdmin.from('phase1_interview_questions').select('id,round_id,question_text,areas,comment_box,yes_no,sort_order').in('round_id', rounds.map((round) => round.id)).order('sort_order', { ascending: true })
    : { data: [], error: null };
  if (questionResult.error) throw questionResult.error;

  const participantIds = Array.from(new Set([
    ...(requisitionNotes || []).map((note) => note.teamwork_participant_id),
    ...(candidateNotesResult.data || []).map((note) => note.teamwork_participant_id)
  ].filter((id): id is string => typeof id === 'string')));
  const participantResult = participantIds.length
    ? await supabaseAdmin.from('phase1_teamwork_participants').select('id,context_role').in('id', participantIds)
    : { data: [], error: null };
  if (participantResult.error) throw participantResult.error;
  const participantContext = new Map((participantResult.data || []).map((participant) => [participant.id, participant.context_role]));
  const withContext = <T extends { teamwork_participant_id?: string | null }>(note: T) => ({
    id: (note as T & { id: string }).id,
    author_name: (note as T & { author_name: string }).author_name,
    body: (note as T & { body: string }).body,
    created_at: (note as T & { created_at: string }).created_at,
    context_role: note.teamwork_participant_id ? participantContext.get(note.teamwork_participant_id) || null : null
  });

  return {
    requisition,
    hiringCriteria,
    sourcing: search ? { ...search, prospects: prospectResult.data || [] } : null,
    interviewPlan: plan ? {
      id: plan.id,
      revision: plan.revision,
      updatedAt: plan.updated_at,
      rounds: rounds.map((round) => ({
        id: round.id,
        stage: round.stage,
        title: round.title,
        questions: (questionResult.data || []).filter((question) => question.round_id === round.id).map((question) => ({
          id: question.id,
          text: question.question_text,
          areas: question.areas || [],
          commentBox: Boolean(question.comment_box),
          yesNo: Boolean(question.yes_no)
        }))
      }))
    } : null,
    candidates: candidateRows.map((candidate) => {
      const evaluations = ((candidate.phase1_evaluations as unknown as EvaluationRow[]) || []).sort((a, b) => b.created_at.localeCompare(a.created_at));
      const evaluation = evaluations[0] || null;
      return {
        id: candidate.id,
        name: candidate.full_name,
        createdAt: candidate.created_at,
        evaluation,
        teamworkNotes: (candidateNotesResult.data || []).filter((note) => note.candidate_id === candidate.id).map(withContext)
      };
    }),
    requisitionNotes: (requisitionNotes || []).map(withContext)
  };
}
