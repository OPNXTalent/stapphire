import { notFound } from 'next/navigation';
import { ResumeUpload } from '@/components/ResumeUpload';
import { CandidateMatrix, type MatrixCandidate, type Disposition } from '@/components/CandidateMatrix';
import { RequisitionViewToggle } from '@/components/RequisitionViewToggle';
import { DNSBin, type DNSCandidate } from '@/components/DNSBin';
import { RequisitionIntelligence } from '@/components/RequisitionIntelligence';
import { HiringCriteria } from '@/components/HiringCriteria';
import { getHiringCriteriaModel } from '@/lib/hiringCriteria';
import { getLatestRequisitionIntelligence } from '@/lib/requisitionIntelligence';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic='force-dynamic';
type EvaluationRow={overall_match:unknown;job_responsibilities_score:unknown;hard_skills_score:unknown;soft_skills_score:unknown;keyword_terminology_score:unknown;assessment:unknown;created_at:string};
function number(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)?value:null}
function normalizeJobDescriptionForDisplay(value:unknown):string{return String(value??'').replace(/\r\n?/g,'\n').replace(/\n(?:[ \t]*\n){2,}/g,'\n\n')}

export default async function RequisitionPage({params}:{params:{id:string}}){
  const {data:req}=await supabaseAdmin.from('phase1_requisitions').select('*').eq('id',params.id).is('archived_at',null).single();if(!req)notFound();
  const {data:candidates}=await supabaseAdmin.from('phase1_candidates').select('id,full_name,disposition,rank_order,created_at,phase1_evaluations(overall_match,job_responsibilities_score,hard_skills_score,soft_skills_score,keyword_terminology_score,assessment,created_at)').eq('requisition_id',params.id).is('deleted_at',null).order('created_at',{ascending:false});
  const {data:dnsList}=await supabaseAdmin.from('phase1_candidates').select('id,full_name,deleted_at').eq('requisition_id',params.id).not('deleted_at','is',null).order('deleted_at',{ascending:false});
  const [requisitionIntelligence,hiringCriteria]=await Promise.all([getLatestRequisitionIntelligence(params.id),getHiringCriteriaModel(params.id)]);
  const matrixCandidates:MatrixCandidate[]=(candidates||[]).map(candidate=>{const evaluations=((candidate.phase1_evaluations as unknown as EvaluationRow[])||[]).sort((a,b)=>b.created_at.localeCompare(a.created_at));const evaluation=evaluations[0];return{id:candidate.id,name:candidate.full_name,match:number(evaluation?.overall_match),rankOrder:number(candidate.rank_order),createdAt:String(candidate.created_at),responsibilities:number(evaluation?.job_responsibilities_score),hardSkills:number(evaluation?.hard_skills_score),softSkills:number(evaluation?.soft_skills_score),keywords:number(evaluation?.keyword_terminology_score),assessment:evaluation?.assessment??null,disposition:(['screen','interview','hire','delete'].includes(String(candidate.disposition))?candidate.disposition as Disposition:null)}});
  const hasCustomRanking=matrixCandidates.some(candidate=>candidate.rankOrder!==null);
  matrixCandidates.sort((a,b)=>hasCustomRanking
    ? (a.rankOrder===null?1:b.rankOrder===null?-1:a.rankOrder-b.rankOrder)||(a.createdAt.localeCompare(b.createdAt))
    : ((b.match??-1)-(a.match??-1))||a.createdAt.localeCompare(b.createdAt));
  const dnsCandidates:DNSCandidate[]=(dnsList||[]).map(c=>({id:c.id,name:c.full_name,deletedAt:c.deleted_at as string}));

  const hiringCriteriaView = <HiringCriteria model={hiringCriteria} requisitionId={req.id}/>;
  const marketAnalysisView = <RequisitionIntelligence analysis={requisitionIntelligence} checkedAt={new Date()}/>;
  const jobDescriptionView = <section className="requisition-intelligence" aria-labelledby="job-description-heading"><div className="intelligence-heading"><div><span className="eyebrow">Requisition source</span><h2 id="job-description-heading">Job Description</h2></div></div><div className="jd">{normalizeJobDescriptionForDisplay(req.job_description)}</div></section>;
  const candidatesView = <><ResumeUpload requisitionId={req.id}/><div className="matrix-header-row"><h2>Candidate Matrix</h2><DNSBin candidates={dnsCandidates}/></div><p className="muted">Compare evaluated candidates - click a name to expand the full assessment.</p><CandidateMatrix candidates={matrixCandidates} positionTitle={req.title} requisitionId={req.id}/></>;

  return <RequisitionViewToggle title={req.title} requisitionId={req.id} hiringCriteriaView={hiringCriteriaView} marketAnalysisView={marketAnalysisView} jobDescriptionView={jobDescriptionView} candidatesView={candidatesView}/>;
}
