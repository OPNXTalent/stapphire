import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
export async function POST(request:Request){try{const body=await request.json();const title=String(body.title||'').trim();const job_description=String(body.job_description||'').trim();if(!title||!job_description)return NextResponse.json({error:'Title and Job Description are required.'},{status:400});const {data,error}=await supabaseAdmin.from('phase1_requisitions').insert({title,job_description}).select('id').single();if(error)throw error;return NextResponse.json(data,{status:201})}catch(error){console.error(error);return NextResponse.json({error:'Unable to create requisition. Confirm the Phase 1 SQL has been run.'},{status:500})}}

