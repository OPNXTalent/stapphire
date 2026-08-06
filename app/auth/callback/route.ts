import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServerClient';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');

  if (code) {
    const supabase = createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL('/collaborator', req.url));
}
