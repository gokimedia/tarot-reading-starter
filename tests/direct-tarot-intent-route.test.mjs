import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  BIRTH_CARD_DIRECT_CONFIDENCE,
  BIRTH_CARD_DIRECT_PAGE,
  BIRTH_CARD_DIRECT_PRESENTATION_VARIANT,
  BIRTH_CARD_DIRECT_SCOPE,
  BIRTH_CARD_DIRECT_SPREAD,
  BIRTH_CARD_DIRECT_TYPE,
  CAREER_DIRECT_CONFIDENCE,
  CAREER_DIRECT_PAGE,
  CAREER_DIRECT_PRESENTATION_VARIANT,
  CAREER_DIRECT_SCOPE,
  CAREER_DIRECT_SPREAD,
  CAREER_DIRECT_TYPE,
  LOVE_DIRECT_CONFIDENCE,
  LOVE_DIRECT_PAGE,
  LOVE_DIRECT_PRESENTATION_VARIANT,
  LOVE_DIRECT_SCOPE,
  LOVE_DIRECT_SPREAD,
  LOVE_DIRECT_TYPE,
  YES_NO_DIRECT_CONFIDENCE,
  YES_NO_DIRECT_PAGE,
  YES_NO_DIRECT_PRESENTATION_VARIANT,
  YES_NO_DIRECT_SCOPE,
  YES_NO_DIRECT_SPREAD,
  YES_NO_DIRECT_TYPE,
  calculateTarotSchoolBirthCards,
  canonicalYesNoDirectEvidence,
} from '../lib/direct-tarot-tools.mjs';
import { sevenCardHorseshoeVisitorAuthority } from '../lib/seven-card-horseshoe-compact.mjs';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const READING_ID = 'direct_route_reading_20260816';
const VISITOR_ID = 'direct-route-visitor-20260816';
const INTENT_TTL_MS = 86_400_000;
const PRODUCTS = Object.freeze({
  yes: Object.freeze({ variantId: '53675061838097', sku: 'READING-DEEP', price: 5.99 }),
  love: Object.freeze({ variantId: '53782500409617', sku: 'READING-DEEP', price: 5.99 }),
  career: Object.freeze({ variantId: '53675061838097', sku: 'READING-DEEP', price: 5.99 }),
  birth: Object.freeze({ variantId: '53782498509073', sku: 'READING-DEEP', price: 5.99 }),
});

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
    routePromise = import(`../app/api/readings/intent/route.ts?direct-route=${Date.now()}`);
  }
  return routePromise;
}

function snapshotBase({ type, question, context = '', signals, spread, scope, confidence, tool, presentationVariant }) {
  return {
    version: 'reading-snapshot-v2', type, question, context, signals, cards: signals,
    spread, scope, confidence, focus: '', tool, curiosityQuestion: '', presentationVariant,
    readingId: READING_ID,
  };
}

function yesSnapshot(overrides = {}) {
  const evidence = canonicalYesNoDirectEvidence('The Star');
  return {
    ...snapshotBase({
      type: YES_NO_DIRECT_TYPE,
      question: 'Should I accept this clear offer now?',
      signals: evidence.signals,
      spread: YES_NO_DIRECT_SPREAD,
      scope: YES_NO_DIRECT_SCOPE,
      confidence: YES_NO_DIRECT_CONFIDENCE,
      tool: YES_NO_DIRECT_PAGE,
      presentationVariant: YES_NO_DIRECT_PRESENTATION_VARIANT,
    }),
    ...overrides,
  };
}

function loveSnapshot(overrides = {}) {
  const signals = 'Your Energy: The Star Upright; Connection Dynamic: Justice Reversed; Grounded Next Step: The Sun Upright';
  return {
    ...snapshotBase({
      type: LOVE_DIRECT_TYPE,
      question: 'İletişimimizdeki',
      context: 'Yalnızca karşılıklı ve gözlemlenebilir davranışlara odaklanmak istiyorum.',
      signals,
      spread: LOVE_DIRECT_SPREAD,
      scope: LOVE_DIRECT_SCOPE,
      confidence: LOVE_DIRECT_CONFIDENCE,
      tool: LOVE_DIRECT_PAGE,
      presentationVariant: LOVE_DIRECT_PRESENTATION_VARIANT,
    }),
    ...overrides,
  };
}

function careerSnapshot(overrides = {}) {
  const signals = 'Current Position: The Fool Upright; Deciding Factor: The Magician Reversed; Best Next Step: The World Upright';
  return {
    ...snapshotBase({
      type: CAREER_DIRECT_TYPE,
      question: 'Opportunity',
      signals,
      spread: CAREER_DIRECT_SPREAD,
      scope: CAREER_DIRECT_SCOPE,
      confidence: CAREER_DIRECT_CONFIDENCE,
      tool: CAREER_DIRECT_PAGE,
      presentationVariant: CAREER_DIRECT_PRESENTATION_VARIANT,
    }),
    ...overrides,
  };
}

function birthSnapshot(overrides = {}) {
  const evidence = calculateTarotSchoolBirthCards('1949-12-23');
  return {
    ...snapshotBase({
      type: BIRTH_CARD_DIRECT_TYPE,
      question: '',
      signals: evidence.signals,
      spread: BIRTH_CARD_DIRECT_SPREAD,
      scope: BIRTH_CARD_DIRECT_SCOPE,
      confidence: BIRTH_CARD_DIRECT_CONFIDENCE,
      tool: BIRTH_CARD_DIRECT_PAGE,
      presentationVariant: BIRTH_CARD_DIRECT_PRESENTATION_VARIANT,
    }),
    birthDate: evidence.birthDate,
    calculationMethod: evidence.calculationMethod,
    calculationTrace: evidence.calculationTrace,
    birthCardSequence: evidence.cards.map((card) => ({ label: card.position, number: card.number, name: card.card })),
    ...overrides,
  };
}

function routeBody(kind, snapshot, overrides = {}) {
  const product = PRODUCTS[kind];
  return {
    kind: 'shared_tool',
    page: snapshot.tool,
    toolType: snapshot.type,
    tier: 'essential',
    expectedVariantId: product.variantId,
    funnelVersion: 'enterprise-shared-tools-2026-08-v1',
    question: snapshot.question,
    readingId: snapshot.readingId,
    locale: 'en-US', country: 'US', currency: 'USD', market: 'us',
    snapshot,
    displayedQuote: { variantId: product.variantId, sku: product.sku, priceCents: 599, currency: 'USD', country: 'US' },
    ...overrides,
  };
}

function fallbackBody(kind, snapshot, transportFailure = 'http_429', overrides = {}) {
  return routeBody(kind, snapshot, { transportFallback: true, transportFailure, ...overrides });
}

function request(body) {
  return new Request('https://reading.deckaura.com/api/readings/intent', {
    method: 'POST',
    headers: { Origin: 'https://deckaura.com', 'Content-Type': 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
    body: JSON.stringify(body),
  });
}

function storefrontResponse(requestBody, quote = {}) {
  const variantId = String(requestBody.variables?.id || '').split('/').at(-1);
  const product = Object.values(PRODUCTS).find((entry) => entry.variantId === variantId);
  assert.ok(product, `unexpected variant ${variantId}`);
  return Response.json({
    data: {
      node: {
        id: `gid://shopify/ProductVariant/${variantId}`,
        sku: product.sku,
        availableForSale: true,
        requiresShipping: false,
        price: { amount: quote.amount || product.price.toFixed(2), currencyCode: quote.currency || 'USD' },
        product: { onlineStoreUrl: 'https://deckaura.com/products/personalized-tarot-reading' },
      },
    },
  });
}

test('direct route accepts canonical underscore reading IDs, allows only bounded preview transport failures, fails policy before quote, and creates 24h immutable intents', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSql = globalThis.__deckauraSql;
  const originalWarn = console.warn;
  const environmentKeys = ['ENTITLEMENT_PEPPER', 'FREE_ENTITLEMENT_SALT', 'SHOPIFY_WEBHOOK_SECRET', 'SHOPIFY_STORE', 'SHOPIFY_STOREFRONT_HOST', 'SHOPIFY_STOREFRONT_API_VERSION', 'SHOPIFY_STOREFRONT_ACCESS_TOKEN'];
  const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const inserts = [];
  const fetches = [];
  const logs = [];
  const kvValues = new Map();
  let quote = {};
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.__deckauraSql = originalSql;
    console.warn = originalWarn;
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  });
  process.env.ENTITLEMENT_PEPPER = 'direct-route-test-pepper';
  process.env.SHOPIFY_STORE = 'deckaura.myshopify.com';
  process.env.SHOPIFY_STOREFRONT_HOST = 'deckaura.com';
  process.env.SHOPIFY_STOREFRONT_API_VERSION = '2026-07';
  delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  console.warn = (...values) => logs.push(values.map(String).join(' '));
  const sql = async (strings, ...values) => {
    const query = strings.join(' ');
    if (query.includes('from deckaura.kv_store') && query.includes('select value')) {
      const value = kvValues.get(String(values[0]));
      return value == null ? [] : [{ value }];
    }
    if (query.includes('insert into deckaura.checkout_intents')) {
      const persistedPage = String(values[2]);
      const persistedCardId = Number(values[11]);
      const persistedIntentKind = String(values[18]);
      const cardIdentityAccepted = persistedIntentKind !== 'shared_tool'
        || (persistedPage === YES_NO_DIRECT_PAGE
          ? Number.isInteger(persistedCardId) && persistedCardId >= 1 && persistedCardId <= 78
          : persistedCardId === 0);
      if (!cardIdentityAccepted) {
        throw new Error('new row violates check constraint checkout_intents_card_id');
      }
      inserts.push({ values, snapshot: values.find((value) => value?.__testJson)?.__testJson });
      return [];
    }
    throw new Error(`Unexpected SQL: ${query.slice(0, 100)}`);
  };
  sql.json = (value) => ({ __testJson: value });
  globalThis.__deckauraSql = sql;
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body));
    fetches.push(body);
    return storefrontResponse(body, quote);
  };
  const { POST } = await loadRoute();

  for (const transportFailure of ['http_429', 'http_5xx', 'http_408', 'timeout']) {
    const started = Date.now();
    const response = await POST(request(fallbackBody('yes', yesSnapshot(), transportFailure)));
    const payload = await response.json();
    assert.equal(response.status, 201, `${transportFailure}: ${JSON.stringify(payload)}`);
    assert.equal(new Date(payload.expiresAt).getTime() - started <= INTENT_TTL_MS + 2_000, true);
    assert.equal(new Date(payload.expiresAt).getTime() - started >= INTENT_TTL_MS - 2_000, true);
    assert.equal(inserts.at(-1).snapshot.transportFallback, true);
    assert.equal(inserts.at(-1).snapshot.transportFailure, transportFailure);
    assert.equal(inserts.at(-1).snapshot.answer, 'YES');
  }
  assert.equal(inserts.length, 4);
  assert.equal(inserts[0].values[2], YES_NO_DIRECT_PAGE);
  assert.equal(inserts[0].values[18], 'shared_tool');
  assert.equal(inserts[0].values[11], inserts[0].snapshot.card.id);
  assert.equal(Number.isInteger(inserts[0].values[11]), true);
  assert.equal(inserts[0].values[11] >= 1 && inserts[0].values[11] <= 78, true);

  const token = 'b'.repeat(32);
  const visitorAuthority = await sevenCardHorseshoeVisitorAuthority(VISITOR_ID, process.env.ENTITLEMENT_PEPPER);
  const previewSnapshot = yesSnapshot();
  kvValues.set(`preview:${token}`, JSON.stringify({
    schemaVersion: 2,
    snapshotVersion: 'reading-snapshot-v2',
    readingId: READING_ID,
    fields: { ...previewSnapshot, locale: 'en-US', country: 'US', currency: 'USD', market: 'us' },
    question: previewSnapshot.question,
    ownerVisitorHash: visitorAuthority.visitorName,
    createdAt: new Date().toISOString(),
  }));
  kvValues.set(visitorAuthority.sessionKey, JSON.stringify({
    token,
    approvalStatus: 'approved',
    offerBlocked: false,
    safety: false,
    expiresAt: Date.now() + 86_400_000,
    fields: { presentationVariant: YES_NO_DIRECT_PRESENTATION_VARIANT, readingId: READING_ID },
  }));
  const normalResponse = await POST(request(routeBody('yes', previewSnapshot, { previewToken: token, visitorId: VISITOR_ID })));
  const normalPayload = await normalResponse.json();
  assert.equal(normalResponse.status, 201, JSON.stringify(normalPayload));
  assert.equal(inserts.at(-1).snapshot.transportFallback, false);
  assert.equal(inserts.at(-1).snapshot.localeContext.country, 'US');
  const localeMismatch = await POST(request(routeBody('yes', previewSnapshot, { previewToken: token, visitorId: VISITOR_ID, country: 'DE' })));
  const localeMismatchPayload = await localeMismatch.json();
  assert.equal(localeMismatch.status, 422);
  assert.equal(localeMismatchPayload.code, 'DIRECT_TAROT_PREVIEW_EXPIRED_OR_INVALID');

  for (const [label, body, code] of [
    ['normal missing token', routeBody('yes', yesSnapshot()), 'DIRECT_TAROT_PREVIEW_TOKEN_INVALID'],
    ['generic network not allowed', fallbackBody('yes', yesSnapshot(), 'network'), 'DIRECT_TAROT_TRANSPORT_FALLBACK_INVALID'],
    ['unsafe fallback', fallbackBody('yes', yesSnapshot({ question: 'Will I kill myself tonight?' }), 'http_429', { question: 'Will I kill myself tonight?' }), 'DIRECT_TAROT_SAFETY_BLOCKED'],
    ['Yes/No private-state fallback', fallbackBody('yes', yesSnapshot({ question: 'Does she really love me today?' }), 'http_429'), 'DIRECT_TAROT_SAFETY_BLOCKED'],
    ['Yes/No financial fallback', fallbackBody('yes', yesSnapshot({ question: 'Should I invest my life savings now?' }), 'http_5xx'), 'DIRECT_TAROT_SAFETY_BLOCKED'],
    ['Career legal fallback', fallbackBody('career', careerSnapshot({ question: 'Should I sign the contract in this lawsuit?' }), 'http_408'), 'DIRECT_TAROT_SAFETY_BLOCKED'],
    ['Career health fallback', fallbackBody('career', careerSnapshot({ question: 'Should I resign because of this workplace injury?' }), 'timeout'), 'DIRECT_TAROT_SAFETY_BLOCKED'],
    ['malformed evidence', fallbackBody('yes', yesSnapshot({ signals: canonicalYesNoDirectEvidence('The Star').signals.replace('Directional Lean: YES', 'Directional Lean: NO'), cards: canonicalYesNoDirectEvidence('The Star').signals.replace('Directional Lean: YES', 'Directional Lean: NO') }), 'http_5xx'), 'DIRECT_TAROT_EVIDENCE_MISMATCH'],
    ['mutated Yes/No reason', fallbackBody('yes', yesSnapshot({ signals: canonicalYesNoDirectEvidence('The Star').signals.replace(/Why: [^;]+/, 'Why: Client supplied reason'), cards: canonicalYesNoDirectEvidence('The Star').signals.replace(/Why: [^;]+/, 'Why: Client supplied reason') }), 'http_5xx'), 'DIRECT_TAROT_EVIDENCE_MISMATCH'],
    ['mutated Yes/No control', fallbackBody('yes', yesSnapshot({ signals: canonicalYesNoDirectEvidence('The Star').signals.replace(/User Control: [^;]+/, 'User Control: Client supplied instruction'), cards: canonicalYesNoDirectEvidence('The Star').signals.replace(/User Control: [^;]+/, 'User Control: Client supplied instruction') }), 'http_5xx'), 'DIRECT_TAROT_EVIDENCE_MISMATCH'],
  ]) {
    const beforeFetches = fetches.length;
    const response = await POST(request(body));
    const payload = await response.json();
    assert.equal(response.status, 422, label);
    assert.equal(payload.code, code, label);
    assert.equal(fetches.length, beforeFetches, `${label} must fail before Shopify`);
    assert.equal(inserts.length, 5, `${label} must not persist`);
  }

  for (const [kind, snapshot] of [['love', loveSnapshot()], ['career', careerSnapshot()]]) {
    const response = await POST(request(fallbackBody(kind, snapshot, 'http_5xx')));
    const payload = await response.json();
    assert.equal(response.status, 201, `${kind}: ${JSON.stringify(payload)}`);
    assert.equal(inserts.at(-1).snapshot.question, snapshot.question);
    assert.equal(inserts.at(-1).snapshot.curiosityQuestion, '');
  }

  const birth = birthSnapshot();
  const birthResponse = await POST(request(routeBody('birth', birth)));
  const birthPayload = await birthResponse.json();
  assert.equal(birthResponse.status, 201, JSON.stringify(birthPayload));
  assert.deepEqual(inserts.at(-1).snapshot.birthCardSequence, birth.birthCardSequence);
  assert.equal(inserts.at(-1).snapshot.transportFallback, undefined);
  const forbiddenBirth = await POST(request(routeBody('birth', birth, { previewToken: 'a'.repeat(32) })));
  const forbiddenBirthPayload = await forbiddenBirth.json();
  assert.equal(forbiddenBirth.status, 422);
  assert.equal(forbiddenBirthPayload.code, 'DIRECT_TAROT_PREVIEW_NOT_ALLOWED');

  quote = { amount: '6.49', currency: 'USD' };
  const changed = fallbackBody('yes', yesSnapshot(), 'http_429');
  const changedResponse = await POST(request(changed));
  const changedPayload = await changedResponse.json();
  assert.equal(changedResponse.status, 409);
  assert.deepEqual(changedPayload, {
    error: 'checkout_price_changed',
    code: 'DIRECT_TAROT_QUOTE_CHANGED',
    confirmationRequired: true,
    checkoutQuote: { variantId: PRODUCTS.yes.variantId, sku: PRODUCTS.yes.sku, price: 6.49, priceCents: 649, currency: 'USD', country: 'US' },
  });
  const beforeConfirmation = inserts.length;
  changed.displayedQuote = { variantId: PRODUCTS.yes.variantId, sku: PRODUCTS.yes.sku, priceCents: 649, currency: 'USD', country: 'US' };
  const confirmed = await POST(request(changed));
  assert.equal(confirmed.status, 201, JSON.stringify(await confirmed.clone().json()));
  assert.equal(inserts.length, beforeConfirmation + 1);
  assert.equal(inserts.at(-1).snapshot.checkoutQuote.priceCents, 649);

  const joinedLogs = logs.join('\n');
  assert.doesNotMatch(joinedLogs, /Should I accept|kill myself|The Star|İletişimimizdeki|Opportunity/);
  assert.doesNotMatch(joinedLogs, /"(?:question|context|cards|snapshot|token)"\s*:/i);
});
