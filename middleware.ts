import { NextResponse, type NextRequest } from 'next/server';
import { GATE_COOKIE, gateToken } from '@/lib/gate';

// Minimal shared-password gate for the clean-room Stapphire rebuild.
// No accounts, no OTP, no Supabase Auth - one shared secret, one
// signed cookie. The cookie never holds the raw SITE_PASSWORD.

const EXEMPT_PATHS = ['/gate-login', '/api/gate'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sitePassword = process.env.SITE_PASSWORD;

  if (!sitePassword) return NextResponse.next();

  const isExempt = EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (isExempt) return NextResponse.next();

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(GATE_COOKIE)?.value;
  if (cookie === (await gateToken(sitePassword))) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  const loginUrl = new URL('/gate-login', request.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
