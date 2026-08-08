import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { name, email, company, team_size } = await req.json();

  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('signups').insert({
    name: name.trim(),
    email: email.trim(),
    company: company?.trim() || null,
    team_size: team_size || null
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
