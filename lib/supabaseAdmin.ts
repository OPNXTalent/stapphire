import { createClient } from '@supabase/supabase-js';

// Service-role client — server-side only. Never import this into any
// client component; it bypasses Row Level Security.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
