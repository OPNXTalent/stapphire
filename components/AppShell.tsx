'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { WorkspacePanel } from '@/components/WorkspacePanel';

type RequisitionLink={id:string;title:string};

function Gem(){return <svg className="brand-gem" viewBox="0 0 24 24" fill="none" aria-hidden="true"><polygon points="12,1 21,7 24,14 17,23 7,23 0,14 3,7" fill="url(#gemGrad)"/><polygon points="12,1 21,7 12,9" fill="#fff" opacity=".22"/><polygon points="0,14 3,7 12,9 7,23" fill="#0A2452" opacity=".35"/><defs><linearGradient id="gemGrad" x1="0" y1="0" x2="24" y2="23"><stop stopColor="#5C87F5"/><stop offset="1" stopColor="#123A8F"/></linearGradient></defs></svg>}

export function AppShell({requisitions,children}:{requisitions:RequisitionLink[];children:React.ReactNode}){
  const pathname=usePathname();
  const [rightCollapsed,setRightCollapsed]=useState(false);
  return <><header className="brand-bar"><a className="brand-home" href="/"><Gem/><span className="brand-word">Stapphire</span></a><span className="brand-tagline">Hiring Quality Control</span><span className="brand-workspace">an OPNX workspace</span></header><div className={`app-shell ${rightCollapsed?'right-collapsed':''}`}><aside className="req-nav"><div className="req-nav-head"><span className="eyebrow">Workspace</span><div className="eval-balance" aria-label="Evaluation balance unavailable"><span className="eval-balance-label">Evals</span><strong>—</strong><button type="button" className="upload-add-btn eval-add-btn" disabled title="Evaluation purchasing is not configured">+ Add</button></div><a className="new-req-link" href="/#new-requisition">+ New requisition</a></div><nav aria-label="Requisitions"><a className={`req-nav-all ${pathname==='/'?'active':''}`} href="/">ACTIVE REQUISITIONS</a>{requisitions.map(req=><a className={`req-nav-item ${pathname===`/requisitions/${req.id}`?'active':''}`} href={`/requisitions/${req.id}`} key={req.id}><span className="req-status-dot"/><span className="req-nav-title">{req.title}</span></a>)}{!requisitions.length&&<p className="req-nav-empty">No active requisitions</p>}</nav><div className="req-nav-footer"><a className={`req-nav-archived ${pathname==='/archived'?'active':''}`} href="/archived">Archived</a></div></aside><main className="workspace-main"><div className="workspace-content">{children}</div></main><WorkspacePanel collapsed={rightCollapsed} onExpand={()=>setRightCollapsed(false)} onCollapse={()=>setRightCollapsed(true)} /></div></>;
}
