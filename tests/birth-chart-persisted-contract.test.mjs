import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BIRTH_CHART_SNAPSHOT_VERSION,
  safeBirthChartSnapshot,
  safeSignedPersistedBirthChartSnapshot,
} from '../lib/birth-chart.ts';
import { validShopifyHmac } from '../lib/shopify-webhook-auth.ts';

const PLANET_KEYS = [
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter',
  'Saturn', 'Uranus', 'Neptune', 'Pluto', 'NorthNode',
];

function unknownTimeSnapshot() {
  return {
    version: BIRTH_CHART_SNAPSHOT_VERSION,
    focus: 'current',
    birth: {
      date: '1990-01-01',
      time: null,
      status: 'unknown',
      place: {
        name: 'Istanbul',
        region: 'Istanbul',
        country: 'Turkey',
        latitude: 41.0082,
        longitude: 28.9784,
        timezone: 'Europe/Istanbul',
      },
    },
    systems: { zodiac: 'Western Tropical', houses: 'Whole Sign' },
    angles: { ascendant: null, midheaven: null },
    placements: PLANET_KEYS.map((key, index) => key === 'Moon' ? {
      key,
      longitude: 60,
      house: null,
      retrograde: false,
      ambiguous: true,
      startLongitude: 59,
      endLongitude: 61,
    } : {
      key,
      longitude: 10 + index * 25,
      house: null,
      retrograde: false,
      ambiguous: false,
    }),
    aspects: [],
    currentTransit: null,
  };
}

test('signed persisted unknown-time charts recover omitted ambiguity endpoints', () => {
  const persisted = safeBirthChartSnapshot(unknownTimeSnapshot());
  assert.ok(persisted);
  assert.equal(safeBirthChartSnapshot(persisted), null);
  assert.equal(safeSignedPersistedBirthChartSnapshot(persisted, { integrityVerified: false }), null);

  const recovered = safeSignedPersistedBirthChartSnapshot(persisted, { integrityVerified: true });
  assert.ok(recovered);
  assert.equal(recovered.birth.status, 'unknown');
  assert.deepEqual(recovered.placements.find((placement) => placement.key === 'Moon')?.possibleSigns, ['Taurus', 'Gemini']);
});

test('Shopify webhook verification accepts the configured client-secret fallback', () => {
  const raw = JSON.stringify({ id: '7849290268945' });
  const clientSecret = 'active-shopify-client-secret';
  const hmac = createHmac('sha256', clientSecret).update(raw, 'utf8').digest('base64');
  assert.equal(validShopifyHmac(raw, hmac, ['stale-webhook-secret', clientSecret]), true);
  assert.equal(validShopifyHmac(raw, hmac, ['stale-webhook-secret']), false);
});

test('the queue revives only pre-fix unknown-time birth-chart dead letters', async () => {
  const queue = await readFile(new URL('../lib/reading-queue-processor.ts', import.meta.url), 'utf8');
  assert.match(queue, /recoverPreFixUnknownTimeBirthChartWebhooks/);
  assert.match(queue, /QueueOperationError:CHECKOUT_INTENT_BIRTH_CHART_READING_MISMATCH/);
  assert.match(queue, /property->>'value' = 'unknown'/);
  assert.match(queue, /received_at < \$\{new Date\('2026-08-13T11:15:00\.000Z'\)\}/);
});

test('paid planning and customer-facing writing use their intended providers', async () => {
  const worker = await readFile(new URL('../lib/legacy-worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /var PAID_PLANNER_MODEL = "deepseek-v4-pro"/);
  assert.match(worker, /var PAID_WRITER_MODEL = "claude-sonnet-5"/);
  assert.match(worker, /await completeClaude\(messages, maxTokens, env, `paid-\$\{stage\}`, readingModelUsage\)/);
});
