import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// For route handlers / server components that need to know WHO is
// making the request — reads the session from cookies, not a
// client-supplied value that could be spoofed. This is what makes real
// authorization possible, as opposed to the share-link model where
// "having the link" was the only check.
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: any }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component that can't set cookies —
            // fine as long as middleware.ts is refreshing the session.
          }
        }
      }
    }
  );
}
