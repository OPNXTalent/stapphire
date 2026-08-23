import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export default async function InterviewBuilderPage({ params }: { params: { id: string } }) {
  const { data: requisition } = await supabaseAdmin
    .from('phase1_requisitions')
    .select('id,title')
    .eq('id', params.id)
    .is('archived_at', null)
    .single();

  if (!requisition) notFound();

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '10px 0 40px' }}>
      <Link href={`/requisitions/${requisition.id}?view=requisition&tab=interviews`} style={{ color: 'var(--sapphire)', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>← Back to Interviews</Link>
      <div style={{ marginTop: 18, marginBottom: 18 }}>
        <span className="eyebrow">Interview builder</span>
        <h1 style={{ margin: '4px 0 6px' }}>Build Interview</h1>
        <p className="muted" style={{ margin: 0 }}>{requisition.title}</p>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="field">
          <label htmlFor="interview-title">Interview title</label>
          <input id="interview-title" defaultValue={`Phone Screen — ${requisition.title}`} />
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="interview-summary">Interview plan summary</label>
          <textarea id="interview-summary" rows={3} defaultValue="A structured interview round for evaluating candidates consistently against the requisition." />
        </div>

        <div style={{ marginTop: 22 }}>
          <span className="eyebrow">Questions</span>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {[
              'What drew your attention to this role as a potential next step?',
              'Tell us about experience that best prepares you for the core duties of this role.',
              'What would you want us to understand about your approach that may not be obvious from your resume?'
            ].map((question, index) => (
              <div key={question} style={{ display: 'grid', gridTemplateColumns: '34px minmax(0,1fr)', gap: 10, alignItems: 'center', padding: 10, border: '1px solid var(--line)', borderRadius: 6, background: '#fff' }}>
                <span style={{ color: 'var(--faint)', fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700 }}>Q{index + 1}</span>
                <input defaultValue={question} aria-label={`Question ${index + 1}`} />
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <span className="muted" style={{ fontSize: 11.5 }}>Pre-production build mode. Persistence is intentionally not wired yet.</span>
          <button type="button" disabled title="Saving will be enabled with interview persistence.">Save Interview</button>
        </div>
      </div>
    </div>
  );
}
