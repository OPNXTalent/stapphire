import './styles.css';

export const metadata = { title: 'Stapphire Prospect Lab', robots: { index: false, follow: false } };

export default function Layout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
