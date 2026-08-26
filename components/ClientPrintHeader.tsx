export type ClientPrintBranding = {
  paletteName?: string;
  primary?: string;
  accent?: string;
  logoUrl?: string;
  logoName?: string;
};

function safeHex(value: string | undefined, fallback: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value! : fallback;
}

export function ClientPrintHeader({ branding, documentTitle }: { branding?: ClientPrintBranding; documentTitle: string }) {
  const primary = safeHex(branding?.primary, '#030d26');
  const accent = safeHex(branding?.accent, '#1e4fd8');

  return (
    <header
      className="client-print-header"
      style={{ '--client-print-primary': primary, '--client-print-accent': accent } as React.CSSProperties}
    >
      <div className="client-print-brand">
        {branding?.logoUrl ? (
          <img src={branding.logoUrl} alt={branding.logoName || 'Company logo'} />
        ) : (
          <span className="client-print-brand-fallback">{branding?.paletteName || 'Interview Evaluation'}</span>
        )}
      </div>
      <span className="client-print-document-title">{documentTitle}</span>
    </header>
  );
}
