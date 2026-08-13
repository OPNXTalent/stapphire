import { NextRequest, NextResponse } from 'next/server';
import { GATE_COOKIE, gateToken } from '@/lib/gate';

// Verifies the submitted password server-side and sets a signed
// cookie on success. The raw password is never stored anywhere.
export async function POST(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) {
    return NextResponse.json({ error: 'Site password is not configured on the server.' }, { status: 500 });
  }

  const { password } = await req.json().catch(() => ({ password: '' }));
  if (typeof password !== 'string' || password !== sitePassword) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set(GATE_COOKIE, await gateToken(sitePassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  });
  return res;
}
