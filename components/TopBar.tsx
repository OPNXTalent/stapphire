export function TopBar({ requisitionTitle }: { requisitionTitle?: string }) {
  return (
    <div className="brand">
      <svg className="gem" viewBox="0 0 24 24" fill="none">
        <polygon points="12,1 21,7 24,14 17,23 7,23 0,14 3,7" fill="url(#gemGrad)" />
        <polygon points="12,1 21,7 12,9" fill="#fff" opacity="0.22" />
        <polygon points="3,7 12,1 12,9" fill="#fff" opacity="0.1" />
        <polygon points="0,14 3,7 12,9 7,23" fill="#0A2452" opacity="0.35" />
        <polygon points="24,14 21,7 12,9 17,23" fill="#0A2452" opacity="0.2" />
        <defs>
          <linearGradient id="gemGrad" x1="0" y1="0" x2="24" y2="23">
            <stop offset="0%" stopColor="#5C87F5" />
            <stop offset="100%" stopColor="#123A8F" />
          </linearGradient>
        </defs>
      </svg>
      <div className="brand-word">Stapphire</div>
      <div className="brand-tagline">Hiring Quality Control</div>
      <div className="brand-right">
        {requisitionTitle && <span>{requisitionTitle}</span>}
        <span className="brand-opnx">an OPNX workspace</span>
      </div>
    </div>
  );
}
