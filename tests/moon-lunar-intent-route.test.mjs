import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  MOON_LUNAR_FUNNEL_VERSION,
  MOON_LUNAR_PAGE,
  MOON_LUNAR_SNAPSHOT_VERSION,
  moonLunarCurrentSnapshot,
} from '../lib/moon-lunar.ts';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const PRODUCT = Object.freeze({ variantId: '53782500081937', sku: 'READING-DEEP', price: 5.99 });
const QUESTION = 'What should I understand before making this reversible choice?';
const READING_ID = 'moon-route-reading-20260903';

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
    routePromise = import(`../app/api/readings/intent/route.ts?moon-route=${Date.now()}`);
  }
  return routePromise;
}

function moonSnapshot() {
  const capturedAt = new Date();
  const current = moonLunarCurrentSnapshot(capturedAt);
  assert.ok(current);
  return {
    version: MOON_LUNAR_SNAPSHOT_VERSION,
    capturedAt: capturedAt.toISOString(),
    focus: 'decision',
    situation: QUESTION,
    packageTier: 'standard',
    current,
    card: { id: 7, name: 'The Lovers' },
    birth: {
      date: '1990-01-01',
      time: '12:00',
      status: 'exact',
      place: 'Berlin, Germany',
      timezone: 'Europe/Berlin',
    },
  };
}

function routeBody(displayedQuote) {
  return {
    kind: 'moon_lunar',
    tier: 'essential',
    funnelVersion: MOON_LUNAR_FUNNEL_VERSION,
    readingId: READING_ID,
    focus: 'decision',
    question: QUESTION,
    locale: 'de-DE',
    country: 'DE',
    currency: 'EUR',
    market: 'de',
    snapshot: moonSnapshot(),
    ...(displayedQuote === undefined ? {} : { displayedQuote }),
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

test('Moon intent requires the displayed localized quote, reconfirms drift, and signs exact presentment', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSql = globalThis.__deckauraSql;
  const originalWarn = console.warn;
  const environmentKeys = ['ENTITLEMENT_PEPPER', 'FREE_ENTITLEMENT_SALT', 'SHOPIFY_WEBHOOK_SECRET', 'SHOPIFY_STORE', 'SHOPIFY_STOREFRONT_HOST', 'SHOPIFY_STOREFRONT_API_VERSION', 'SHOPIFY_STOREFRONT_ACCESS_TOKEN'];
  const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const inserts = [];
  const logs = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.__deckauraSql = originalSql;
    console.warn = originalWarn;
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  });
  process.env.ENTITLEMENT_PEPPER = 'moon-route-test-pepper';
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
  globalThis.fetch = async (_url, init = {}) => storefrontResponse(JSON.parse(String(init.body)));
  const { POST } = await loadRoute();

  const missingResponse = await POST(request(routeBody(undefined)));
  assert.equal(missingResponse.status, 422);
  assert.equal((await missingResponse.json()).code, 'MOON_LUNAR_DISPLAYED_QUOTE_INVALID');
  assert.equal(inserts.length, 0);

  const staleQuote = { variantId: PRODUCT.variantId, sku: PRODUCT.sku, priceCents: 599, currency: 'EUR', country: 'DE' };
  const changedResponse = await POST(request(routeBody(staleQuote)));
  const changedPayload = await changedResponse.json();
  assert.equal(changedResponse.status, 409);
  assert.deepEqual(changedPayload, {
    error: 'checkout_price_changed',
    code: 'MOON_LUNAR_QUOTE_CHANGED',
    confirmationRequired: true,
    checkoutQuote: { ...PRODUCT, price: 5.49, priceCents: 549, currency: 'EUR', country: 'DE' },
  });
  assert.equal(inserts.length, 0);

  const confirmedQuote = { variantId: PRODUCT.variantId, sku: PRODUCT.sku, priceCents: 549, currency: 'EUR', country: 'DE' };
  const confirmedResponse = await POST(request(routeBody(confirmedQuote)));
  const confirmedPayload = await confirmedResponse.json();
  assert.equal(confirmedResponse.status, 201, JSON.stringify(confirmedPayload));
  assert.equal(confirmedPayload.variantId, PRODUCT.variantId);
  assert.equal(confirmedPayload.localeContext.country, 'DE');
  assert.equal(confirmedPayload.localeContext.currency, 'EUR');
  assert.equal(confirmedPayload.checkoutQuote.intentId, confirmedPayload.intentId);
  assert.equal(confirmedPayload.checkoutQuote.priceCents, 549);
  assert.equal(confirmedPayload.checkoutQuote.currency, 'EUR');
  assert.equal(confirmedPayload.checkoutQuote.country, 'DE');
  assert.equal(confirmedPayload.checkoutQuote.snapshotHash, confirmedPayload.snapshotHash);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].values[2], MOON_LUNAR_PAGE);
  assert.equal(inserts[0].values[18], 'moon_lunar');
  assert.deepEqual(inserts[0].snapshot.checkoutQuote, {
    intentId: confirmedPayload.intentId,
    variantId: PRODUCT.variantId,
    sku: PRODUCT.sku,
    priceCents: 549,
    currency: 'EUR',
    country: 'DE',
  });
  assert.equal(inserts[0].snapshot.localeContext.currency, 'EUR');
  assert.equal(inserts[0].snapshot.localeContext.country, 'DE');
  assert.doesNotMatch(logs.join('\n'), new RegExp(QUESTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
