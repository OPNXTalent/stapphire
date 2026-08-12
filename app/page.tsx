import { CreateRequisitionForm } from '@/components/CreateRequisitionForm';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic='force-dynamic';
export default async function Home(){const {data}=await supabaseAdmin.from('phase1_requisitions').select('id,title,created_at').order('created_at',{ascending:false});return <><h1>Requisitions</h1><p className="muted">Create a role, then evaluate resumes against its Job Description.</p><CreateRequisitionForm/><h2>Open requisitions</h2><div className="list">{data?.map(r=><a className="row" style={{gridTemplateColumns:'1fr auto'}} href={`/requisitions/${r.id}`} key={r.id}><strong>{r.title}</strong><span className="muted">Open →</span></a>)}{!data?.length&&<p className="muted">No requisitions yet.</p>}</div></>}

