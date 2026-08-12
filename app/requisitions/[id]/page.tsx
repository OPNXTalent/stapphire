import { notFound } from 'next/navigation';
import { ResumeUpload } from '@/components/ResumeUpload';
import { CandidateMatrix, type MatrixCandidate } from '@/components/CandidateMatrix';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { Verdict } from '@/lib/evaluation';

export const dynamic='force-dynamic';
type EvaluationRow={overall_match:unknown;verdict:unknown;job_responsibilities_score:unknown;hard_skills_score:unknown;soft_skills_score:unknown;keyword_terminology_score:unknown;assessment:unknown;created_at:string};
function number(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)?value:null}
function transitEmployer(value:unknown):boolean|null{if(!value||typeof value!=='object'||Array.isArray(value))return null;const assessment=value as Record<string,unknown>;const history=assessment.employment_history_review;if(!history||typeof history!=='object'||Array.isArray(history))return null;const transit=(history as Record<string,unknown>).previous_transit_employer;if(typeof transit==='string'){const clean=transit.replace(/^(previous\s+transit\s+employer\s*:\s*)+/i,'').trim().toLowerCase();if(clean.includes('none identified')||clean==='no')return false;if(clean.includes('yes'))return true;return null}if(transit&&typeof transit==='object'&&!Array.isArray(transit)){const status=(transit as Record<string,unknown>).status;if(typeof status==='string'){if(status.toLowerCase()==='yes')return true;if(status.toLowerCase()==='none identified'||status.toLowerCase()==='no')return false}}return null}

export default async function RequisitionPage({params}:{params:{id:string}}){
  const {data:req}=await supabaseAdmin.from('phase1_requisitions').select('*').eq('id',params.id).single();if(!req)notFound();
  const {data:candidates}=await supabaseAdmin.from('phase1_candidates').select('id,full_name,phase1_evaluations(overall_match,verdict,job_responsibilities_score,hard_skills_score,soft_skills_score,keyword_terminology_score,assessment,created_at)').eq('requisition_id',params.id).order('created_at',{ascending:false});
  const matrixCandidates:MatrixCandidate[]=(candidates||[]).map(candidate=>{const evaluations=((candidate.phase1_evaluations as unknown as EvaluationRow[])||[]).sort((a,b)=>b.created_at.localeCompare(a.created_at));const evaluation=evaluations[0];return{id:candidate.id,name:candidate.full_name,match:number(evaluation?.overall_match),verdict:evaluation&&['greenlight','consider','decline'].includes(String(evaluation.verdict))?evaluation.verdict as Verdict:null,responsibilities:number(evaluation?.job_responsibilities_score),hardSkills:number(evaluation?.hard_skills_score),softSkills:number(evaluation?.soft_skills_score),keywords:number(evaluation?.keyword_terminology_score),transitEmployer:transitEmployer(evaluation?.assessment)}});
  return <><a className="back" href="/">← Requisitions</a><h1>{req.title}</h1><div className="split"><section><h2>Job Description</h2><div className="jd">{req.job_description}</div></section><ResumeUpload requisitionId={req.id}/></div><h2>Candidate Matrix</h2><p className="muted">Compare evaluated candidates and open a name for the full assessment.</p><CandidateMatrix candidates={matrixCandidates}/></>;
}
