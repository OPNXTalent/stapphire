import './globals.css';
import './matrix.css';
import { cookies } from 'next/headers';
import { AppShell } from '@/components/AppShell';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { GATE_COOKIE, isGateCookieValid } from '@/lib/gate';

export const metadata = { title: 'Stapphire', description: 'Hiring quality control' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The root layout wraps every route, including the gate's own login
  // page - so this fetch has to be conditional. Rendering the real
  // requisition list into the sidebar unconditionally would leak
  // titles to anyone hitting the login page, defeating the gate
  // entirely regardless of what middleware blocks.
  const authenticated = await isGateCookieValid(cookies().get(GATE_COOKIE)?.value);
  const { data } = authenticated
    ? await supabaseAdmin.from('phase1_requisitions').select('id,title').order('created_at', { ascending: false })
    : { data: [] };

  return (
    <html lang="en">
      <body>
        <AppShell requisitions={data || []}>{children}</AppShell>
      </body>
    </html>
  );
}
