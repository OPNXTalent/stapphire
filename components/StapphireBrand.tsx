export function StapphireBrand({ compact = false, decorative = false }: { compact?: boolean; decorative?: boolean }) {
  return <img
    className={compact ? 'stapphire-brand stapphire-brand-compact' : 'stapphire-brand stapphire-brand-wordmark'}
    src={compact ? '/brand/stapphire-unicorn.png' : '/brand/stapphire-wordmark.png'}
    alt={decorative ? '' : 'Stapphire'}
  />;
}
