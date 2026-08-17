'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type OpenPanel = 'notifications' | 'app-menu' | null;

export function GlobalBannerControls() {
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsidePointer(event: MouseEvent) {
      if (!controlsRef.current?.contains(event.target as Node)) setOpenPanel(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenPanel(null);
    }
    document.addEventListener('mousedown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  function toggle(panel: Exclude<OpenPanel, null>) {
    setOpenPanel((current) => current === panel ? null : panel);
  }

  return <div className="global-banner-controls" ref={controlsRef}>
    <span className="banner-eval-count">27 Evals</span>
    <button type="button" className="banner-icon-btn" aria-label="Notifications" aria-expanded={openPanel === 'notifications'} aria-controls="global-notifications-panel" onClick={() => toggle('notifications')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>
    </button>
    <button type="button" className="banner-icon-btn" aria-label="App menu" aria-expanded={openPanel === 'app-menu'} aria-controls="global-app-menu" onClick={() => toggle('app-menu')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>

    {openPanel === 'notifications' && <div className="banner-popover" id="global-notifications-panel" role="region" aria-label="Notifications">
      <strong>Notifications</strong>
      <p>No new notifications.</p>
    </div>}
    {openPanel === 'app-menu' && <div className="banner-popover banner-app-menu" id="global-app-menu" role="menu" aria-label="App menu">
      <Link href="/archived" role="menuitem">Archived Requisitions</Link>
    </div>}
  </div>;
}
