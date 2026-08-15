'use client';

import { useId } from 'react';

export function BrandGem() {
  const gradientId = useId().replace(/:/g, '');
  return <svg className="brand-gem" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <polygon points="12,1 21,7 24,14 17,23 7,23 0,14 3,7" fill={`url(#${gradientId})`}/>
    <polygon points="12,1 21,7 12,9" fill="#fff" opacity=".22"/>
    <polygon points="0,14 3,7 12,9 7,23" fill="#0A2452" opacity=".35"/>
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="24" y2="23"><stop stopColor="#5C87F5"/><stop offset="1" stopColor="#123A8F"/></linearGradient></defs>
  </svg>;
}
