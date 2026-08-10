import { NextRequest, NextResponse } from 'next/server';

// The one route that must always be reachable regardless of the gate —
// otherwise nobody could ever get past it in the first place.
export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const sitePassword = process.env.SITE_PASSWORD;

  if (!sitePassword || password !== sitePassword) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set('stapphire_gate', sitePassword, {
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/'
  });
  return res;
}
