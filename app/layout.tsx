import './globals.css';

export const metadata = { title: 'Stapphire', description: 'Hiring quality control' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><header><a href="/">Stapphire</a><span>Hiring QC</span></header><main>{children}</main></body></html>;
}

