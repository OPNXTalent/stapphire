// Shared by middleware.ts, app/api/gate/route.ts, and app/layout.tsx
// so all three always agree on exactly what a valid gate cookie looks
// like. Uses the Web Crypto API (not Node's `crypto` module) because
// middleware runs on the Edge Runtime, which doesn't support Node
// built-ins - this needs to work correctly there, not just compile.

export const GATE_COOKIE = 'stapphire_gate';
const GATE_LABEL = 'stapphire-gate-v1';

export async function gateToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(GATE_LABEL));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

export async function isGateCookieValid(cookieValue: string | undefined): Promise<boolean> {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) {
    // Missing configuration fails OPEN only outside production, purely
    // for local developer convenience before SITE_PASSWORD is set. In
    // production, a missing password must never grant access to real
    // data - that would make the gate worse than having none, since it
    // would look protected while silently exposing everything.
    return !isProductionEnv();
  }
  if (!cookieValue) return false;
  return cookieValue === (await gateToken(sitePassword));
}
