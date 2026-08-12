import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// A shared password gate — not per-user auth, but a real fix for "can
// a random person with the URL get in." The page-level gate is the
// primary protection: without it, nobody ever sees a real requisition
// or candidate id to construct a raw API call with in the first place.
// The two org-wide listing endpoints get an explicit second check
// since they expose everything in an org from nothing but an org id,
// with no requisition/candidate id required — the one shape of API
// access a page-level gate alone wouldn't stop.
const SITE_PASSWORD = process.env.SITE_PASSWORD;
const GATE_COOKIE = 'stapphire_gate';

// Routes with their own independent access control (collaborator
// OTP session, share-link token, the gate-check endpoint itself) stay
// completely outside this — gating them would just break systems that
// already work correctly on their own terms.
const GATE_EXEMPT_PREFIXES = [
  '/api/gate',
  '/api/collaborator',
  '/api/shared',
  '/api/signups',
  '/api/stripe',
  '/login',
  '/collaborator',
  '/shared',
  '/auth/callback',
  '/maintenance'
];

// Only the base /api/requisitions route (list-all/create) is gated
// here — everything under /api/requisitions/[id]/* (discovery chat,
// disposition, etc.) is deliberately left alone, since shared-link
// viewers and collaborators depend on those and don't have the site
// password. /api/organizations/* and /api/diagnostic/* have no such
// overlap — every route under either is a recruiter-only or
// diagnostic-only action.
function isGatedApi(pathname: string): boolean {
  if (pathname === '/api/requisitions') return true;
  if (pathname === '/api/organizations' || pathname.startsWith('/api/organizations/')) return true;
  if (pathname === '/api/diagnostic' || pathname.startsWith('/api/diagnostic/')) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasGateCookie = !!SITE_PASSWORD && request.cookies.get(GATE_COOKIE)?.value === SITE_PASSWORD;
  const isExempt = GATE_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (SITE_PASSWORD && !isExempt) {
    const isPage = !pathname.startsWith('/api');

    if ((isPage || isGatedApi(pathname)) && !hasGateCookie) {
      if (isPage) return NextResponse.rewrite(new URL('/maintenance', request.url));
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
    }
  }

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: any }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );

  // Touching getUser() is what actually refreshes an expiring session
  // token — without this, a collaborator's login would silently stop
  // working after the token's short lifetime, not at logout.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
