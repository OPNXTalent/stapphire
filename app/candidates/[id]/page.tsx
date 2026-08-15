import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { CandidateReport } from '@/components/CandidateReport';
import { CandidateDetailActions } from '@/components/CandidateDetailActions';

export const dynamic = 'force-dynamic';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export default async function CandidatePage({ params }: { params: { id: string } }) {
  const { data: candidate } = await supabaseAdmin.from('phase1_candidates').select('*,phase1_requisitions(id,title)').eq('id', params.id).single();
  if (!candidate) notFound();
  const { data: e } = await supabaseAdmin
    .from('phase1_evaluations')
    .select('*')
    .eq('candidate_id', params.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!e) notFound();

  const position = text(record(candidate.phase1_requisitions).title);
  const requisitionId = text(record(candidate.phase1_requisitions).id);

  return (
    <>
      <a className="back" href={`/requisitions/${requisitionId}`}>
        ← {position}
      </a>
      <CandidateDetailActions candidateId={candidate.id} sourceFilename={candidate.source_filename} resumeAvailable={Boolean(candidate.source_storage_path)}/>
      <CandidateReport
        candidateName={candidate.full_name}
        positionTitle={position}
        overallMatch={e.overall_match}
        responsibilities={e.job_responsibilities_score}
        hardSkills={e.hard_skills_score}
        softSkills={e.soft_skills_score}
        keywords={e.keyword_terminology_score}
        assessment={e.assessment}
        evaluationDate={e.created_at}
      />
    </>
  );
}
