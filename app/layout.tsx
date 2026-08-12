import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tarot Reading Starter',
  description:
    'Minimal Next.js 16 tarot reading template. Data from Deckaura (https://deckaura.com).',
  metadataBase: new URL('https://tarot-reading-starter.vercel.app'),
  openGraph: {
    title: 'Tarot Reading Starter',
    description: 'Next.js 16 tarot template. Deploy in one click.',
    url: 'https://deckaura.com',
    siteName: 'Deckaura Tarot Starter',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header style={{ padding: '1rem', borderBottom: '1px solid #eee' }}>
          <h1 style={{ margin: 0 }}>Tarot Reading Starter</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem', color: '#666' }}>
            Data by{' '}
            <a href="https://deckaura.com" target="_blank" rel="noopener">
              Deckaura
            </a>
          </p>
        </header>
        <main style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
          {children}
        </main>
        <footer
          style={{
            padding: '1rem',
            borderTop: '1px solid #eee',
            fontSize: '0.85rem',
            textAlign: 'center',
            color: '#888',
          }}
        >
          Powered by{' '}
          <a href="https://deckaura.com" target="_blank" rel="noopener">
            deckaura.com
          </a>
          . Free tarot tools:{' '}
          <a href="https://deckaura.com/pages/daily-tarot-card">Daily Card</a> ·{' '}
          <a href="https://deckaura.com/pages/random-tarot-card">Random Draw</a> ·{' '}
          <a href="https://deckaura.com/pages/free-tarot-reading">Full Reading</a>
        </footer>
      </body>
    </html>
  );
}
