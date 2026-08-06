import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServerClient';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const authClient = createSupabaseServerClient();
  const {
    data: { user }
  } = await authClient.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data } = await supabaseAdmin
    .from('collaborator_profiles')
    .select('full_name')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({ email: user.email, full_name: data?.full_name ?? null });
}

export async function POST(req: NextRequest) {
  const authClient = createSupabaseServerClient();
  const {
    data: { user }
  } = await authClient.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { full_name } = await req.json();
  if (!full_name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('collaborator_profiles')
    .upsert({ user_id: user.id, full_name: full_name.trim() });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
