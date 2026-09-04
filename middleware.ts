import { NextResponse, type NextRequest } from 'next/server';
import { GATE_COOKIE, gateToken, isProductionEnv } from '@/lib/gate';

// Minimal shared-password gate for the clean-room Stapphire rebuild.
// No accounts, no OTP, no Supabase Auth - one shared secret, one
// signed cookie. The cookie never holds the raw SITE_PASSWORD.
//
// SITE_PASSWORD missing:
// - outside production: gate disabled, for developer convenience only
// - in production: fails CLOSED - everything is denied except the
//   config-error page itself, never silently left open

const EXEMPT_PATHS = [
  '/gate-login',
  '/api/gate',
  '/gate-config-error',
  '/interview/invite',
  '/api/interview-invitations',
  '/teamwork',
  '/api/teamwork'
];

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$/.test(pathname)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sitePassword = process.env.SITE_PASSWORD;

  if (isStaticAsset(pathname)) return NextResponse.next();

  if (!sitePassword) {
    if (!isProductionEnv()) return NextResponse.next(); // dev convenience only

    if (pathname === '/gate-config-error') return NextResponse.next();
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
    }
    return NextResponse.rewrite(new URL('/gate-config-error', request.url));
  }

  if (
    pathname === '/interview/invite' || pathname.startsWith('/interview/invite/') ||
    pathname === '/teamwork' || pathname.startsWith('/teamwork/')
  ) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-stapphire-public-invite', '1');
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const isExempt = EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (isExempt) return NextResponse.next();

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
