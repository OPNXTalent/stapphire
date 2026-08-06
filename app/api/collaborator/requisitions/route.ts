import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServerClient';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const authClient = createSupabaseServerClient();
  const {
    data: { user }
  } = await authClient.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  // The email comes from the verified session, not anything the client
  // supplied — this is the actual access control, not a formality.
  const { data: shares, error } = await supabaseAdmin
    .from('requisition_shares')
    .select('requisition_id, access_level, requisitions(id, title, status)')
    .eq('shared_with_email', user.email);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const requisitions = (shares ?? [])
    .filter((s: any) => s.requisitions)
    .map((s: any) => ({ ...s.requisitions, access_level: s.access_level }));

  return NextResponse.json({ email: user.email, requisitions });
}
