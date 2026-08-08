import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Saving context never triggers an AI call by itself — same convention
// as everything else that can influence an evaluation (the discovery
// prompt, disposition). Seeing it reflected requires an explicit
// Re-evaluate, same credit-consent reasoning as elsewhere.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { additional_context } = await req.json();

  const { error } = await supabaseAdmin
    .from('candidates')
    .update({ additional_context: additional_context || null })
    .eq('id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
