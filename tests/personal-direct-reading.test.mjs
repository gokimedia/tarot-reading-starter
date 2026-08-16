import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { checkoutIntentSnapshotHash } from '../lib/checkout-intent-persistence.mjs';
import {
  SHARED_TOOL_FUNNEL_VERSION,
  SHARED_TOOL_PAGE_ALLOWED_TIERS,
  sharedToolContract,
} from '../lib/generated/shared-tool-manifest.mjs';
import {
  PERSONAL_DIRECT_CONFIDENCE,
  PERSONAL_DIRECT_CONTEXT_MAX_LENGTH,
  PERSONAL_DIRECT_PAGE,
  PERSONAL_DIRECT_POSITIONS,
  PERSONAL_DIRECT_PRESENTATION_VARIANT,
  PERSONAL_DIRECT_QUESTION_MAX_LENGTH,
  PERSONAL_DIRECT_QUESTION_MIN_LENGTH,
  PERSONAL_DIRECT_PUBLIC_ERROR_CODES,
  PERSONAL_DIRECT_SCOPE,
  PERSONAL_DIRECT_SPREAD,
  PERSONAL_DIRECT_TYPE,
  isPersonalDirectReading,
  paidQuestionLengthLimit,
  parsePersonalDirectCards,
  personalDirectQuestionPolicy,
  validatePersonalDirectSnapshot,
} from '../lib/personal-direct-reading.mjs';
import { readingCuriosityQuestion, validateReadingFields } from '../lib/legacy-worker.mjs';
import { verifySharedToolPaidOrder } from '../lib/shared-tool-order-contract.mjs';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const QUESTION = 'What should I understand about this decision and the most grounded next step?';
const LONG_QUESTION = Array(9).fill('What should I understand about the patterns, tradeoffs, timing, and practical next step in this decision?').join(' ').slice(0, 550).trim();
const CONTEXT = 'I have considered this choice for several weeks and want a practical perspective.';
const CARDS = 'Situation: The Fool Upright; Challenge: The Magician Reversed; Advice: The High Priestess Upright';
const READING_ID = 'personal-direct-20260816';
const INTENT_ID = '12345678-1234-4234-9234-123456789abc';
const SNAPSHOT_HASH = 'a'.repeat(64);

const PRODUCTS = Object.freeze({
  essential: Object.freeze({ paidTier: 'standard', variantId: '53782500606225', sku: 'READING-DEEP', price: 5.99 }),
  deeper: Object.freeze({ paidTier: 'medium', variantId: '53782500638993', sku: 'READING-MEDIUM', price: 9.99 }),
  indepth: Object.freeze({ paidTier: 'premium', variantId: '53782500671761', sku: 'READING-PREMIUM', price: 16.99 }),
});

function snapshot(overrides = {}) {
  return {
    version: 'reading-snapshot-v2',
    type: PERSONAL_DIRECT_TYPE,
    question: QUESTION,
    context: CONTEXT,
    signals: CARDS,
    cards: CARDS,
    spread: PERSONAL_DIRECT_SPREAD,
    scope: PERSONAL_DIRECT_SCOPE,
    confidence: PERSONAL_DIRECT_CONFIDENCE,
    focus: '',
    tool: PERSONAL_DIRECT_PAGE,
    curiosityQuestion: '',
    presentationVariant: PERSONAL_DIRECT_PRESENTATION_VARIANT,
    readingId: READING_ID,
    ...overrides,
  };
}

function paidOrder(storefrontTier = 'essential', overrides = {}) {
  const product = PRODUCTS[storefrontTier];
  const baseSnapshot = snapshot({
    localeContext: { locale: 'en-US', language: 'en', country: 'US', currency: 'USD', market: 'us' },
    checkoutQuote: {
      intentId: INTENT_ID,
      variantId: product.variantId,
      sku: product.sku,
      priceCents: Math.round(product.price * 100),
      currency: 'USD',
      country: 'US',
    },
  });
  return {
    row: {
      id: INTENT_ID,
      page: PERSONAL_DIRECT_PAGE,
      funnelVersion: SHARED_TOOL_FUNNEL_VERSION,
      readingId: READING_ID,
      readingType: PERSONAL_DIRECT_TYPE,
      question: QUESTION,
      tier: product.paidTier,
      variantId: product.variantId,
      sku: product.sku,
      price: product.price,
      snapshotHash: SNAPSHOT_HASH,
    },
    snapshot: baseSnapshot,
    line: {
      intentKind: 'shared_tool',
      toolPage: PERSONAL_DIRECT_PAGE,
      toolType: PERSONAL_DIRECT_TYPE,
      snapshotVersion: 'reading-snapshot-v2',
      snapshotHash: SNAPSHOT_HASH,
      presentmentAmount: product.price.toFixed(2),
      presentmentCurrency: 'USD',
    },
    ...overrides,
  };
}

let intentRoutePromise;
function loadIntentRoute() {
  if (!intentRoutePromise) {
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
    intentRoutePromise = import(`../app/api/readings/intent/route.ts?personal-direct-contract=${Date.now()}`);
  }
  return intentRoutePromise;
}

function routeBody(storefrontTier = 'essential', overrides = {}) {
  const product = PRODUCTS[storefrontTier];
  return {
    kind: 'shared_tool',
    page: PERSONAL_DIRECT_PAGE,
    toolType: PERSONAL_DIRECT_TYPE,
    tier: storefrontTier,
    expectedVariantId: product.variantId,
    funnelVersion: SHARED_TOOL_FUNNEL_VERSION,
    question: QUESTION,
    readingId: READING_ID,
    category: 'personal',
    locale: 'en-US',
    country: 'US',
    currency: 'USD',
    market: 'us',
    snapshot: snapshot(),
    displayedQuote: {
      variantId: product.variantId,
      sku: product.sku,
      priceCents: Math.round(product.price * 100),
      currency: 'USD',
      country: 'US',
    },
    ...overrides,
  };
}

function routeRequest(body) {
  return new Request('https://reading.deckaura.com/api/readings/intent', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json; charset=utf-8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify(body),
  });
}

function storefrontResponse(body, quoteByTier = {}) {
  const variables = body.variables || {};
  const variantId = String(variables.id || '').split('/').at(-1);
  const entry = Object.values(PRODUCTS).find((product) => product.variantId === variantId);
  assert.ok(entry, `unexpected variant ${variantId}`);
  const storefrontTier = Object.entries(PRODUCTS).find(([, product]) => product.variantId === variantId)[0];
  const localized = variables.country ? quoteByTier[storefrontTier] : null;
  const amount = localized?.amount || entry.price.toFixed(2);
  const currency = localized?.currency || 'USD';
  return Response.json({
    data: {
      node: {
        id: `gid://shopify/ProductVariant/${entry.variantId}`,
        sku: entry.sku,
        availableForSale: true,
        requiresShipping: false,
        price: { amount, currencyCode: currency },
        product: { onlineStoreUrl: 'https://deckaura.com/products/personalized-tarot-reading' },
      },
    },
  });
}

test('personal-direct-v1 is an exact paid-only three-card contract', () => {
  assert.equal(PERSONAL_DIRECT_QUESTION_MIN_LENGTH, 12);
  assert.equal(PERSONAL_DIRECT_QUESTION_MAX_LENGTH, 600);
  assert.equal(PERSONAL_DIRECT_CONTEXT_MAX_LENGTH, 1500);
  assert.deepEqual(PERSONAL_DIRECT_POSITIONS, ['Situation', 'Challenge', 'Advice']);
  assert.deepEqual(Object.values(PERSONAL_DIRECT_PUBLIC_ERROR_CODES), [
    'PERSONAL_DIRECT_TIER_UNSUPPORTED',
    'PERSONAL_DIRECT_QUESTION_INVALID',
    'PERSONAL_DIRECT_REQUEST_INVALID',
    'PERSONAL_DIRECT_CANONICAL_PAGE_INVALID',
    'PERSONAL_DIRECT_PRODUCT_CONTRACT_MISMATCH',
    'PERSONAL_DIRECT_SAFETY_BLOCKED',
    'PERSONAL_DIRECT_EVIDENCE_MISMATCH',
    'PERSONAL_DIRECT_DISPLAYED_QUOTE_INVALID',
    'PERSONAL_DIRECT_QUOTE_CHANGED',
  ]);
  assert.deepEqual(parsePersonalDirectCards(CARDS), [
    { position: 'Situation', card: 'The Fool', orientation: 'Upright' },
    { position: 'Challenge', card: 'The Magician', orientation: 'Reversed' },
    { position: 'Advice', card: 'The High Priestess', orientation: 'Upright' },
  ]);
  const validation = validatePersonalDirectSnapshot({
    page: PERSONAL_DIRECT_PAGE,
    toolType: PERSONAL_DIRECT_TYPE,
    presentationVariant: PERSONAL_DIRECT_PRESENTATION_VARIANT,
    snapshot: snapshot(),
  });
  assert.equal(validation.ok, true, validation.reason);
  assert.equal(validatePersonalDirectSnapshot({
    page: PERSONAL_DIRECT_PAGE,
    toolType: PERSONAL_DIRECT_TYPE,
    presentationVariant: PERSONAL_DIRECT_PRESENTATION_VARIANT,
    snapshot: snapshot({ context: '' }),
  }).ok, true, 'context is optional');
  assert.equal(isPersonalDirectReading(snapshot()), true);
  assert.equal(paidQuestionLengthLimit({
    ...snapshot(), toolPage: PERSONAL_DIRECT_PAGE, personalDirect: 1,
  }), 600);
  assert.equal(paidQuestionLengthLimit({
    ...snapshot(), tool: '/pages/free-tarot-reading', type: 'Tarot', toolPage: '/pages/free-tarot-reading', personalDirect: 0,
  }), 400);
  assert.equal(validateReadingFields({
    ...snapshot(), snapshotVersion: 'reading-snapshot-v2', funnelVersion: SHARED_TOOL_FUNNEL_VERSION,
  }).ok, true);
  assert.equal(readingCuriosityQuestion(snapshot(), 'en'), '');
});

test('the 600-character paid question allowance cannot widen any existing reading flow', () => {
  const legacyFields = {
    tool: '/pages/free-tarot-reading',
    toolPage: '/pages/free-tarot-reading',
    type: 'Tarot',
    presentationVariant: 'compact-direct-tier',
    personalDirect: 0,
  };
  const legacyQuestion = 'x'.repeat(500);
  const legacyLimit = paidQuestionLengthLimit(legacyFields);
  assert.equal(legacyLimit, 400);
  assert.equal(legacyQuestion.slice(0, legacyLimit).length, 400);
  assert.equal(paidQuestionLengthLimit({
    ...snapshot(),
    toolPage: '/tr/pages/kisisel-tarot',
    personalDirect: 1,
  }), 400, 'translated or tampered identity keeps the legacy bound');
});

test('question and optional context fail closed before checkout authority', () => {
  for (let length = 1; length < PERSONAL_DIRECT_QUESTION_MIN_LENGTH; length += 1) {
    assert.equal(personalDirectQuestionPolicy('a'.repeat(length)).ok, false, String(length));
  }
  assert.equal(personalDirectQuestionPolicy(QUESTION).ok, true);
  assert.equal(personalDirectQuestionPolicy(`${QUESTION}${' x'.repeat(300)}`).ok, false, 'over 600 chars');
  assert.equal(personalDirectQuestionPolicy(QUESTION, 'x'.repeat(1501)).ok, false, 'over 1500 chars');
  for (const [question, context, category] of [
    ['Will I kill myself tonight?', '', 'crisis'],
    [QUESTION, 'I need the cards to confirm my cancer diagnosis.', 'medical'],
    [QUESTION, 'This involves an abusive stalker who threatened me.', 'danger'],
    ['Where is my missing child?', '', 'missing'],
  ]) {
    const policy = personalDirectQuestionPolicy(question, context);
    assert.equal(policy.ok, false);
    assert.equal(policy.safetyCategory, category);
  }
});

test('translated handles, duplicate/misordered cards, curiosity and free-preview state cannot impersonate the contract', () => {
  const cases = [
    ['translated page', { page: '/tr/pages/kisisel-tarot', snapshot: snapshot({ tool: '/tr/pages/kisisel-tarot' }) }],
    ['wrong order', { snapshot: snapshot({ signals: CARDS.replace('Situation:', 'TEMP:').replace('Challenge:', 'Situation:').replace('TEMP:', 'Challenge:'), cards: CARDS.replace('Situation:', 'TEMP:').replace('Challenge:', 'Situation:').replace('TEMP:', 'Challenge:') }) }],
    ['duplicate cards', { snapshot: snapshot({ signals: CARDS.replace('The Magician Reversed', 'The Fool Reversed'), cards: CARDS.replace('The Magician Reversed', 'The Fool Reversed') }) }],
    ['bad orientation', { snapshot: snapshot({ signals: CARDS.replace('Upright', 'Sideways'), cards: CARDS.replace('Upright', 'Sideways') }) }],
    ['curiosity', { snapshot: snapshot({ curiosityQuestion: 'What else is hidden?' }) }],
    ['preview token', { snapshot: snapshot({ freeToken: 'a'.repeat(32) }) }],
  ];
  for (const [label, overrides] of cases) {
    const input = {
      page: PERSONAL_DIRECT_PAGE,
      toolType: PERSONAL_DIRECT_TYPE,
      presentationVariant: PERSONAL_DIRECT_PRESENTATION_VARIANT,
      snapshot: snapshot(),
      ...overrides,
    };
    assert.equal(validatePersonalDirectSnapshot(input).ok, false, label);
  }
});

test('manifest authorizes the exact three Personal products and no drifted identity', () => {
  assert.deepEqual(SHARED_TOOL_PAGE_ALLOWED_TIERS[PERSONAL_DIRECT_PAGE], ['essential', 'deeper', 'indepth']);
  for (const [tier, expected] of Object.entries(PRODUCTS)) {
    assert.deepEqual(sharedToolContract(PERSONAL_DIRECT_PAGE, PERSONAL_DIRECT_TYPE, tier), {
      page: PERSONAL_DIRECT_PAGE,
      toolType: PERSONAL_DIRECT_TYPE,
      storefrontTier: tier,
      ...expected,
    });
  }
  assert.equal(sharedToolContract('/tr/pages/kisisel-tarot', PERSONAL_DIRECT_TYPE, 'essential'), null);
  assert.equal(sharedToolContract(PERSONAL_DIRECT_PAGE, 'Tarot', 'essential'), null);
});

test('post-purchase reconciliation preserves the signed intake for all tiers and rejects evidence or quote drift', () => {
  const packageTitles = {
    essential: 'Essential Personal Tarot reading',
    deeper: 'Focused Personal Tarot reading',
    indepth: 'In-Depth Personal Tarot reading',
  };
  for (const tier of Object.keys(PRODUCTS)) {
    const result = verifySharedToolPaidOrder(paidOrder(tier));
    assert.equal(result.ok, true, `${tier}: ${result.reason || ''}`);
    assert.equal(result.product.variantId, PRODUCTS[tier].variantId);
    assert.equal(result.product.storefrontTier, tier);
    assert.equal(result.verifiedFields.question, QUESTION);
    assert.equal(result.verifiedFields.context, CONTEXT);
    assert.equal(result.verifiedFields.freeQuestion, '');
    assert.equal(result.verifiedFields.freeContext, '');
    assert.equal(result.verifiedFields.cards, CARDS);
    assert.equal(result.verifiedFields.curiosityQuestion, '');
    assert.equal(result.verifiedFields.personalDirect, 1);
    assert.equal(paidQuestionLengthLimit(result.verifiedFields), 600);
    assert.equal(result.verifiedFields.packageTitle, packageTitles[tier]);
  }
  const longQuestionOrder = paidOrder('indepth');
  longQuestionOrder.row.question = LONG_QUESTION;
  longQuestionOrder.snapshot.question = LONG_QUESTION;
  const longQuestionResult = verifySharedToolPaidOrder(longQuestionOrder);
  assert.equal(longQuestionResult.ok, true, longQuestionResult.reason);
  assert.equal(longQuestionResult.verifiedFields.question, LONG_QUESTION);

  for (const [label, mutate, reason] of [
    ['duplicate', (input) => { input.snapshot.cards = input.snapshot.signals = CARDS.replace('The Magician Reversed', 'The Fool Reversed'); }, 'SHARED_PERSONAL_DIRECT_EVIDENCE_MISMATCH'],
    ['misordered', (input) => { input.snapshot.cards = input.snapshot.signals = CARDS.replace('Situation:', 'TEMP:').replace('Challenge:', 'Situation:').replace('TEMP:', 'Challenge:'); }, 'SHARED_PERSONAL_DIRECT_EVIDENCE_MISMATCH'],
    ['curiosity', (input) => { input.snapshot.curiosityQuestion = 'A stale sales question'; }, 'SHARED_PERSONAL_DIRECT_EVIDENCE_MISMATCH'],
    ['line amount', (input) => { input.line.presentmentAmount = '6.99'; }, 'SHARED_PERSONAL_DIRECT_QUOTE_MISMATCH'],
    ['line currency', (input) => { input.line.presentmentCurrency = 'EUR'; }, 'SHARED_PERSONAL_DIRECT_QUOTE_MISMATCH'],
    ['quote intent', (input) => { input.snapshot.checkoutQuote.intentId = 'wrong'; }, 'SHARED_PERSONAL_DIRECT_QUOTE_MISMATCH'],
  ]) {
    const input = paidOrder();
    mutate(input);
    assert.deepEqual(verifySharedToolPaidOrder(input), { ok: false, reason }, label);
  }
  const before = checkoutIntentSnapshotHash('shared_tool', paidOrder().snapshot);
  const tampered = paidOrder().snapshot;
  tampered.context = `${tampered.context} silently changed`;
  assert.notEqual(checkoutIntentSnapshotHash('shared_tool', tampered), before);
});

test('route exposes deterministic public codes before persistence and never logs intake PII', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSql = globalThis.__deckauraSql;
  const originalWarn = console.warn;
  const environmentKeys = ['ENTITLEMENT_PEPPER', 'FREE_ENTITLEMENT_SALT', 'SHOPIFY_WEBHOOK_SECRET', 'SHOPIFY_STORE', 'SHOPIFY_STOREFRONT_HOST', 'SHOPIFY_STOREFRONT_API_VERSION', 'SHOPIFY_STOREFRONT_ACCESS_TOKEN'];
  const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const logs = [];
  const inserts = [];
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.__deckauraSql = originalSql;
    console.warn = originalWarn;
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  });
  process.env.ENTITLEMENT_PEPPER = 'personal-direct-route-test-pepper';
  delete process.env.FREE_ENTITLEMENT_SALT;
  delete process.env.SHOPIFY_WEBHOOK_SECRET;
  process.env.SHOPIFY_STORE = 'deckaura.myshopify.com';
  process.env.SHOPIFY_STOREFRONT_HOST = 'deckaura.com';
  process.env.SHOPIFY_STOREFRONT_API_VERSION = '2026-07';
  delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  console.warn = (...values) => { logs.push(values.map(String).join(' ')); };
  const sql = async (strings, ...values) => {
    const query = strings.join(' ');
    if (query.includes('insert into deckaura.checkout_intents')) {
      inserts.push({ values, snapshot: values.find((value) => value?.__testJson)?.__testJson });
      return [];
    }
    throw new Error(`Unexpected SQL in personal-direct route test: ${query.slice(0, 100)}`);
  };
  sql.json = (value) => ({ __testJson: value });
  globalThis.__deckauraSql = sql;
  globalThis.fetch = async (_url, init = {}) => {
    const requestBody = JSON.parse(String(init.body));
    requests.push(requestBody);
    return storefrontResponse(requestBody);
  };
  const { POST } = await loadIntentRoute();

  for (const [label, body, expectedCode] of [
    ['short', routeBody('essential', { question: 'Too short?', snapshot: snapshot({ question: 'Too short?' }) }), 'PERSONAL_DIRECT_QUESTION_INVALID'],
    ['safety', routeBody('essential', { snapshot: snapshot({ context: 'Please confirm my cancer diagnosis.' }) }), 'PERSONAL_DIRECT_SAFETY_BLOCKED'],
    ['duplicate', routeBody('essential', { snapshot: snapshot({ signals: CARDS.replace('The Magician Reversed', 'The Fool Reversed'), cards: CARDS.replace('The Magician Reversed', 'The Fool Reversed') }) }), 'PERSONAL_DIRECT_EVIDENCE_MISMATCH'],
    ['translated page', routeBody('essential', { page: '/tr/pages/kisisel-tarot', snapshot: snapshot({ tool: '/tr/pages/kisisel-tarot' }) }), 'PERSONAL_DIRECT_CANONICAL_PAGE_INVALID'],
    ['unsupported tier', { ...routeBody(), tier: 'standard' }, 'PERSONAL_DIRECT_TIER_UNSUPPORTED'],
  ]) {
    const response = await POST(routeRequest(body));
    const payload = await response.json();
    assert.equal(response.status, 422, label);
    assert.equal(payload.code, expectedCode, label);
  }
  assert.equal(inserts.length, 0);
  assert.equal(requests.length, 0, 'policy/evidence failures occur before Shopify and persistence');
  const joinedLogs = logs.join('\n');
  assert.doesNotMatch(joinedLogs, /What should I understand|cancer diagnosis|The Fool|personal-direct-20260816/i);
  assert.doesNotMatch(joinedLogs, /"(?:question|context|cards|snapshot|token)"\s*:/i);
});

test('all three packages create localized hash-bound intents and quote changes require a second click', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSql = globalThis.__deckauraSql;
  const originalWarn = console.warn;
  const environmentKeys = ['ENTITLEMENT_PEPPER', 'FREE_ENTITLEMENT_SALT', 'SHOPIFY_WEBHOOK_SECRET', 'SHOPIFY_STORE', 'SHOPIFY_STOREFRONT_HOST', 'SHOPIFY_STOREFRONT_API_VERSION', 'SHOPIFY_STOREFRONT_ACCESS_TOKEN'];
  const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const inserts = [];
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.__deckauraSql = originalSql;
    console.warn = originalWarn;
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  });
  process.env.ENTITLEMENT_PEPPER = 'personal-direct-route-test-pepper';
  delete process.env.FREE_ENTITLEMENT_SALT;
  delete process.env.SHOPIFY_WEBHOOK_SECRET;
  process.env.SHOPIFY_STORE = 'deckaura.myshopify.com';
  process.env.SHOPIFY_STOREFRONT_HOST = 'deckaura.com';
  process.env.SHOPIFY_STOREFRONT_API_VERSION = '2026-07';
  delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  console.warn = () => {};
  const sql = async (strings, ...values) => {
    const query = strings.join(' ');
    if (query.includes('insert into deckaura.checkout_intents')) {
      inserts.push({ values, snapshot: values.find((value) => value?.__testJson)?.__testJson });
      return [];
    }
    throw new Error(`Unexpected SQL in personal-direct route test: ${query.slice(0, 100)}`);
  };
  sql.json = (value) => ({ __testJson: value });
  globalThis.__deckauraSql = sql;
  let quoteByTier = {};
  globalThis.fetch = async (_url, init = {}) => {
    const requestBody = JSON.parse(String(init.body));
    requests.push(requestBody);
    return storefrontResponse(requestBody, quoteByTier);
  };
  const { POST } = await loadIntentRoute();

  for (const tier of Object.keys(PRODUCTS)) {
    const submittedQuestion = tier === 'indepth' ? LONG_QUESTION : QUESTION;
    const response = await POST(routeRequest(routeBody(tier, {
      question: submittedQuestion,
      snapshot: snapshot({ question: submittedQuestion }),
    })));
    const payload = await response.json();
    assert.equal(response.status, 201, `${tier}: ${JSON.stringify(payload)}`);
    assert.equal(payload.variantId, PRODUCTS[tier].variantId);
    assert.equal(payload.checkoutQuote.variantId, PRODUCTS[tier].variantId);
    assert.equal(payload.checkoutQuote.priceCents, Math.round(PRODUCTS[tier].price * 100));
    assert.equal(payload.checkoutQuote.snapshotHash, payload.snapshotHash);
    const stored = inserts.at(-1).snapshot;
    assert.equal(stored.question, submittedQuestion);
    assert.equal(stored.context, CONTEXT);
    assert.equal(stored.cards, CARDS);
    assert.equal(stored.curiosityQuestion, '');
    assert.equal(stored.checkoutQuote.intentId, payload.intentId);
  }

  const missingCountryBody = routeBody('essential');
  delete missingCountryBody.displayedQuote.country;
  const missingCountryResponse = await POST(routeRequest(missingCountryBody));
  const missingCountryPayload = await missingCountryResponse.json();
  assert.equal(missingCountryResponse.status, 422);
  assert.equal(missingCountryPayload.code, 'PERSONAL_DIRECT_DISPLAYED_QUOTE_INVALID');
  assert.equal(inserts.length, 3, 'an incomplete displayed quote cannot create cart authority');

  quoteByTier = { deeper: { amount: '9.49', currency: 'EUR' } };
  const changedBody = routeBody('deeper', { locale: 'de-DE', country: 'DE', currency: 'EUR', market: 'de' });
  const changedResponse = await POST(routeRequest(changedBody));
  const changedPayload = await changedResponse.json();
  assert.equal(changedResponse.status, 409);
  assert.equal(changedPayload.code, 'PERSONAL_DIRECT_QUOTE_CHANGED');
  assert.equal(changedPayload.confirmationRequired, true);
  assert.deepEqual(changedPayload.checkoutQuote, {
    variantId: PRODUCTS.deeper.variantId,
    sku: PRODUCTS.deeper.sku,
    price: 9.49,
    priceCents: 949,
    currency: 'EUR',
    country: 'DE',
  });
  assert.equal(inserts.length, 3, 'price drift cannot create cart authority before confirmation');

  changedBody.displayedQuote = {
    variantId: PRODUCTS.deeper.variantId,
    sku: PRODUCTS.deeper.sku,
    priceCents: 949,
    currency: 'EUR',
    country: 'DE',
  };
  const confirmedResponse = await POST(routeRequest(changedBody));
  const confirmedPayload = await confirmedResponse.json();
  assert.equal(confirmedResponse.status, 201, JSON.stringify(confirmedPayload));
  assert.equal(confirmedPayload.checkoutQuote.priceCents, 949);
  assert.equal(confirmedPayload.checkoutQuote.currency, 'EUR');
  assert.equal(inserts.length, 4);
  assert.equal(inserts.at(-1).snapshot.localeContext.country, 'DE');
  assert.equal(inserts.at(-1).snapshot.checkoutQuote.currency, 'EUR');
  assert.equal(requests.length, 12, 'each attempt verifies catalog and localized Storefront contracts');
});

test('queue verifies snapshot hash and shared post-purchase authority before consuming an intent', async () => {
  const source = await readFile(new URL('lib/reading-queue-processor.ts', root), 'utf8');
  const hashIndex = source.indexOf('const snapshotHash = hashCheckoutIntentSnapshot(snapshot)');
  const orderIndex = source.indexOf('verifySharedToolPaidOrder({');
  const consumeIndex = source.indexOf("set status = 'paid'");
  assert.ok(hashIndex > 0 && orderIndex > hashIndex && consumeIndex > orderIndex);
  assert.match(source, /presentmentAmount: presentmentMoney\.amount/);
  assert.match(source, /presentmentCurrency: presentmentMoney\.currency/);
});
