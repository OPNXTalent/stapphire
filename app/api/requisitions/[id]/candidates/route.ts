import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { extractTextFromBuffer } from '@/lib/extractText';
import { evaluateCandidate } from '@/lib/evaluator';
import { calculateMatch, calculateLegacyVerdict } from '@/lib/evaluation';

export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:{id:string}}){
  let candidateId:string|undefined;
  try{
    const {data:requisition,error:reqError}=await supabaseAdmin.from('phase1_requisitions').select('id,job_description').eq('id',params.id).single();
    if(reqError||!requisition)return NextResponse.json({error:'Requisition not found.'},{status:404});
    const form=await request.formData();const file=form.get('resume');
    if(!(file instanceof File)||file.size===0)return NextResponse.json({error:'A resume file is required.'},{status:400});
    if(file.size>10*1024*1024)return NextResponse.json({error:'Resume must be 10 MB or smaller.'},{status:400});
    const resumeText=(await extractTextFromBuffer(Buffer.from(await file.arrayBuffer()),file.name,file.type)).trim();
    if(resumeText.length<80)return NextResponse.json({error:'The uploaded file did not contain enough readable resume text.'},{status:400});
    const assessment=await evaluateCandidate(requisition.job_description,resumeText);
    const scoreKeys=['job_responsibilities_score','hard_skills_score','soft_skills_score','keyword_terminology_score'] as const;
    if(scoreKeys.some(key=>!Number.isInteger(assessment[key])||assessment[key]<0||assessment[key]>100))throw new Error('Claude returned an invalid category score.');
    const fullName=assessment.candidate_name?.trim()??'';
    const candidateName=fullName||file.name.replace(/\.[^.]+$/,'');
    const {data:candidate,error:candidateError}=await supabaseAdmin.from('phase1_candidates').insert({requisition_id:params.id,full_name:candidateName,source_filename:file.name,resume_text:resumeText}).select('id').single();
    if(candidateError)throw candidateError; candidateId=candidate.id;
    const overallMatch=calculateMatch(assessment);const verdict=calculateLegacyVerdict(overallMatch);
    const {error:evaluationError}=await supabaseAdmin.from('phase1_evaluations').insert({requisition_id:params.id,candidate_id:candidate.id,job_responsibilities_score:assessment.job_responsibilities_score,hard_skills_score:assessment.hard_skills_score,soft_skills_score:assessment.soft_skills_score,keyword_terminology_score:assessment.keyword_terminology_score,overall_match:overallMatch,verdict,assessment,raw_model_response:assessment});
    if(evaluationError)throw evaluationError;
    return NextResponse.json({candidate_id:candidate.id},{status:201});
  }catch(error){console.error(error);if(candidateId)await supabaseAdmin.from('phase1_candidates').delete().eq('id',candidateId);const message=error instanceof Error?error.message:'Evaluation failed.';return NextResponse.json({error:message},{status:500})}
}
