import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const READING_ID = 'astro-local-time-route-20260903';

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
    routePromise = import(`../app/api/readings/intent/route.ts?astro-local-time=${Date.now()}`);
  }
  return routePromise;
}

function birth(status, date, time, timezone) {
  return {
    date,
    time,
    status,
    place: {
      name: 'Test City', region: '', country: 'Test',
      latitude: 0, longitude: 0, timezone,
    },
  };
}

function routeRequest(kind, snapshot) {
  const currentDate = new Date().toISOString().slice(0, 10);
  const branch = kind === 'big_three'
    ? { funnelVersion: 'big-three-synthesis-checkout-2026-08-v1', intent: 'self' }
    : kind === 'birth_chart'
      ? { funnelVersion: 'birth-chart-evidence-checkout-2026-08-v2', intent: 'self' }
      : { funnelVersion: 'daily-horoscope-transit-checkout-2026-08-v1', focus: 'overall', dateKey: currentDate };
  return new Request('https://reading.deckaura.com/api/readings/intent', {
    method: 'POST',
    headers: { Origin: 'https://deckaura.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind,
      tier: 'essential',
      question: 'What grounded pattern should I understand from this chart?',
      readingId: READING_ID,
      snapshot,
      ...branch,
    }),
  });
}

test('astrology checkout routes reject DST gaps and folds before Shopify or persistence', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSql = globalThis.__deckauraSql;
  const originalSecret = process.env.ENTITLEMENT_PEPPER;
  let storefrontRequests = 0;
  let databaseWrites = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.__deckauraSql = originalSql;
    if (originalSecret === undefined) delete process.env.ENTITLEMENT_PEPPER;
    else process.env.ENTITLEMENT_PEPPER = originalSecret;
  });
  process.env.ENTITLEMENT_PEPPER = 'astro-local-time-route-secret';
  globalThis.fetch = async () => {
    storefrontRequests += 1;
    throw new Error('Shopify must not be called for invalid civil time');
  };
  const sql = async () => {
    databaseWrites += 1;
    throw new Error('DB must not be called for invalid civil time');
  };
  sql.json = (value) => value;
  globalThis.__deckauraSql = sql;
  const { POST } = await loadRoute();

  const cases = [
    ['big_three', birth('exact', '2024-03-10', '02:30', 'America/New_York'), {
      error: 'big_three_birth_time_invalid', code: 'BIG_THREE_LOCAL_TIME_NONEXISTENT', correctionRequired: true,
    }],
    ['big_three', birth('approximate', '2024-11-03', '01:10', 'America/New_York'), {
      error: 'big_three_birth_time_invalid', code: 'BIG_THREE_LOCAL_TIME_AMBIGUOUS', correctionRequired: true,
    }],
    ['birth_chart', birth('exact', '2024-03-31', '02:30', 'Europe/Berlin'), {
      error: 'birth_chart_birth_time_invalid', code: 'BIRTH_CHART_LOCAL_TIME_NONEXISTENT', correctionRequired: true,
    }],
    ['birth_chart', birth('approximate', '2024-10-27', '02:30', 'Europe/Berlin'), {
      error: 'birth_chart_birth_time_invalid', code: 'BIRTH_CHART_LOCAL_TIME_AMBIGUOUS', correctionRequired: true,
    }],
    ['birth_chart', birth('exact', '1990-01-01', '12:00', 'Mars/Olympus'), {
      error: 'birth_chart_birth_time_invalid', code: 'BIRTH_CHART_TIMEZONE_INVALID', correctionRequired: true,
    }],
    ['daily_horoscope', birth('exact', '2024-10-06', '02:15', 'Australia/Lord_Howe'), {
      error: 'daily_horoscope_birth_time_invalid', code: 'DAILY_HOROSCOPE_LOCAL_TIME_NONEXISTENT', correctionRequired: true,
    }],
    ['daily_horoscope', birth('approximate', '2024-04-07', '01:45', 'Australia/Lord_Howe'), {
      error: 'daily_horoscope_birth_time_invalid', code: 'DAILY_HOROSCOPE_LOCAL_TIME_AMBIGUOUS', correctionRequired: true,
    }],
  ];
  for (const [kind, submittedBirth, expected] of cases) {
    const response = await POST(routeRequest(kind, { birth: submittedBirth }));
    assert.equal(response.status, 422, kind);
    assert.deepEqual(await response.json(), expected, kind);
  }
  assert.equal(storefrontRequests, 0);
  assert.equal(databaseWrites, 0);
});
