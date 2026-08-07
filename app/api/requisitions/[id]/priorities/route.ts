import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Editable anytime. Applies to evaluations run from this point forward
// only — never retroactive, matching how the AI's evidence is treated
// as immutable everywhere else in the app.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { evaluation_priorities } = await req.json();

  const { error } = await supabaseAdmin
    .from('requisitions')
    .update({ evaluation_priorities: evaluation_priorities || null })
    .eq('id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
