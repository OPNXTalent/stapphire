'use client';

import { useEffect, useRef, useState } from 'react';

type OpenPanel = 'notifications' | 'app-menu' | 'appearance' | null;
type Appearance = 'system' | 'light' | 'dark';

const APPEARANCE_STORAGE_KEY = 'stapphire-appearance';

function applyAppearance(appearance: Appearance) {
  const dark = appearance === 'dark' || (appearance === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function GlobalBannerControls() {
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [appearance, setAppearance] = useState<Appearance>('system');
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

  useEffect(() => {
    const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    const initial = stored === 'light' || stored === 'dark' ? stored : 'system';
    setAppearance(initial);
    applyAppearance(initial);
  }, []);

  useEffect(() => {
    if (appearance !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateSystemAppearance = () => applyAppearance('system');
    media.addEventListener('change', updateSystemAppearance);
    return () => media.removeEventListener('change', updateSystemAppearance);
  }, [appearance]);

  function toggle(panel: Exclude<OpenPanel, null>) {
    setOpenPanel((current) => current === panel ? null : panel);
  }

  function selectAppearance(nextAppearance: Appearance) {
    setAppearance(nextAppearance);
    localStorage.setItem(APPEARANCE_STORAGE_KEY, nextAppearance);
    applyAppearance(nextAppearance);
  }

  return <div className="global-banner-controls" ref={controlsRef}>
    <button type="button" className="banner-icon-btn" aria-label="Notifications" aria-expanded={openPanel === 'notifications'} aria-controls="global-notifications-panel" onClick={() => toggle('notifications')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>
    </button>
    <button type="button" className="banner-icon-btn" aria-label="App menu" aria-expanded={openPanel === 'app-menu'} aria-controls="global-app-menu" onClick={() => toggle('app-menu')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <button type="button" className="banner-icon-btn" aria-label="Appearance" aria-expanded={openPanel === 'appearance'} aria-controls="global-appearance-panel" onClick={() => toggle('appearance')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg>
    </button>

    {openPanel === 'notifications' && <div className="banner-popover" id="global-notifications-panel" role="region" aria-label="Notifications">
      <strong>Notifications</strong>
      <p>No new notifications.</p>
    </div>}
    {openPanel === 'app-menu' && <div className="banner-popover banner-app-menu" id="global-app-menu" role="menu" aria-label="App menu">
      <a href="/archived" role="menuitem">Archived Requisitions</a>
    </div>}
    {openPanel === 'appearance' && <div className="banner-popover appearance-popover" id="global-appearance-panel" role="radiogroup" aria-label="Appearance">
      <strong>Appearance</strong>
      {(['system', 'light', 'dark'] as Appearance[]).map((option) => <label key={option}>
        <input type="radio" name="appearance" value={option} checked={appearance === option} onChange={() => selectAppearance(option)}/>
        <span>{option[0].toUpperCase() + option.slice(1)}</span>
      </label>)}
    </div>}
  </div>;
}
