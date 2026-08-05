import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// How many resume-evaluation credits one purchase unit grants.
// Adjust to match whatever STRIPE_PRICE_ID_RESUME_PACK actually sells.
const CREDITS_PER_PACK = 50;

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const orgId = session.metadata?.org_id;

    if (orgId) {
      // Idempotency: skip if we've already logged this Stripe event.
      const { data: existing } = await supabaseAdmin
        .from('credit_transactions')
        .select('id')
        .eq('stripe_event_id', event.id)
        .maybeSingle();

      if (!existing) {
        await supabaseAdmin.rpc('add_credits_and_log', {
          p_org_id: orgId,
          p_amount: CREDITS_PER_PACK,
          p_stripe_event_id: event.id
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
