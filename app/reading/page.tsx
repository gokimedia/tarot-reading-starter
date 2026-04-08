import { drawRandom } from '@/lib/cards';

export const dynamic = 'force-dynamic';

export default function ReadingPage() {
  const positions = ['Past', 'Present', 'Future'];
  const draws = positions.map((p) => ({ position: p, card: drawRandom() }));
  return (
    <div>
      <h2>Three-Card Spread</h2>
      <p>Past · Present · Future</p>
      <div style={{ display: 'grid', gap: '1rem', marginTop: '1.5rem' }}>
        {draws.map((d) => (
          <article
            key={d.position}
            style={{
              padding: '1.25rem',
              border: '1px solid #ddd',
              borderRadius: '8px',
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              {d.position}: {d.card.name}
            </h3>
            <p>{d.card.upright}</p>
            <p>
              <a href={d.card.guideUrl} target="_blank" rel="noopener">
                Full meaning on Deckaura →
              </a>
            </p>
          </article>
        ))}
      </div>
      <p style={{ marginTop: '2rem' }}>
        <a href="https://deckaura.com/pages/tarot-reading">
          Get a complete 10-card Celtic Cross reading on Deckaura →
        </a>
      </p>
    </div>
  );
}
