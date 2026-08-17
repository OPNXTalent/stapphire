'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export function GlobalBannerControls() {
  const [open, setOpen] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsidePointer(event: MouseEvent) {
      if (!controlsRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return <div className="global-banner-controls" ref={controlsRef}>
    <span className="banner-eval-count">27 Evals</span>
    <button type="button" className="banner-icon-btn" aria-label="App menu" aria-expanded={open} aria-controls="global-app-menu" onClick={() => setOpen((current) => !current)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>

    {open && <div className="banner-popover banner-app-menu" id="global-app-menu" role="menu" aria-label="App menu">
      <Link href="/archived" role="menuitem">Archived Requisitions</Link>
    </div>}
  </div>;
}
