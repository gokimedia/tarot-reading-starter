import Link from 'next/link';
import { drawRandom } from '@/lib/cards';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const card = drawRandom();
  return (
    <div>
      <h2>Your Card of the Moment</h2>
      <article
        style={{
          padding: '1.5rem',
          border: '1px solid #ddd',
          borderRadius: '8px',
          marginTop: '1rem',
        }}
      >
        <h3 style={{ marginTop: 0 }}>{card.name}</h3>
        <p>
          <strong>Upright:</strong> {card.upright}
        </p>
        <p>
          <strong>Reversed:</strong> {card.reversed}
        </p>
        <p>
          <a href={card.guideUrl} target="_blank" rel="noopener">
            → Read the full guide on Deckaura
          </a>
        </p>
      </article>

      <p style={{ marginTop: '2rem' }}>
        <Link href="/reading">Get a three-card reading →</Link>
      </p>

      <hr style={{ margin: '2rem 0' }} />

      <h3>About this starter</h3>
      <p>
        A minimal Next.js 16 App Router template for building tarot reading
        applications. Uses{' '}
        <a href="https://huggingface.co/datasets/Blacik/deckaura-tarot-card-meanings">
          the Deckaura tarot dataset
        </a>{' '}
        (MIT licensed) and ships as a deployable Vercel template.
      </p>
      <p>
        Learn more, browse all 78 card meanings, and use free online tarot
        tools at{' '}
        <a href="https://deckaura.com" target="_blank" rel="noopener">
          deckaura.com
        </a>
        .
      </p>
    </div>
  );
}
