import './globals.css';

export const metadata = {
  title: 'Stapphire — Hiring Quality Control',
  description: 'The Quality Control layer for hiring. Sits beside your ATS, not in place of it.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
