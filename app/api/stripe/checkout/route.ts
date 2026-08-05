import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: NextRequest) {
  try {
    const { org_id } = await req.json();
    if (!org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 });

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('id', org_id)
      .single();

    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: org.stripe_customer_id ?? undefined,
      line_items: [{ price: process.env.STRIPE_PRICE_ID_RESUME_PACK, quantity: 1 }],
      metadata: { org_id },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?canceled=true`
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Checkout failed' }, { status: 500 });
  }
}
