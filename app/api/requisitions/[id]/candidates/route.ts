import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { extractTextFromBuffer } from '@/lib/extractText';
import { evaluateCandidate } from '@/lib/evaluator';
import { calculateMatch, calculateLegacyVerdict } from '@/lib/evaluation';
import { randomUUID } from 'crypto';

export const runtime='nodejs';
const RESUME_BUCKET='candidate-resumes';
function sourceFileType(file:File):{extension:string;mimeType:string}|null{const name=file.name.toLowerCase();if(file.type==='application/pdf'||name.endsWith('.pdf'))return{extension:'.pdf',mimeType:'application/pdf'};if(file.type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'||name.endsWith('.docx'))return{extension:'.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};if(file.type==='text/plain'||name.endsWith('.txt'))return{extension:'.txt',mimeType:'text/plain'};return null}
export async function POST(request:Request,{params}:{params:{id:string}}){
  let candidateId:string|undefined;
  let sourceStoragePath:string|undefined;
  try{
    const {data:requisition,error:reqError}=await supabaseAdmin.from('phase1_requisitions').select('id,job_description').eq('id',params.id).is('archived_at',null).single();
    if(reqError||!requisition)return NextResponse.json({error:'Requisition not found.'},{status:404});
    const form=await request.formData();const file=form.get('resume');
    if(!(file instanceof File)||file.size===0)return NextResponse.json({error:'A resume file is required.'},{status:400});
    if(file.size>10*1024*1024)return NextResponse.json({error:'Resume must be 10 MB or smaller.'},{status:400});
    const sourceType=sourceFileType(file);if(!sourceType)return NextResponse.json({error:'Resume must be a PDF, DOCX, or TXT file.'},{status:400});
    const sourceBuffer=Buffer.from(await file.arrayBuffer());
    const resumeText=(await extractTextFromBuffer(sourceBuffer,file.name,file.type)).trim();
    if(resumeText.length<80)return NextResponse.json({error:'The uploaded file did not contain enough readable resume text.'},{status:400});
    candidateId=randomUUID();sourceStoragePath=`${params.id}/${candidateId}/source${sourceType.extension}`;
    const {error:storageError}=await supabaseAdmin.storage.from(RESUME_BUCKET).upload(sourceStoragePath,sourceBuffer,{contentType:sourceType.mimeType,upsert:false});
    if(storageError)throw new Error('Unable to preserve the original resume file.');
    const assessment=await evaluateCandidate(requisition.job_description,resumeText);
    const scoreKeys=['job_responsibilities_score','hard_skills_score','soft_skills_score','keyword_terminology_score'] as const;
    if(scoreKeys.some(key=>!Number.isInteger(assessment[key])||assessment[key]<0||assessment[key]>100))throw new Error('Claude returned an invalid category score.');
    const fullName=assessment.candidate_name?.trim()??'';
    const candidateName=fullName||file.name.replace(/\.[^.]+$/,'');
    const {data:candidate,error:candidateError}=await supabaseAdmin.from('phase1_candidates').insert({id:candidateId,requisition_id:params.id,full_name:candidateName,source_filename:file.name,source_storage_path:sourceStoragePath,source_mime_type:sourceType.mimeType,resume_text:resumeText}).select('id').single();
    if(candidateError)throw candidateError; candidateId=candidate.id;
    const overallMatch=calculateMatch(assessment);const verdict=calculateLegacyVerdict(overallMatch);
    const {error:evaluationError}=await supabaseAdmin.from('phase1_evaluations').insert({requisition_id:params.id,candidate_id:candidate.id,job_responsibilities_score:assessment.job_responsibilities_score,hard_skills_score:assessment.hard_skills_score,soft_skills_score:assessment.soft_skills_score,keyword_terminology_score:assessment.keyword_terminology_score,overall_match:overallMatch,verdict,assessment,raw_model_response:assessment});
    if(evaluationError)throw evaluationError;
    return NextResponse.json({candidate_id:candidate.id},{status:201});
  }catch(error){console.error(error);if(candidateId)await supabaseAdmin.from('phase1_candidates').delete().eq('id',candidateId);if(sourceStoragePath)await supabaseAdmin.storage.from(RESUME_BUCKET).remove([sourceStoragePath]);const message=error instanceof Error?error.message:'Evaluation failed.';return NextResponse.json({error:message},{status:500})}
}
