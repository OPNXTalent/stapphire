import Link from 'next/link';
import { ArchivedRequisitionActions } from '@/components/ArchivedRequisitionActions';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export default async function ArchivedRequisitionsPage() {
  const { data } = await supabaseAdmin
    .from('phase1_requisitions')
    .select('id,title,archived_at')
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });

  return (
    <>
      <div className="archived-header-row">
        <div className="page-heading">
          <span className="eyebrow">Workspace archive</span>
          <h1>Archived Requisitions</h1>
          <p className="muted">Restore archived work or permanently delete it and its candidate history.</p>
        </div>
        <Link href="/" className="archived-exit-btn" aria-label="Close archived requisitions">
          ×
        </Link>
      </div>
      <section className="surface req-directory">
        <div className="section-heading">
          <h2>Archived</h2>
          <span className="count-label">{data?.length || 0} roles</span>
        </div>
        <div className="archived-list">
          {data?.map((requisition) => (
            <div className="archived-row" key={requisition.id}>
              <span>
                <strong>{requisition.title}</strong>
                <small>Archived {new Date(requisition.archived_at as string).toLocaleDateString()}</small>
              </span>
              <ArchivedRequisitionActions id={requisition.id} title={requisition.title} />
            </div>
          ))}
          {!data?.length && <p className="muted empty-copy">No archived requisitions.</p>}
        </div>
      </section>
    </>
  );
}
