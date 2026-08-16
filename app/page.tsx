import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { data } = await supabaseAdmin
    .from('phase1_requisitions')
    .select('id,title,created_at')
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  return <>
    <div className="page-heading">
      <span className="eyebrow">Hiring workspace</span>
      <h1>Requisitions</h1>
      <p className="muted">Create a role, then evaluate resumes against its Job Description.</p>
    </div>
    <section className="surface req-directory">
      <div className="section-heading">
        <div><span className="eyebrow">Active work</span><h2>Active requisitions</h2></div>
        <span className="count-label">{data?.length || 0} roles</span>
      </div>
      <div className="list">
        {data?.map((requisition) => (
          <Link className="row" style={{ gridTemplateColumns: '1fr auto' }} href={`/requisitions/${requisition.id}`} key={requisition.id}>
            <strong>{requisition.title}</strong><span className="open-link">Open →</span>
          </Link>
        ))}
        {!data?.length && <p className="muted empty-copy">No active requisitions.</p>}
      </div>
    </section>
  </>;
}
