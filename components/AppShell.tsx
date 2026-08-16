'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { WorkspacePanel } from '@/components/WorkspacePanel';
import { BrandGem } from '@/components/BrandGem';
import { GlobalBannerControls } from '@/components/GlobalBannerControls';
import { ResumeUploadManagerProvider } from '@/components/ResumeUploadManager';

type RequisitionLink = { id: string; title: string };

export function AppShell({ requisitions, children }: { requisitions: RequisitionLink[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const [rightCollapsed, setRightCollapsed] = useState(false);
  return (
    <ResumeUploadManagerProvider>
      <header className="brand-bar">
        <Link className="brand-home" href="/"><BrandGem/><span className="brand-word">Stapphire</span></Link>
        <span className="brand-tagline">Hiring Quality Control</span>
        <span className="brand-workspace">an OPNX workspace</span>
        <GlobalBannerControls/>
      </header>
      <div className={`app-shell ${rightCollapsed ? 'right-collapsed' : ''}`}>
        <aside className="req-nav">
          <div className="req-nav-head">
            <span className="eyebrow">Workspace</span>
            <div className="eval-balance" aria-label="Evaluation balance unavailable">
              <span className="eval-balance-label">Evals</span><strong>—</strong>
              <button type="button" className="upload-add-btn eval-add-btn" disabled title="Evaluation purchasing is not configured">+ Add</button>
            </div>
            <Link className="new-req-link" href="/new-requisition">+ New requisition</Link>
          </div>
          <nav aria-label="Requisitions">
            <Link className={`req-nav-all ${pathname === '/' ? 'active' : ''}`} href="/">ACTIVE REQUISITIONS</Link>
            <div className="req-nav-list">
              {requisitions.map((requisition) => (
                <Link className={`req-nav-item ${pathname === `/requisitions/${requisition.id}` ? 'active' : ''}`} href={`/requisitions/${requisition.id}`} key={requisition.id}>
                  <span className="req-status-dot"/><span className="req-nav-title">{requisition.title}</span>
                </Link>
              ))}
              {!requisitions.length && <p className="req-nav-empty">No active requisitions</p>}
            </div>
          </nav>
          <div className="req-nav-footer"><Link className={`req-nav-archived ${pathname === '/archived' ? 'active' : ''}`} href="/archived">Archived</Link></div>
        </aside>
        <main className="workspace-main"><div className="workspace-content">{children}</div></main>
        <WorkspacePanel collapsed={rightCollapsed} onExpand={() => setRightCollapsed(false)} onCollapse={() => setRightCollapsed(true)}/>
      </div>
    </ResumeUploadManagerProvider>
  );
}
