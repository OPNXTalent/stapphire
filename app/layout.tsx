import './globals.css';
import './matrix.css';
import { AppShell } from '@/components/AppShell';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const metadata = { title: 'Stapphire', description: 'Hiring quality control' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const {data}=await supabaseAdmin.from('phase1_requisitions').select('id,title').order('created_at',{ascending:false});
  return <html lang="en"><body><AppShell requisitions={data||[]}>{children}</AppShell></body></html>;
}
