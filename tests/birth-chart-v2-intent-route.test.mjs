import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const PLANETS = [
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter',
  'Saturn', 'Uranus', 'Neptune', 'Pluto', 'NorthNode',
];

let routePromise;
function loadRoute() {
  if (!routePromise) {
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('@/')) {
          const base = resolve(rootPath, specifier.slice(2));
          for (const extension of ['', '.ts', '.mjs', '.js']) {
            const candidate = `${base}${extension}`;
            if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
          }
        }
        return nextResolve(specifier, context);
      },
    });
    routePromise = import(`../app/api/readings/intent/route.ts?birth-chart-v2=${Date.now()}`);
  }
  return routePromise;
}

function snapshot() {
  return {
    version: 'birth-chart-snapshot-v1',
    focus: 'career',
    birth: {
      date: '1990-01-01',
      time: null,
      status: 'unknown',
      place: {
        name: 'Istanbul', region: 'Istanbul', country: 'Turkey',
        latitude: 41.0082, longitude: 28.9784, timezone: 'Europe/Istanbul',
      },
    },
    systems: { zodiac: 'Western Tropical', houses: 'Whole Sign', calculation: 'client-v2' },
    angles: { ascendant: null, midheaven: null },
    placements: PLANETS.map((key, index) => ({
      key,
      longitude: 10 + index * 25,
      house: null,
      retrograde: false,
      ambiguous: false,
      browserOnlyField: 'ignored-after-validation',
    })),
    aspects: [],
    currentTransit: null,
  };
}

function request(funnelVersion) {
  return new Request('https://reading.deckaura.com/api/readings/intent', {
    method: 'POST',
    headers: { Origin: 'https://deckaura.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'birth_chart',
      funnelVersion,
      snapshotVersion: 'birth-chart-snapshot-v1',
      page: '/pages/birth-chart-calculator',
      toolType: 'Astrology Birth Chart',
      intent: 'career',
      tier: 'essential',
      question: 'What career pattern should I understand now?',
      readingId: 'birth-chart-live-v2-20260903',
      snapshot: snapshot(),
    }),
  });
}

test('intent route accepts live birth-chart v2 and legacy v1 with the dedicated product contract', async (t) => {
  const originalSql = globalThis.__deckauraSql;
  const originalSecret = process.env.ENTITLEMENT_PEPPER;
  const inserts = [];
  t.after(() => {
    globalThis.__deckauraSql = originalSql;
    if (originalSecret === undefined) delete process.env.ENTITLEMENT_PEPPER;
    else process.env.ENTITLEMENT_PEPPER = originalSecret;
  });
  process.env.ENTITLEMENT_PEPPER = 'birth-chart-v2-route-test-pepper';
  const sql = async (strings, ...values) => {
    assert.match(strings.join(' '), /insert into deckaura\.checkout_intents/);
    inserts.push({ values, snapshot: values.find((value) => value?.__testJson)?.__testJson });
    return [];
  };
  sql.json = (value) => ({ __testJson: value });
  globalThis.__deckauraSql = sql;
  const { POST } = await loadRoute();

  for (const version of [
    'birth-chart-evidence-checkout-2026-08-v2',
    'birth-chart-evidence-checkout-2026-08-v1',
  ]) {
    const response = await POST(request(version));
    const body = await response.json();
    assert.equal(response.status, 201, `${version}: ${JSON.stringify(body)}`);
    assert.equal(body.variantId, '53782498312465');
    assert.equal(body.sku, 'READING-DEEP');
    assert.equal(body.readingType, 'Astrology Birth Chart');
    assert.equal(inserts.at(-1).values[3], version, 'submitted signed-contract version must be preserved');
    assert.equal(inserts.at(-1).values[13], '53782498312465');
    assert.equal(inserts.at(-1).values[18], 'birth_chart');
    assert.equal(inserts.at(-1).snapshot.systems.calculation, undefined, 'unknown browser fields must not be persisted');
  }

  const unsupported = await POST(request('birth-chart-evidence-checkout-2026-08-v3'));
  assert.equal(unsupported.status, 422);
  assert.deepEqual(await unsupported.json(), { error: 'invalid_birth_chart_intent' });
  assert.equal(inserts.length, 2);
});
