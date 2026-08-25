import { notFound } from 'next/navigation';
import { CandidateMatrix, type MatrixCandidate, type Disposition } from '@/components/CandidateMatrix';
import { RequisitionViewToggle } from '@/components/RequisitionViewToggle';
import { DNSBin, type DNSCandidate } from '@/components/DNSBin';
import { HiringCriteria } from '@/components/HiringCriteria';
import { InterviewPlan } from '@/components/InterviewPlan';
import { getHiringCriteriaModel } from '@/lib/hiringCriteria';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic='force-dynamic';
type EvaluationRow={overall_match:unknown;job_responsibilities_score:unknown;hard_skills_score:unknown;soft_skills_score:unknown;keyword_terminology_score:unknown;assessment:unknown;evaluation_basis_id:unknown;created_at:string};
function number(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)?value:null}
function record(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function criteriaRollup(assessment:unknown,category:string):number|null{const source=record(assessment);if(source.evaluation_format!=='criteria_v1')return null;return number(record(source.category_rollups)[category]);}
function sourceIsNewer(sourceTimestamp:unknown, analysisTimestamp:unknown):boolean{if(!sourceTimestamp||!analysisTimestamp)return false;return new Date(String(sourceTimestamp)).getTime()>new Date(String(analysisTimestamp)).getTime()}

export default async function RequisitionPage({params}:{params:{id:string}}){
  const {data:req}=await supabaseAdmin.from('phase1_requisitions').select('*').eq('id',params.id).is('archived_at',null).single();if(!req)notFound();
  const {data:candidates,error:candidatesError}=await supabaseAdmin.from('phase1_candidates').select('id,full_name,source_filename,source_storage_path,disposition,rank_order,created_at,phase1_evaluations!phase1_evaluations_candidate_id_fkey(overall_match,job_responsibilities_score,hard_skills_score,soft_skills_score,keyword_terminology_score,assessment,evaluation_basis_id,created_at)').eq('requisition_id',params.id).is('deleted_at',null).order('created_at',{ascending:false});
  if(candidatesError)throw new Error(`Unable to load candidates: ${candidatesError.message}`);
  const {data:dnsList}=await supabaseAdmin.from('phase1_candidates').select('id,full_name,deleted_at').eq('requisition_id',params.id).not('deleted_at','is',null).order('deleted_at',{ascending:false});
  const hiringCriteria=await getHiringCriteriaModel(params.id);
  const matrixCandidates:MatrixCandidate[]=(candidates||[]).map(candidate=>{const evaluations=((candidate.phase1_evaluations as unknown as EvaluationRow[])||[]).sort((a,b)=>b.created_at.localeCompare(a.created_at));const evaluation=evaluations[0];const assessment=evaluation?.assessment??null;return{id:candidate.id,name:candidate.full_name,sourceFilename:String(candidate.source_filename||''),resumeAvailable:Boolean(candidate.source_storage_path),match:number(evaluation?.overall_match),rankOrder:number(candidate.rank_order),createdAt:String(candidate.created_at),evaluationDate:String(evaluation?.created_at||candidate.created_at),evaluationBasisId:typeof evaluation?.evaluation_basis_id==='string'?evaluation.evaluation_basis_id:null,responsibilities:number(evaluation?.job_responsibilities_score),hardSkills:number(evaluation?.hard_skills_score),softSkills:number(evaluation?.soft_skills_score),keywords:number(evaluation?.keyword_terminology_score),otherRequirements:criteriaRollup(assessment,'other_requirements'),assessment,disposition:(['screen','interview','hire','delete'].includes(String(candidate.disposition))?candidate.disposition as Disposition:null)}});
  const hasCustomRanking=matrixCandidates.some(candidate=>candidate.rankOrder!==null);
  matrixCandidates.sort((a,b)=>hasCustomRanking
    ? (a.rankOrder===null?1:b.rankOrder===null?-1:a.rankOrder-b.rankOrder)||(a.createdAt.localeCompare(b.createdAt))
    : ((b.match??-1)-(a.match??-1))||a.createdAt.localeCompare(b.createdAt));
  const dnsCandidates:DNSCandidate[]=(dnsList||[]).map(c=>({id:c.id,name:c.full_name,deletedAt:c.deleted_at as string}));

  const hiringCriteriaView = <HiringCriteria model={hiringCriteria} requisitionId={req.id} sourceIsStale={sourceIsNewer(req.job_description_updated_at,hiringCriteria?.generatedAt)}/>;
  const interviewsView = (
    <div style={{position:'relative'}}>
      <style>{`.formDesignerLink{position:absolute;right:0;top:2px;z-index:2;padding:6px 8px;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--muted);font-size:10.5px;font-weight:700;text-decoration:none;transition:border-color .15s ease,background .15s ease,color .15s ease}.formDesignerLink:hover,.formDesignerLink:focus-visible{border-color:var(--sapphire-2);background:#fff;color:var(--sapphire);outline:none}`}</style>
      <a href={`/form-branding-preview?requisitionId=${encodeURIComponent(req.id)}`} className="formDesignerLink">Form Designer</a>
      <InterviewPlan requisitionId={req.id} positionTitle={req.title} candidateNames={matrixCandidates.map(candidate=>candidate.name)}/>
    </div>
  );
  const candidatesView = <CandidateMatrix candidates={matrixCandidates} positionTitle={req.title} requisitionId={req.id}/>;

  return <RequisitionViewToggle title={req.title} requisitionId={req.id} jobDescription={req.job_description} dnsAction={<DNSBin candidates={dnsCandidates}/>} hiringCriteriaView={hiringCriteriaView} interviewsView={interviewsView} candidatesView={candidatesView}/>;
}
