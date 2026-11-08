import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import styles from './workspace.module.css';

export const dynamic = 'force-dynamic';

type Requisition = { id: string; title: string; created_at: string };

export default async function RecruiterWorkspace() {
  const { data, error } = await supabaseAdmin
    .from('phase1_requisitions')
    .select('id,title,created_at')
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (error) throw new Error('Unable to load requisitions for workspace');
  const requisitions = (data ?? []) as Requisition[];

  return (
    <div className={styles.workspace}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Stapphire / Recruiter Workspace · Design iteration 01</span>
          <h1>Recruiting, in one place.</h1>
          <p>Work your requisitions and open the tools you already use—without losing context.</p>
        </div>
        <Link className={styles.primary} href="/requisitions/new">+ New requisition</Link>
      </div>

      <div className={styles.metrics}>
        <div className={styles.metric}><span>Active requisitions</span><strong>{requisitions.length}</strong><small>Live requisition records</small></div>
        <div className={styles.metric}><span>Time to fill</span><strong>—</strong><small>Requires validated dates</small></div>
        <div className={styles.metric}><span>Offers pending</span><strong>—</strong><small>Not yet connected</small></div>
        <div className={styles.metric}><span>Hires this month</span><strong>—</strong><small>Not yet connected</small></div>
        <div className={styles.metric}><span>Offer acceptance</span><strong>—</strong><small>Not yet connected</small></div>
        <div className={styles.metric}><span>Needs attention</span><strong>—</strong><small>Rules pending</small></div>
      </div>

      <div className={styles.toolbar}>
        <div><span className={styles.eyebrow}>Operational workbook</span><h2>Requisitions</h2></div>
        <span className={styles.count}>{requisitions.length} active</span>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead><tr><th>Position / requisition</th><th>Opened</th><th>Resume review</th><th>JD & sourcing</th></tr></thead>
          <tbody>
            {requisitions.map((req) => (
              <tr key={req.id}>
                <td><Link href={`/requisitions/${req.id}`}><strong>{req.title}</strong></Link><span className={styles.id}>{req.id}</span></td>
                <td>{new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td><Link href={`/requisitions/${req.id}`}>Open candidate workspace →</Link></td>
                <td><Link href={`/requisitions/${req.id}`}>Open requisition tools →</Link></td>
              </tr>
            ))}
            {!requisitions.length && <tr><td colSpan={4} className={styles.empty}>No active requisitions. Create one to begin.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className={styles.footnote}>
        <strong>Iteration 01 scope:</strong> This is a live-data navigation shell. Existing JD intake, resume review, and sourcing remain on their established requisition pages. Candidate hierarchy, editable workbook, circular calendar, intake drawer, and validated KPI formulas follow after interface review.
      </div>
    </div>
  );
}
