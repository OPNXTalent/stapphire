'use client';

import { BrandGem } from '@/components/BrandGem';

export function StapphireProcessing({ title, detail, className = '' }: { title: string; detail?: string; className?: string }) {
  const accessibleText = detail ? `${title} ${detail}` : title;
  return <div className={`stapphire-processing ${className}`.trim()} role="status" aria-live="polite" aria-label={accessibleText}>
    <div className="processing-stone"><BrandGem/></div>
    <div className="processing-copy"><strong>{title}</strong>{detail&&<span>{detail}</span>}</div>
  </div>;
}
