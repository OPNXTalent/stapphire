import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InterviewBuilder } from '@/components/InterviewBuilder';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export default async function InterviewBuilderPage({ params }: { params: { id: string } }) {
  const { data: requisition } = await supabaseAdmin
    .from('phase1_requisitions')
    .select('id,title,job_description')
    .eq('id', params.id)
    .is('archived_at', null)
    .single();

  if (!requisition) notFound();

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '10px 0 40px' }}>
      <Link href={`/requisitions/${requisition.id}?view=requisition&tab=interviews`} style={{ color: 'var(--sapphire)', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>← Back to Interviews</Link>
      <div style={{ marginTop: 18, marginBottom: 18 }}>
        <span className="eyebrow">Interview builder</span>
        <h1 style={{ margin: '4px 0 6px' }}>Build Interview</h1>
        <p className="muted" style={{ margin: 0 }}>{requisition.title}</p>
      </div>

      <InterviewBuilder positionTitle={requisition.title} hasJobDescription={Boolean(String(requisition.job_description || '').trim())} />
    </div>
  );
}
