'use client';

import { useEffect, useRef, useState } from 'react';

export function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsidePointer(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
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

  return (
    <div className="global-banner-controls notifications-standalone" ref={ref}>
      <button
        type="button"
        className="banner-icon-btn"
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls="global-notifications-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>
      </button>
      {open && (
        <div className="banner-popover" id="global-notifications-panel" role="region" aria-label="Notifications">
          <strong>Notifications</strong>
          <p>No new notifications.</p>
        </div>
      )}
    </div>
  );
}
