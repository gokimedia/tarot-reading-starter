import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { EclipticGeoMoon, SiderealTime, SunPosition } from 'astronomy-engine';
import {
  BIG_THREE_FUNNEL_VERSION,
  BIG_THREE_PAGE,
  BIG_THREE_SNAPSHOT_VERSION,
} from '../lib/big-three.ts';
import { resolveIanaLocalDateBounds, resolveIanaLocalDateTime } from '../lib/iana-local-time.mjs';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const PRODUCT = Object.freeze({ variantId: '53782498705681', sku: 'READING-DEEP', price: 5.99 });
const QUESTION = 'Which part of my Big Three should guide this reversible choice?';
const READING_ID = 'big-three-quote-reading-20260903';

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
    routePromise = import(`../app/api/readings/intent/route.ts?big-three-quote=${Date.now()}`);
  }
  return routePromise;
}

function normalize(value) {
  return ((value % 360) + 360) % 360;
}

function ascendant(date, latitude, longitudeEast) {
  const julian = date.getTime() / 86_400_000 + 2_440_587.5;
  const t = (julian - 2_451_545) / 36_525;
  const ramc = normalize(SiderealTime(date) * 15 + longitudeEast) * Math.PI / 180;
  const obliquity = (23.4392911 - 0.0130042 * t) * Math.PI / 180;
  const latitudeRadians = latitude * Math.PI / 180;
  return normalize(Math.atan2(
    Math.cos(ramc),
    -(Math.sin(ramc) * Math.cos(obliquity) + Math.tan(latitudeRadians) * Math.sin(obliquity)),
  ) * 180 / Math.PI);
}

function bigThreeSnapshot() {
  const date = '1990-01-01';
  const time = '12:00';
  const timezone = 'Europe/Berlin';
  const latitude = 52.52;
  const longitude = 13.405;
  const resolution = resolveIanaLocalDateTime(date, time, timezone);
  const bounds = resolveIanaLocalDateBounds(date, timezone);
  assert.equal(resolution?.status, 'unique');
  assert.equal(bounds?.status, 'valid');
  const instant = new Date(resolution.candidates[0]);
  const start = new Date(bounds.start);
  const end = new Date(bounds.end);
  return {
    version: BIG_THREE_SNAPSHOT_VERSION,
    focus: 'self',
    birth: {
      date,
      time,
      status: 'exact',
      place: { name: 'Berlin', region: 'Germany', latitude, longitude, timezone },
    },
    placements: {
      sun: { longitude: normalize(SunPosition(instant).elon) },
      moon: {
        longitude: normalize(EclipticGeoMoon(instant).lon),
        startLongitude: normalize(EclipticGeoMoon(start).lon),
        endLongitude: normalize(EclipticGeoMoon(end).lon),
        ambiguous: false,
      },
      rising: { longitude: ascendant(instant, latitude, longitude) },
    },
  };
}

function routeBody(displayedQuote, includeDisplayedQuote = true) {
  return {
    kind: 'big_three',
    tier: 'essential',
    funnelVersion: BIG_THREE_FUNNEL_VERSION,
    readingId: READING_ID,
    intent: 'self',
    question: QUESTION,
    locale: 'de-DE',
    country: 'DE',
    currency: 'EUR',
    market: 'de',
    snapshot: bigThreeSnapshot(),
    ...(includeDisplayedQuote ? { displayedQuote } : {}),
  };
}

function request(body) {
  return new Request('https://reading.deckaura.com/api/readings/intent', {
    method: 'POST',
    headers: { Origin: 'https://deckaura.com', 'Content-Type': 'application/json', 'Accept-Language': 'de-DE,de;q=0.9' },
    body: JSON.stringify(body),
  });
}

function storefrontResponse(requestBody, amount = '5.49', currency = 'EUR') {
  const variantId = String(requestBody.variables?.id || '').split('/').at(-1);
  assert.equal(variantId, PRODUCT.variantId);
  assert.equal(requestBody.variables?.country, 'DE');
  return Response.json({
    data: {
      node: {
        id: `gid://shopify/ProductVariant/${variantId}`,
        sku: PRODUCT.sku,
        availableForSale: true,
        requiresShipping: false,
        price: { amount, currencyCode: currency },
        product: { onlineStoreUrl: 'https://deckaura.com/products/personalized-tarot-reading' },
      },
    },
  });
}

test('Big Three keeps the live legacy request compatible and signs an opted-in localized quote', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSql = globalThis.__deckauraSql;
  const originalWarn = console.warn;
  const environmentKeys = ['ENTITLEMENT_PEPPER', 'FREE_ENTITLEMENT_SALT', 'SHOPIFY_WEBHOOK_SECRET', 'SHOPIFY_STORE', 'SHOPIFY_STOREFRONT_HOST', 'SHOPIFY_STOREFRONT_API_VERSION', 'SHOPIFY_STOREFRONT_ACCESS_TOKEN'];
  const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const inserts = [];
  const logs = [];
  let storefrontRequests = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.__deckauraSql = originalSql;
    console.warn = originalWarn;
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  });
  process.env.ENTITLEMENT_PEPPER = 'big-three-quote-test-pepper';
  process.env.SHOPIFY_STORE = 'deckaura.myshopify.com';
  process.env.SHOPIFY_STOREFRONT_HOST = 'deckaura.com';
  process.env.SHOPIFY_STOREFRONT_API_VERSION = '2026-07';
  delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  console.warn = (...values) => logs.push(values.map(String).join(' '));
  const sql = async (strings, ...values) => {
    const query = strings.join(' ');
    if (query.includes('insert into deckaura.checkout_intents')) {
      inserts.push({ values, snapshot: values.find((value) => value?.__testJson)?.__testJson });
      return [];
    }
    throw new Error(`Unexpected SQL: ${query.slice(0, 100)}`);
  };
  sql.json = (value) => ({ __testJson: value });
  globalThis.__deckauraSql = sql;
  globalThis.fetch = async (_url, init = {}) => {
    storefrontRequests += 1;
    return storefrontResponse(JSON.parse(String(init.body)));
  };
  const { POST } = await loadRoute();

  const legacyResponse = await POST(request(routeBody(undefined, false)));
  const legacyPayload = await legacyResponse.json();
  assert.equal(legacyResponse.status, 201, JSON.stringify(legacyPayload));
  assert.equal(legacyPayload.checkoutQuote, undefined);
  assert.equal(storefrontRequests, 0, 'the currently live legacy request stays compatible during rollout');
  assert.equal(inserts.length, 1);

  const missingResponse = await POST(request(routeBody(null)));
  assert.equal(missingResponse.status, 422);
  assert.equal((await missingResponse.json()).code, 'BIG_THREE_DISPLAYED_QUOTE_INVALID');
  assert.equal(inserts.length, 1);

  const staleQuote = { variantId: PRODUCT.variantId, sku: PRODUCT.sku, priceCents: 599, currency: 'EUR', country: 'DE' };
  const changedResponse = await POST(request(routeBody(staleQuote)));
  assert.equal(changedResponse.status, 409);
  assert.deepEqual(await changedResponse.json(), {
    error: 'checkout_price_changed',
    code: 'BIG_THREE_QUOTE_CHANGED',
    confirmationRequired: true,
    checkoutQuote: { ...PRODUCT, price: 5.49, priceCents: 549, currency: 'EUR', country: 'DE' },
  });
  assert.equal(inserts.length, 1);

  const confirmedQuote = { variantId: PRODUCT.variantId, sku: PRODUCT.sku, priceCents: 549, currency: 'EUR', country: 'DE' };
  const confirmedResponse = await POST(request(routeBody(confirmedQuote)));
  const confirmedPayload = await confirmedResponse.json();
  assert.equal(confirmedResponse.status, 201, JSON.stringify(confirmedPayload));
  assert.equal(confirmedPayload.variantId, PRODUCT.variantId);
  assert.equal(confirmedPayload.checkoutQuote.intentId, confirmedPayload.intentId);
  assert.equal(confirmedPayload.checkoutQuote.priceCents, 549);
  assert.equal(confirmedPayload.checkoutQuote.currency, 'EUR');
  assert.equal(confirmedPayload.checkoutQuote.country, 'DE');
  assert.equal(confirmedPayload.checkoutQuote.snapshotHash, confirmedPayload.snapshotHash);
  assert.equal(inserts.length, 2);
  assert.equal(inserts[1].values[2], BIG_THREE_PAGE);
  assert.equal(inserts[1].values[18], 'big_three');
  assert.deepEqual(inserts[1].snapshot.checkoutQuote, {
    intentId: confirmedPayload.intentId,
    variantId: PRODUCT.variantId,
    sku: PRODUCT.sku,
    priceCents: 549,
    currency: 'EUR',
    country: 'DE',
  });
  assert.equal(inserts[1].snapshot.localeContext.currency, 'EUR');
  assert.equal(inserts[1].snapshot.localeContext.country, 'DE');
  assert.doesNotMatch(logs.join('\n'), new RegExp(QUESTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
