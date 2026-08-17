import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import readingsWorker, {
  FreeEntitlementLimiter,
  appendTrustedPaidReadingRecord,
  hydratePaidReadingItemFields,
  publishTrustedPaidReadingRecord,
  trustedCachedPaidReading,
  verifiedPaidReadingDraftAuthority,
  verifiedPaidReadingDraftForOrderId,
} from '../lib/legacy-worker.mjs';
import { paidReadingAuthorityDigest } from '../lib/paid-reading-authority-receipt.mjs';

import {
  FREE_TAROT_FUNNEL_VERSION,
  FREE_TAROT_FUNNEL_VERSIONS,
  FREE_TAROT_PACKAGES,
  FREE_TAROT_PAGE,
  freeTarotPaidPackageAuthority,
  freeTarotReconciledVariantId,
  paidReadingDeliveryJobInput,
  shopifyFinancialStatusAllowsReadingFulfillment,
} from '../lib/free-tarot-payment-contract.mjs';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);

let queueProcessorPromise;
function loadQueueProcessor() {
  if (!queueProcessorPromise) {
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
    queueProcessorPromise = import(`../lib/reading-queue-processor.ts?paid-authority=${Date.now()}`);
  }
  return queueProcessorPromise;
}

let reconciliationPromise;
function loadReconciliation() {
  if (!reconciliationPromise) reconciliationPromise = import(`../lib/shopify-order-reconciliation.ts?receipt-v2=${Date.now()}`);
  return reconciliationPromise;
}

function lineProperty(name, value) {
  return { name, value };
}

function paidLine({
  id,
  variantId = FREE_TAROT_PACKAGES.standard.variantId,
  sku = FREE_TAROT_PACKAGES.standard.sku,
  properties = [],
} = {}) {
  return {
    id,
    variant_id: variantId,
    sku,
    quantity: 1,
    price: '5.99',
    properties,
  };
}

function authorityError(code) {
  return (error) => error?.code === code && error?.message === code;
}

function atomicReceiptCache(initial = []) {
  const values = new Map(initial);
  const casWrites = [];
  const puts = [];
  return {
    values,
    casWrites,
    puts,
    cache: {
      async get(key, type) {
        const value = values.get(key) ?? null;
        return type === 'json' && typeof value === 'string' ? JSON.parse(value) : value;
      },
      async put(key, value, options = {}) {
        puts.push({ key, value, options });
        values.set(key, value);
      },
      async compareAndSetMany(entries) {
        if (entries.some((entry) => (values.get(entry.key) ?? null) !== (entry.expectedValue ?? null))) return false;
        casWrites.push(entries);
        for (const entry of entries) {
          if (entry.value == null) values.delete(entry.key);
          else values.set(entry.key, entry.value);
        }
        return true;
      },
    },
  };
}

function receiptKeyForOrder(orderId) {
  const digest = createHash('sha256').update(`paid-reading-authority:${orderId}`, 'utf8').digest('hex');
  return `paid-authority-receipt:${digest}`;
}

function paidReceiptKeyEnv(secret, keyId = 'test-receipt-key-v2') {
  return {
    PAID_READING_AUTHORITY_RECEIPT_KEY_ID: keyId,
    PAID_READING_AUTHORITY_RECEIPT_SECRET: createHash('sha256').update(`receipt-test:${secret}`, 'utf8').digest('hex'),
  };
}

function checkoutContextCanonicalForTest(record) {
  const cards = record.clarifiers
    .map((card) => `${Number(card.id)}:${card.isReversed === true ? 'r' : 'u'}:${String(card.position).trim()}`)
    .join('|');
  return [
    record.contextId,
    record.previewToken,
    record.conversationId,
    record.readingId,
    record.paidQuestion,
    record.tier,
    record.variantId,
    record.sku,
    cards,
  ].join('\u001f');
}

function retryAuthorityFixture(kind) {
  const orderId = `durable-${kind}-order`;
  const lineId = `durable-${kind}-line`;
  const question = `What grounded guidance should this ${kind} order preserve after a retry?`;
  const contextId = '10000000-0000-4000-8000-000000000001';
  const intentId = '20000000-0000-4000-8000-000000000002';
  const token = 'd'.repeat(32);
  const readingId = `durable-${kind}-reading`;
  const conversationId = '40000000-0000-4000-8000-000000000004';
  const variantId = kind === 'intent' ? '53675061838097' : FREE_TAROT_PACKAGES.standard.variantId;
  const sku = FREE_TAROT_PACKAGES.standard.sku;
  const reference = kind === 'context'
    ? lineProperty('_Checkout Context', contextId)
    : kind === 'intent'
      ? lineProperty('_Checkout Intent', intentId)
      : lineProperty('_free_token', token);
  const line = paidLine({
    id: lineId,
    variantId,
    sku,
    properties: [
      reference,
      ...(kind === 'preview' ? [] : [lineProperty('_free_token', token)]),
      lineProperty('Your question', question),
      lineProperty('_Reading ID', readingId),
      lineProperty('_Conversation ID', conversationId),
      lineProperty('_Locale', 'en-US'),
      lineProperty('_Country', 'US'),
      lineProperty('_Currency', 'USD'),
      lineProperty('_Market', 'us'),
      lineProperty('_Funnel Version', FREE_TAROT_FUNNEL_VERSION),
      lineProperty('_Tool', FREE_TAROT_PAGE),
    ],
  });
  const payload = {
    id: orderId,
    name: `#${orderId}`,
    created_at: '2026-08-17T09:30:00.000Z',
    financial_status: 'paid',
    presentment_currency: 'USD',
    currency: 'USD',
    customer_locale: 'en-US',
    shipping_address: { country_code: 'US' },
    line_items: [line],
  };
  const verifiedFields = {
    question,
    locale: 'en-US',
    lang: 'en',
    country: 'US',
    currency: 'USD',
    market: 'us',
    receiptAuthority: kind,
    cards: 'Past: The Hermit · Upright; Present: Justice · Upright; Future: The Star · Upright',
    spread: 'Past · Present · Future',
    type: 'Tarot',
    context: 'A three-card reflective spread with stable server-owned evidence.',
    signals: 'Past: The Hermit · Upright; Present: Justice · Upright; Future: The Star · Upright',
    scope: 'Reflective guidance for the exact paid question.',
    confidence: 'Symbolic guidance, not a fixed prediction.',
    tool: FREE_TAROT_PAGE,
    readingId,
    conversationId,
    freeToken: token,
    previewContinuity: true,
  };
  const authority = kind === 'context'
    ? {
        checkout: {
          lineKey: `id:${lineId}`,
          contextId,
          tier: 'standard',
          variantId,
          sku,
          clarifiers: [
            { id: 1, name: 'The Magician', isReversed: false, position: 'Agency' },
            { id: 2, name: 'The Star', isReversed: false, position: 'Direction' },
          ],
          verifiedFields,
        },
      }
    : kind === 'intent'
      ? {
          intent: {
            lineKey: `id:${lineId}`,
            intentId,
            tier: 'standard',
            variantId,
            sku,
            price: 5.99,
            category: 'general',
            intentKind: 'yes_no',
            verifiedFields,
          },
        }
      : {
          preview: {
            lineKey: `id:${lineId}`,
            token,
            ownerVisitorHash: `visitor:${'e'.repeat(64)}`,
            variantId,
            sku,
            tier: 'standard',
            verifiedFields,
          },
        };
  const verified = {
    items: [line],
    numerology: null,
    checkout: null,
    intent: null,
    preview: null,
    legacyGrandfathered: false,
    ...authority,
  };
  const rawPayload = JSON.stringify(payload);
  const row = {
    webhook_id: `webhook-${kind}`,
    event_id: `event-${kind}`,
    topic: 'orders/paid',
    order_id: orderId,
    payload_sha256: createHash('sha256').update(rawPayload, 'utf8').digest('hex'),
    payload,
    status: 'processing',
    attempts: 1,
    max_attempts: 5,
    lease_token: '30000000-0000-4000-8000-000000000003',
    lease_expires_at: new Date('2026-08-17T10:00:00.000Z'),
  };
  return { kind, orderId, line, payload, row, verified, question };
}

async function replayPaidWebhookThroughLegacy(row, env) {
  const raw = JSON.stringify(row.payload);
  const signature = createHmac('sha256', env.SHOPIFY_WEBHOOK_SECRET).update(raw, 'utf8').digest('base64');
  const response = await readingsWorker.fetch(new Request('https://reading.deckaura.internal/webhook/orders-paid', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': signature,
      'x-shopify-webhook-id': row.webhook_id,
      'x-shopify-topic': row.topic,
    },
    body: raw,
  }), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
  return { ignored: false };
}

for (const product of Object.values(FREE_TAROT_PACKAGES)) {
  test(`${product.tier} Free Tarot orders recover from v50-v56 reconciliation through the delivery-job boundary`, () => {
    for (const funnelVersion of FREE_TAROT_FUNNEL_VERSIONS) {
      const variantId = freeTarotReconciledVariantId({
        funnelVersion,
        page: FREE_TAROT_PAGE,
        sku: product.sku,
      });
      assert.equal(variantId, product.variantId, `${funnelVersion}/${product.sku}`);

      const authority = freeTarotPaidPackageAuthority({ variant_id: variantId, sku: product.sku });
      assert.deepEqual(authority, {
        ok: true,
        variantId: product.variantId,
        sku: product.sku,
        tier: product.tier,
      });

      assert.equal(shopifyFinancialStatusAllowsReadingFulfillment('paid'), true);
      const dueAt = new Date('2026-08-15T21:30:00.000Z');
      const orderId = `free-tarot-${product.tier}`;
      assert.deepEqual(paidReadingDeliveryJobInput(orderId, dueAt), {
        orderId,
        jobType: 'paid_reading',
        dueAt,
        idempotencyKey: `paid-reading:${orderId}`,
        maxRetries: 3,
      });
    }
  });
}

test('v56 is current while v50-v55 remain explicit backward-recovery aliases', () => {
  assert.equal(FREE_TAROT_FUNNEL_VERSION, 'premium-choice-2026-08-v56');
  assert.deepEqual(FREE_TAROT_FUNNEL_VERSIONS, [
    'premium-choice-2026-08-v50',
    'premium-choice-2026-08-v51',
    'premium-choice-2026-08-v52',
    'premium-choice-2026-08-v53',
    'premium-choice-2026-08-v54',
    'premium-choice-2026-08-v55',
    'premium-choice-2026-08-v56',
  ]);
});

test('reconciliation fails closed for an unknown release, wrong page, or unknown SKU', () => {
  const valid = {
    funnelVersion: FREE_TAROT_FUNNEL_VERSION,
    page: FREE_TAROT_PAGE,
    sku: 'READING-DEEP',
  };
  assert.equal(freeTarotReconciledVariantId({ ...valid, funnelVersion: 'premium-choice-2026-08-v57' }), '');
  assert.equal(freeTarotReconciledVariantId({ ...valid, page: '/pages/personal-tarot-reading' }), '');
  assert.equal(freeTarotReconciledVariantId({ ...valid, sku: 'READING-UNKNOWN' }), '');
});

test('v56 paid-new-spread missed-webhook recovery keeps the canonical Free Tarot page and package authority', () => {
  const variantId = freeTarotReconciledVariantId({
    funnelVersion: 'premium-choice-2026-08-v56',
    page: FREE_TAROT_PAGE,
    sku: FREE_TAROT_PACKAGES.medium.sku,
  });
  assert.equal(variantId, FREE_TAROT_PACKAGES.medium.variantId);
  assert.deepEqual(freeTarotPaidPackageAuthority({ variantId, sku: FREE_TAROT_PACKAGES.medium.sku }), {
    ok: true,
    variantId: FREE_TAROT_PACKAGES.medium.variantId,
    sku: FREE_TAROT_PACKAGES.medium.sku,
    tier: 'medium',
  });
});

test('/funnel-version preserves legacy compatibility fields and exposes authoritative v56 payment support', async () => {
  const response = await readingsWorker.fetch(new Request('https://reading.deckaura.com/funnel-version', {
    headers: { Origin: 'https://deckaura.com' },
  }), {});
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.funnelVersion, 'clarifier-checkout-2026-08-v40');
  assert.equal(payload.themeVersion, 45);
  assert.equal(payload.experienceVersion, 'free-tarot-enterprise-2026-08-v45');
  assert.equal(payload.paymentFunnelVersion, 'premium-choice-2026-08-v56');
  assert.deepEqual(payload.acceptedPaymentFunnels, FREE_TAROT_FUNNEL_VERSIONS);
  assert.equal(payload.nextPaymentFunnelRejected, 'premium-choice-2026-08-v57');
});

test('known Free Tarot variants fail closed when the Shopify SKU does not match', () => {
  assert.deepEqual(freeTarotPaidPackageAuthority({
    variant_id: FREE_TAROT_PACKAGES.standard.variantId,
    sku: FREE_TAROT_PACKAGES.medium.sku,
  }), {
    ok: false,
    reason: 'SHOPIFY_PACKAGE_VARIANT_SKU_MISMATCH',
  });
  assert.equal(freeTarotPaidPackageAuthority({ variant_id: '53782499066129', sku: 'READING-DEEP' }), null);
});

test('only captured paid orders can cross the delivery boundary', () => {
  assert.equal(shopifyFinancialStatusAllowsReadingFulfillment('paid'), true);
  for (const status of ['authorized', 'partially_paid', 'pending', 'voided', 'refunded', '', null]) {
    assert.equal(shopifyFinancialStatusAllowsReadingFulfillment(status), false, String(status));
  }
  assert.throws(() => paidReadingDeliveryJobInput('', new Date()), /SHOPIFY_ORDER_ID_REQUIRED/);
  assert.throws(() => paidReadingDeliveryJobInput('123', new Date('invalid')), /DELIVERY_DUE_AT_INVALID/);
});

test('the signed legacy webhook rejects authorization-only payloads before paid state is mutated', async () => {
  const secret = 'test-only-shopify-webhook-secret';
  const send = async (financialStatus) => {
    const raw = JSON.stringify({ id: 'payment-finality-test', financial_status: financialStatus, line_items: [] });
    const hmac = createHmac('sha256', secret).update(raw, 'utf8').digest('base64');
    return readingsWorker.fetch(new Request('https://reading.deckaura.com/webhook/orders-paid', {
      method: 'POST',
      headers: { 'X-Shopify-Hmac-Sha256': hmac, 'Content-Type': 'application/json' },
      body: raw,
    }), { SHOPIFY_WEBHOOK_SECRET: secret });
  };
  for (const financialStatus of ['authorized', 'partially_paid']) {
    const response = await send(financialStatus);
    assert.equal(response.status, 409, financialStatus);
    assert.equal(await response.text(), 'Payment not captured');
  }
  const captured = await send('paid');
  assert.equal(captured.status, 200);
  assert.equal(await captured.text(), 'ok');
});

test('production reconciliation, authority, queue, and generator use the tested payment contract', async () => {
  const [reconciliation, queue, worker] = await Promise.all([
    readFile(new URL('lib/shopify-order-reconciliation.ts', root), 'utf8'),
    readFile(new URL('lib/reading-queue-processor.ts', root), 'utf8'),
    readFile(new URL('lib/legacy-worker.mjs', root), 'utf8'),
  ]);
  assert.match(reconciliation, /freeTarotReconciledVariantId\(\{ funnelVersion, page: toolPage, sku \}\)/);
  assert.match(reconciliation, /const toolPage = attributeValue\(attributes, 'tool'\)/);
  assert.match(queue, /const freeTarotAuthority = freeTarotPaidPackageAuthority\(\{ variantId, sku \}\)/);
  assert.match(queue, /throw new QueueOperationError\('SHOPIFY_PAYMENT_NOT_CAPTURED'\)/);
  assert.match(queue, /operations\.enqueueDelivery[\s\S]{0,200}paidReadingDeliveryJobInput\(orderId, dueAt\)/);
  const sourceGuardStart = queue.indexOf('const sourceAuthority = checkout || preview');
  const sourceGuardEnd = queue.indexOf('return publish(verified, sourceGuards)', sourceGuardStart);
  const sourceGuardContract = queue.slice(sourceGuardStart, sourceGuardEnd);
  assert.ok(sourceGuardStart >= 0 && sourceGuardEnd > sourceGuardStart);
  assert.match(sourceGuardContract, /sourceGuards\.length !== 2/);
  assert.match(sourceGuardContract, /new Set\(sourceGuards\.map/);
  assert.match(sourceGuardContract, /PAID_READING_AUTHORITY_SOURCE_GUARD_INVALID/);
  assert.doesNotMatch(sourceGuardContract, /paidReadingAuthoritySourceGuards\.get\(sourceAuthority\) \|\| \[\]/,
    'checkout/preview receipt publication must never downgrade missing source guards to an empty CAS');
  const claimStart = queue.indexOf('async function processWebhookClaim');
  const paymentGate = queue.indexOf("throw new QueueOperationError('SHOPIFY_PAYMENT_NOT_CAPTURED')", claimStart);
  const paidDispatch = queue.indexOf('await processUndeliveredPaidOrder(row, env)', claimStart);
  const paidProcessor = queue.indexOf('export async function processUndeliveredPaidOrder');
  const receiptGate = queue.indexOf('await verifiedOrReceiptedPaidReadingAuthorities(', paidProcessor);
  const legacyReplay = queue.indexOf('dependencies.replay || replayShopifyWebhook', receiptGate);
  assert.ok(claimStart >= 0 && paymentGate > claimStart && paidDispatch > paymentGate
    && paidProcessor >= 0 && receiptGate > paidProcessor && legacyReplay > receiptGate,
    'payment finality must be checked before legacy replay can mutate paid state');
  assert.match(worker, /shopifyFinancialStatusAllowsReadingFulfillment\(order\.financial_status\)/);
  assert.match(worker, /return new Response\("Payment not captured", \{ status: 409 \}\)/);
  assert.doesNotMatch(worker, /\["paid",\s*"partially_paid",\s*"authorized"\]\.includes\(order\.financial_status\)/);
});

test('legacy free-token webhook unlock is strictly pre-cutoff and cannot write current markerless cache', async () => {
  const secret = 'legacy-free-token-cutoff-secret';
  const token = 'b'.repeat(32);
  const makeOrder = (id, createdAt) => ({
    id,
    name: `#${id}`,
    created_at: createdAt,
    financial_status: 'paid',
    currency: 'USD',
    line_items: [paidLine({
      id: `line-${id}`,
      properties: [
        lineProperty('_free_token', token),
        lineProperty('Your question', 'What grounded next step should I take?'),
      ],
    })],
  });
  const send = async (order, storage) => {
    const raw = JSON.stringify(order);
    const hmac = createHmac('sha256', secret).update(raw, 'utf8').digest('base64');
    return readingsWorker.fetch(new Request('https://reading.deckaura.com/webhook/orders-paid', {
      method: 'POST',
      headers: { 'X-Shopify-Hmac-Sha256': hmac, 'Content-Type': 'application/json' },
      body: raw,
    }), {
      READINGS_CACHE: storage.cache,
      SHOPIFY_WEBHOOK_SECRET: secret,
      PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
    });
  };

  const current = makeOrder('current-free-token-order', '2026-08-17T09:00:00.000Z');
  const currentStorage = atomicReceiptCache([[`free:${token}`, JSON.stringify({ full: '<p>Unsigned free result.</p>' })]]);
  const currentResponse = await send(current, currentStorage);
  assert.equal(currentResponse.status, 200);
  assert.equal(await currentResponse.text(), 'accepted_for_review');
  assert.equal(JSON.parse(currentStorage.values.get(`free:${token}`)).paid, undefined);
  assert.equal(currentStorage.values.has(`reading:${current.id}`), false);

  const historical = makeOrder('historical-free-token-order', '2026-08-17T07:00:00.000Z');
  const historicalStorage = atomicReceiptCache([[`free:${token}`, JSON.stringify({ full: '<p>Historical free result.</p>' })]]);
  const historicalResponse = await send(historical, historicalStorage);
  assert.equal(historicalResponse.status, 200);
  assert.equal(await historicalResponse.text(), 'ok');
  assert.equal(JSON.parse(historicalStorage.values.get(`free:${token}`)).paid, true);
  assert.match(JSON.parse(historicalStorage.values.get(`reading:${historical.id}`)).html, /Historical free result/);
});

test('raw Shopify order references cannot read, mutate, or generate a paid reading', async () => {
  let cacheCalls = 0;
  let limiterCalls = 0;
  const env = {
    READINGS_CACHE: {
      async get() { cacheCalls += 1; throw new Error('raw reference must not read cache'); },
      async put() { cacheCalls += 1; throw new Error('raw reference must not write cache'); },
    },
    FREE_ENTITLEMENTS: {
      getByName() { limiterCalls += 1; throw new Error('raw reference must not claim generation'); },
    },
  };
  const generated = await readingsWorker.fetch(new Request('https://reading.deckaura.com/generate', {
    method: 'POST',
    headers: { Origin: 'https://deckaura.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: '9876543210' }),
  }), env);
  assert.equal(generated.status, 200);
  assert.deepEqual(await generated.json(), {
    ready: false,
    secureDelivery: true,
    message: 'Your secure reading link is in your email.',
  });

  for (const [method, path, body] of [
    ['GET', '/r/9876543210', null],
    ['GET', '/r?id=9876543210', null],
    ['POST', '/r/9876543210/next', { question: 'What grounded next step should I take?', requestId: 'raw-order-reference-001' }],
    ['POST', '/r/9876543210/question', { question: 'What grounded next step should I take?' }],
  ]) {
    const response = await readingsWorker.fetch(new Request(`https://reading.deckaura.com${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }), env);
    assert.ok([403, 404].includes(response.status), `${method} ${path}`);
  }
  assert.equal(cacheCalls, 0);
  assert.equal(limiterCalls, 0);

  let unmappedReads = 0;
  const unmappedEnv = {
    READINGS_CACHE: {
      async get(key) {
        unmappedReads += 1;
        assert.match(String(key), /^paid-access:/);
        return null;
      },
    },
  };
  const unmappedToken = 'f'.repeat(32);
  const unmappedPage = await readingsWorker.fetch(new Request(`https://reading.deckaura.com/r/${unmappedToken}`), unmappedEnv);
  const unmappedNext = await readingsWorker.fetch(new Request(`https://reading.deckaura.com/r/${unmappedToken}/next`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'What grounded next step should I take?', requestId: 'unmapped-token-request-01' }),
  }), unmappedEnv);
  assert.equal(unmappedPage.status, 404);
  assert.equal(unmappedNext.status, 403);
  assert.equal(unmappedReads, 2);

  const injected = await readingsWorker.fetch(new Request('https://reading.deckaura.com/inject.js'), env);
  const injectedSource = await injected.text();
  assert.doesNotMatch(injectedSource, /\/generate/);
  assert.doesNotMatch(injectedSource, /\/r\/[^'"\s]*/);
});

test('an opaque paid-access capability still opens a strict pre-cutoff cached reading', async () => {
  const orderId = '1234567890';
  const accessToken = 'a'.repeat(32);
  const privateHtml = '<p>Capability-bound historical reading.</p>';
  const createdAt = '2026-08-17T07:00:00.000Z';
  const storage = atomicReceiptCache([
    [`paid-access:${accessToken}`, orderId],
    [`paid-draft:${orderId}`, JSON.stringify({
      schemaVersion: 2,
      orderId,
      accessToken,
      originalQuestion: 'What grounded path should I take?',
      question: 'What grounded path should I take?',
      status: 'auto_locked',
      editCount: 0,
      missingQuestion: false,
      createdAt: Date.parse(createdAt),
      reviewUntil: Date.parse(createdAt),
      confirmedAt: Date.parse(createdAt),
    })],
    [`reading:${orderId}`, JSON.stringify({
      html: privateHtml,
      readings: [{ html: privateHtml }],
      total: 1,
      deliverAt: 0,
    })],
  ]);
  const env = {
    READINGS_CACHE: storage.cache,
    SHOPIFY_STORE_DOMAIN: 'example.myshopify.com',
    SHOPIFY_ADMIN_TOKEN: 'test-admin-token',
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), new RegExp(`/orders/${orderId}\\.json`));
    return new Response(JSON.stringify({ order: {
      id: orderId,
      created_at: createdAt,
      financial_status: 'paid',
      line_items: [],
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const response = await readingsWorker.fetch(new Request(`https://reading.deckaura.com/r/${accessToken}`), env);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Capability-bound historical reading/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('paid queue authority is per reading line and cannot be opted out through browser funnel properties', async () => {
  const { assertPaidReadingLineAuthorities } = await loadQueueProcessor();
  const cutoff = '2026-08-17T08:00:00.000Z';
  const currentPayload = { created_at: '2026-08-17T09:00:00.000Z' };
  const legacyPayload = { created_at: '2026-08-17T07:59:59.999Z' };
  const unsigned = paidLine({
    id: 'unsigned-free-tarot',
    properties: [lineProperty('_Funnel Version', FREE_TAROT_FUNNEL_VERSION)],
  });

  assert.throws(
    () => assertPaidReadingLineAuthorities([unsigned], currentPayload, {}, cutoff),
    authorityError('PAID_READING_AUTHORITY_REQUIRED'),
  );
  assert.throws(
    () => assertPaidReadingLineAuthorities([{ ...unsigned, properties: [] }], currentPayload, {}, cutoff),
    authorityError('PAID_READING_AUTHORITY_REQUIRED'),
  );
  assert.deepEqual(
    assertPaidReadingLineAuthorities([unsigned], legacyPayload, {}, cutoff),
    { legacyGrandfathered: true, createdAt: Date.parse(legacyPayload.created_at) },
  );
  assert.throws(
    () => assertPaidReadingLineAuthorities([unsigned], {}, {}, cutoff),
    authorityError('SHOPIFY_ORDER_CREATED_AT_INVALID'),
  );
  assert.throws(
    () => assertPaidReadingLineAuthorities([unsigned], currentPayload, {}, ''),
    authorityError('PAID_READING_AUTHORITY_CUTOFF_MISSING'),
  );

  const contextId = '00000000-0000-4000-8000-000000000001';
  const contextLine = paidLine({
    id: 'context-line',
    properties: [lineProperty('_Checkout Context', contextId)],
  });
  assert.deepEqual(assertPaidReadingLineAuthorities([contextLine], currentPayload, {
    checkout: {
      lineKey: 'id:context-line',
      contextId,
      variantId: FREE_TAROT_PACKAGES.standard.variantId,
      sku: FREE_TAROT_PACKAGES.standard.sku,
    },
  }, cutoff), { legacyGrandfathered: false, createdAt: Date.parse(currentPayload.created_at) });

  const intentId = '00000000-0000-4000-8000-000000000002';
  const intentVariant = '53675061838097';
  const intentLine = paidLine({
    id: 'intent-line',
    variantId: intentVariant,
    properties: [lineProperty('_Checkout Intent', intentId)],
  });
  assert.deepEqual(assertPaidReadingLineAuthorities([intentLine], currentPayload, {
    intent: {
      lineKey: 'id:intent-line',
      intentId,
      variantId: intentVariant,
      sku: 'READING-DEEP',
    },
  }, cutoff), { legacyGrandfathered: false, createdAt: Date.parse(currentPayload.created_at) });

  const previewToken = 'a'.repeat(32);
  const previewLine = paidLine({
    id: 'preview-line',
    properties: [lineProperty('_free_token', previewToken)],
  });
  assert.deepEqual(assertPaidReadingLineAuthorities([previewLine], currentPayload, {
    preview: {
      lineKey: 'id:preview-line',
      token: previewToken,
      variantId: FREE_TAROT_PACKAGES.standard.variantId,
      sku: FREE_TAROT_PACKAGES.standard.sku,
    },
  }, cutoff), { legacyGrandfathered: false, createdAt: Date.parse(currentPayload.created_at) });

  const smuggled = paidLine({
    id: 'unsigned-second-line',
    variantId: '53782500409617',
    properties: [lineProperty('_Funnel Version', 'downgraded-by-browser')],
  });
  assert.throws(
    () => assertPaidReadingLineAuthorities([previewLine, smuggled], currentPayload, {
      preview: {
        lineKey: 'id:preview-line',
        token: previewToken,
        variantId: FREE_TAROT_PACKAGES.standard.variantId,
        sku: FREE_TAROT_PACKAGES.standard.sku,
      },
    }, cutoff),
    authorityError('PAID_READING_AUTHORITY_REQUIRED'),
  );
});

test('current unsigned, legacy unsigned, and multi-reading orders fail before automated fulfillment', async () => {
  const { verifyPaidReadingAuthorities } = await loadQueueProcessor();
  const cutoff = '2026-08-17T08:00:00.000Z';
  const env = { PAID_READING_AUTHORITY_CUTOFF: cutoff, READINGS_CACHE: {} };
  const unsigned = paidLine({ id: 'unsigned-runtime-line' });

  await assert.rejects(
    verifyPaidReadingAuthorities({
      created_at: '2026-08-17T09:00:00.000Z',
      line_items: [unsigned],
    }, env),
    authorityError('PAID_READING_AUTHORITY_REQUIRED'),
  );
  await assert.rejects(
    verifyPaidReadingAuthorities({
      created_at: '2026-08-17T07:59:59.999Z',
      line_items: [unsigned],
    }, env),
    authorityError('PAID_READING_LEGACY_MANUAL_REVIEW_REQUIRED'),
  );
  await assert.rejects(
    verifyPaidReadingAuthorities({
      created_at: '2026-08-17T09:00:00.000Z',
      line_items: [unsigned, paidLine({ id: 'smuggled-runtime-line', variantId: '53782500409617' })],
    }, env),
    authorityError('PAID_READING_LINE_COUNT_INVALID'),
  );
});

test('Free Tarot token authority is atomically owner, session, question, reading, and market bound', async () => {
  const { verifiedFreePreviewAuthority } = await loadQueueProcessor();
  const now = Date.now();
  const token = 'b'.repeat(32);
  const ownerVisitorHash = `visitor:${'c'.repeat(64)}`;
  const readingId = 'queue-preview-reading-20260817';
  const conversationId = '00000000-0000-4000-8000-000000000003';
  const question = 'What should I understand before making this exact career decision?';
  const fields = {
    question,
    type: 'Tarot',
    cards: 'The Star',
    spread: 'One Card',
    context: 'The Star is upright in this one-card reflective draw.',
    lang: 'en',
    locale: 'en-US',
    country: 'US',
    currency: 'USD',
    market: 'us',
    signals: 'The Star: Upright',
    scope: 'One-card reflective guidance for one exact question.',
    confidence: 'Symbolic guidance, not a fixed prediction.',
    tool: '/pages/free-tarot-reading',
    focus: '',
    curiosityQuestion: 'What practical step would bring more clarity?',
    readingId,
    snapshotVersion: 'reading-snapshot-v2',
    snapshotFingerprint: '',
    funnelVersion: FREE_TAROT_FUNNEL_VERSION,
  };
  const snapshot = {
    schemaVersion: 2,
    snapshotVersion: 'reading-snapshot-v2',
    readingId,
    fields,
    question,
    focus: '',
    conversationId,
    ownerVisitorHash,
    createdAt: new Date(now - 5_000).toISOString(),
  };
  const pointer = {
    schemaVersion: 2,
    snapshotVersion: 'reading-snapshot-v2',
    token,
    question,
    fields,
    conversationId,
    createdAt: now - 5_000,
    expiresAt: now + 60 * 60 * 1_000,
    approvalStatus: 'approved',
    approvedAt: now - 4_000,
  };
  const snapshotKey = `preview:${token}`;
  const pointerKey = `preview-current:${ownerVisitorHash}`;
  const values = new Map([
    [snapshotKey, JSON.stringify(snapshot)],
    [pointerKey, JSON.stringify(pointer)],
  ]);
  const casWrites = [];
  const cache = {
    async get(key, type) {
      const value = values.get(key) ?? null;
      return type === 'json' && value ? JSON.parse(value) : value;
    },
    async compareAndSetMany(entries) {
      if (entries.some((entry) => (values.get(entry.key) ?? null) !== entry.expectedValue)) return false;
      casWrites.push(entries);
      for (const entry of entries) values.set(entry.key, entry.value);
      return true;
    },
  };
  const line = paidLine({
    id: 'verified-preview-line',
    properties: [
      lineProperty('Your question', question),
      lineProperty('_Reading ID', readingId),
      lineProperty('_Conversation ID', conversationId),
      lineProperty('_free_token', token),
      lineProperty('_Locale', 'en-US'),
      lineProperty('_Country', 'US'),
      lineProperty('_Currency', 'USD'),
      lineProperty('_Market', 'us'),
      lineProperty('_Selected Package', 'standard'),
    ],
  });
  const payload = {
    created_at: new Date(now).toISOString(),
    presentment_currency: 'USD',
    shipping_address: { country_code: 'US' },
  };
  const verified = await verifiedFreePreviewAuthority([line], payload, { READINGS_CACHE: cache });
  assert.equal(verified.token, token);
  assert.equal(verified.ownerVisitorHash, ownerVisitorHash);
  assert.equal(verified.verifiedFields.previewContinuity, true);
  assert.equal(verified.verifiedFields.previewAuthorityVerified, true);
  assert.deepEqual(casWrites[0].map((entry) => entry.key).sort(), [pointerKey, snapshotKey].sort());
  assert.ok(casWrites[0].every((entry) => entry.value === entry.expectedValue), 'authority check must be an exact-value CAS');

  values.set(snapshotKey, JSON.stringify({ ...snapshot, safety: true, offerBlocked: true }));
  await assert.rejects(
    verifiedFreePreviewAuthority([line], payload, { READINGS_CACHE: cache }),
    authorityError('PREVIEW_AUTHORITY_BLOCKED'),
  );

  values.set(snapshotKey, JSON.stringify(snapshot));
  const changingCache = {
    ...cache,
    async compareAndSetMany() {
      values.set(pointerKey, JSON.stringify({ ...pointer, safety: true, offerBlocked: true, approvalStatus: 'blocked' }));
      return false;
    },
  };
  await assert.rejects(
    verifiedFreePreviewAuthority([line], payload, { READINGS_CACHE: changingCache }),
    authorityError('PREVIEW_AUTHORITY_CHANGED'),
  );

  const realDateNow = Date.now;
  const fixedNow = Math.floor(realDateNow() / 1_000) * 1_000 + 250;
  Date.now = () => fixedNow;
  try {
    values.set(pointerKey, JSON.stringify({ ...pointer, expiresAt: fixedNow + 749 }));
    await assert.rejects(
      verifiedFreePreviewAuthority([line], payload, { READINGS_CACHE: cache }),
      authorityError('PREVIEW_AUTHORITY_EXPIRED'),
      'authority must fail closed when the durable TTL would round down to an already-active second',
    );
  } finally {
    Date.now = realDateNow;
  }
});

test('checkout-context verification freezes the complete safe preview evidence before issuing a durable receipt', async () => {
  const { verifyPaidReadingAuthorities, verifiedOrReceiptedPaidReadingAuthorities } = await loadQueueProcessor();
  const now = Date.now();
  const secret = 'checkout-context-freeze-secret';
  const token = 'f'.repeat(32);
  const contextId = '50000000-0000-4000-8000-000000000005';
  const readingId = 'checkout-context-freeze-reading';
  const conversationId = '60000000-0000-4000-8000-000000000006';
  const question = 'What grounded perspective should guide this exact decision now?';
  const fields = {
    question,
    cards: 'Past: The Hermit · Upright; Present: Justice · Upright; Future: The Star · Upright',
    spread: 'Past · Present · Future',
    type: 'Tarot',
    context: 'A complete safe three-card server snapshot.',
    lang: 'en',
    locale: 'en-US',
    country: 'US',
    currency: 'USD',
    market: 'us',
    signals: 'Past: The Hermit · Upright; Present: Justice · Upright; Future: The Star · Upright',
    scope: 'Reflective guidance for this exact question.',
    confidence: 'Symbolic guidance, not a fixed prediction.',
    tool: FREE_TAROT_PAGE,
    focus: '',
    curiosityQuestion: 'What next step would create clarity?',
    readingId,
    snapshotVersion: 'reading-snapshot-v2',
    snapshotFingerprint: '',
    funnelVersion: FREE_TAROT_FUNNEL_VERSION,
  };
  const snapshot = {
    schemaVersion: 2,
    snapshotVersion: 'reading-snapshot-v2',
    readingId,
    fields,
    question,
    focus: '',
    conversationId,
    ownerVisitorHash: `visitor:${'a'.repeat(64)}`,
    createdAt: new Date(now - 5_000).toISOString(),
  };
  const clarifiers = [
    { id: 1, name: 'The Magician', isReversed: false, position: 'Agency' },
    { id: 2, name: 'The High Priestess', isReversed: true, position: 'Inner signal' },
  ];
  const record = {
    schemaVersion: 2,
    contextVersion: 'clarifier-checkout-v1',
    contextId,
    previewToken: token,
    conversationId,
    readingId,
    paidQuestion: question,
    tier: 'standard',
    variantId: FREE_TAROT_PACKAGES.standard.variantId,
    sku: FREE_TAROT_PACKAGES.standard.sku,
    clarifiers,
    createdAt: now - 2_000,
    expiresAt: now + 60 * 60_000,
  };
  const signature = createHmac('sha256', secret)
    .update(checkoutContextCanonicalForTest(record), 'utf8')
    .digest('hex');
  const line = paidLine({
    id: 'checkout-context-freeze-line',
    properties: [
      lineProperty('_Checkout Context', contextId),
      lineProperty('_Checkout Signature', signature),
      lineProperty('_free_token', token),
      lineProperty('Your question', question),
      lineProperty('_Reading ID', readingId),
      lineProperty('_Conversation ID', conversationId),
      lineProperty('_Locale', 'en-US'),
      lineProperty('_Country', 'US'),
      lineProperty('_Currency', 'USD'),
      lineProperty('_Market', 'us'),
      lineProperty('_Selected Package', 'standard'),
    ],
  });
  const storage = atomicReceiptCache([
    [`checkout-context:${contextId}`, JSON.stringify({ ...record, signature })],
    [`preview:${token}`, JSON.stringify(snapshot)],
  ]);
  const payload = {
    id: 'checkout-context-freeze-order',
    created_at: new Date(now).toISOString(),
    financial_status: 'paid',
    presentment_currency: 'USD',
    currency: 'USD',
    shipping_address: { country_code: 'US' },
    line_items: [line],
  };
  const env = {
    READINGS_CACHE: storage.cache,
    ENTITLEMENT_PEPPER: secret,
    INTERNAL_ORDER_REPLAY_SECRET: secret,
    SHOPIFY_WEBHOOK_SECRET: secret,
    ...paidReceiptKeyEnv(secret),
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
  };
  const verified = await verifyPaidReadingAuthorities(payload, env);
  assert.equal(verified.checkout.contextId, contextId);
  assert.equal(verified.checkout.verifiedFields.freeToken, token);
  assert.equal(verified.checkout.verifiedFields.previewContinuity, true);
  assert.equal(verified.checkout.verifiedFields.cards, fields.cards);
  assert.equal(verified.checkout.verifiedFields.signals, fields.signals);
  assert.equal(verified.checkout.verifiedFields.question, question);
  assert.equal(verified.checkout.verifiedFields.clarifierCards,
    'Agency: The Magician · Upright; Inner signal: The High Priestess · Reversed');

  const row = {
    webhook_id: 'checkout-context-freeze-webhook',
    event_id: 'checkout-context-freeze-event',
    topic: 'orders/paid',
    order_id: payload.id,
    payload_sha256: createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex'),
    payload,
    status: 'processing',
    attempts: 1,
    max_attempts: 5,
    lease_token: '70000000-0000-4000-8000-000000000007',
    lease_expires_at: new Date(now + 60_000),
  };
  await assert.rejects(
    verifiedOrReceiptedPaidReadingAuthorities(row, env, undefined, {
      afterVerify() {
        const error = new Error('synthetic process crash after context verifier return');
        error.code = 'PROCESS_CRASH_AFTER_VERIFIER';
        throw error;
      },
    }),
    (error) => error?.code === 'PROCESS_CRASH_AFTER_VERIFIER',
  );
  const handoff = storage.casWrites.find((entries) => entries.some((entry) => entry.key === receiptKeyForOrder(payload.id)));
  assert.equal(handoff.length, 5, 'two exact source guards and three durable authority records must publish atomically');
  assert.deepEqual(handoff.slice(0, 2).map((entry) => entry.key).sort(), [
    `checkout-context:${contextId}`,
    `preview:${token}`,
  ].sort());
  storage.values.delete(`checkout-context:${contextId}`);
  storage.values.delete(`preview:${token}`);
  const recovered = await verifiedOrReceiptedPaidReadingAuthorities({ ...row, attempts: 2 }, env);
  assert.equal(recovered.checkout.contextId, contextId);
  assert.equal(recovered.checkout.verifiedFields.cards, fields.cards);
});

test('preview verification publishes its exact snapshot and pointer handoff before returning', async () => {
  const { verifiedOrReceiptedPaidReadingAuthorities } = await loadQueueProcessor();
  const fixture = retryAuthorityFixture('preview');
  const now = Date.now();
  const preview = fixture.verified.preview;
  const token = preview.token;
  const snapshot = {
    schemaVersion: 2,
    snapshotVersion: 'reading-snapshot-v2',
    readingId: preview.verifiedFields.readingId,
    fields: { ...preview.verifiedFields, snapshotFingerprint: '' },
    question: fixture.question,
    focus: '',
    conversationId: preview.verifiedFields.conversationId,
    ownerVisitorHash: preview.ownerVisitorHash,
    createdAt: new Date(now - 5_000).toISOString(),
  };
  const pointer = {
    schemaVersion: 2,
    snapshotVersion: 'reading-snapshot-v2',
    token,
    question: fixture.question,
    fields: { readingId: preview.verifiedFields.readingId },
    conversationId: preview.verifiedFields.conversationId,
    createdAt: now - 5_000,
    expiresAt: now + 60 * 60_000,
    approvalStatus: 'approved',
    approvedAt: now - 4_000,
  };
  const snapshotKey = `preview:${token}`;
  const pointerKey = `preview-current:${preview.ownerVisitorHash}`;
  const storage = atomicReceiptCache([
    [snapshotKey, JSON.stringify(snapshot)],
    [pointerKey, JSON.stringify(pointer)],
  ]);
  const secret = 'preview-handoff-secret';
  const env = {
    READINGS_CACHE: storage.cache,
    INTERNAL_ORDER_REPLAY_SECRET: secret,
    SHOPIFY_WEBHOOK_SECRET: secret,
    ...paidReceiptKeyEnv(secret),
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
  };
  await assert.rejects(
    verifiedOrReceiptedPaidReadingAuthorities(fixture.row, env, undefined, {
      afterVerify() {
        const error = new Error('synthetic process crash after preview verifier return');
        error.code = 'PROCESS_CRASH_AFTER_VERIFIER';
        throw error;
      },
    }),
    (error) => error?.code === 'PROCESS_CRASH_AFTER_VERIFIER',
  );
  const handoff = storage.casWrites.find((entries) => entries.some((entry) => entry.key === receiptKeyForOrder(fixture.orderId)));
  assert.equal(handoff.length, 5);
  assert.deepEqual(handoff.slice(0, 2).map((entry) => entry.key).sort(), [pointerKey, snapshotKey].sort());
  storage.values.delete(pointerKey);
  storage.values.delete(snapshotKey);
  const recovered = await verifiedOrReceiptedPaidReadingAuthorities({ ...fixture.row, attempts: 2 }, env);
  assert.equal(recovered.preview.token, token);
  assert.equal(recovered.preview.verifiedFields.cards, preview.verifiedFields.cards);
});

test('an authority source that expires while the atomic handoff waits cannot publish a receipt', async () => {
  const { verifiedOrReceiptedPaidReadingAuthorities } = await loadQueueProcessor();
  const fixture = retryAuthorityFixture('preview');
  const sourceKey = 'preview:expiring-authority-source';
  const sourceBytes = JSON.stringify({ schemaVersion: 2, authority: 'active' });
  const values = new Map([[sourceKey, sourceBytes]]);
  const realDateNow = Date.now;
  let now = Math.floor(realDateNow() / 1_000) * 1_000;
  const sourceExpiresAt = now + 1_000;
  let casCalls = 0;
  const cache = {
    async get(key) {
      return values.get(key) ?? null;
    },
    async compareAndSetMany(entries) {
      casCalls += 1;
      // Model the transaction waiting on the source row lock until after its
      // authoritative absolute expiry. PostgreSQL must reject the expected-
      // value UPDATE even though the stale bytes still match physically.
      now = sourceExpiresAt + 1;
      if (entries.some((entry) => entry.key === sourceKey
        && entry.expectedValue === sourceBytes
        && entry.options?.expiration * 1_000 <= now)) return false;
      if (entries.some((entry) => (values.get(entry.key) ?? null) !== (entry.expectedValue ?? null))) return false;
      for (const entry of entries) {
        if (entry.value == null) values.delete(entry.key);
        else values.set(entry.key, entry.value);
      }
      return true;
    },
  };
  const env = {
    READINGS_CACHE: cache,
    INTERNAL_ORDER_REPLAY_SECRET: 'expiring-source-receipt-secret',
    SHOPIFY_WEBHOOK_SECRET: 'expiring-source-receipt-secret',
    ...paidReceiptKeyEnv('expiring-source-receipt-secret'),
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
  };
  Date.now = () => now;
  try {
    await assert.rejects(
      verifiedOrReceiptedPaidReadingAuthorities(fixture.row, env, async (_payload, _runtimeEnv, publish) => (
        publish(fixture.verified, [{
          key: sourceKey,
          expectedValue: sourceBytes,
          value: sourceBytes,
          options: { expiration: sourceExpiresAt / 1_000 },
        }])
      )),
      authorityError('PAID_READING_AUTHORITY_SOURCE_CHANGED'),
    );
  } finally {
    Date.now = realDateNow;
  }
  assert.equal(casCalls, 1);
  assert.deepEqual([...values.entries()], [[sourceKey, sourceBytes]]);
  assert.equal(values.has(receiptKeyForOrder(fixture.orderId)), false);
  assert.equal([...values.keys()].some((key) => key.startsWith('paid-draft:') || key.startsWith('paid-access:')), false);

  const workerEnv = await readFile(new URL('lib/worker-env.ts', root), 'utf8');
  const casStart = workerEnv.indexOf('async compareAndSetMany(entries: KvCompareAndSetEntry[])');
  const casEnd = workerEnv.indexOf('class PostgresLimiterNamespace', casStart);
  const casSource = workerEnv.slice(casStart, casEnd);
  const advisoryLock = casSource.indexOf('pg_advisory_xact_lock');
  const mutationLoop = casSource.indexOf('for (const entry of normalized)', advisoryLock + 1);
  assert.ok(advisoryLock >= 0 && mutationLoop > advisoryLock,
    'all sorted CAS keys must acquire an advisory transaction lock before comparisons or writes');
  assert.match(casSource, /hashtextextended\(\$\{'deckaura\.kv_store\.cas:' \+ entry\.key\}, 918273645\)/);
  assert.match(casSource, /entry\.expectedValue == null[\s\S]{0,500}select key[\s\S]{0,300}for update/,
    'null/null must be a checked absence guard after the per-key advisory lock');
  assert.match(casSource, /and \(expires_at is null or expires_at > clock_timestamp\(\)\)/);
  assert.equal(
    [...casSource.matchAll(/\(\$\{expiresAt\}::timestamptz is null or \$\{expiresAt\}::timestamptz > clock_timestamp\(\)\)/g)].length,
    3,
    'expired-row replacement, insert, and expected-value update must all reject a proposed expiry that crosses server now',
  );
});

test('an intent consumed before receipt publication can recover after expiry only for the exact paid order', async () => {
  const {
    checkoutIntentCanAuthorizeOrder,
    processUndeliveredPaidOrder,
    verifiedOrReceiptedPaidReadingAuthorities,
  } = await loadQueueProcessor();
  const fixture = retryAuthorityFixture('intent');
  const storage = atomicReceiptCache();
  const secret = 'intent-crash-recovery-secret';
  const env = {
    READINGS_CACHE: storage.cache,
    INTERNAL_ORDER_REPLAY_SECRET: secret,
    SHOPIFY_WEBHOOK_SECRET: secret,
    ...paidReceiptKeyEnv(secret),
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
  };
  const beforeExpiry = Date.parse('2026-08-17T09:31:00.000Z');
  const afterExpiry = beforeExpiry + 120_000;
  const simulatedIntentRow = {
    status: 'pending',
    order_id: null,
    expires_at: new Date(beforeExpiry + 60_000).toISOString(),
  };
  let currentTime = beforeExpiry;
  let crashBeforeReceipt = true;
  let verifierCalls = 0;
  const verifier = async (payload, _runtimeEnv, publish) => {
    verifierCalls += 1;
    assert.equal(checkoutIntentCanAuthorizeOrder(simulatedIntentRow, payload, currentTime), true);
    if (crashBeforeReceipt) {
      crashBeforeReceipt = false;
      // This models the production checkout_intents UPDATE committing before
      // the process dies, while no receipt CAS has run yet.
      simulatedIntentRow.status = 'paid';
      simulatedIntentRow.order_id = fixture.orderId;
      const error = new Error('synthetic process crash after intent consume');
      error.code = 'PROCESS_CRASH_AFTER_INTENT_CONSUME';
      throw error;
    }
    return publish(fixture.verified, []);
  };
  await assert.rejects(
    verifiedOrReceiptedPaidReadingAuthorities(fixture.row, env, verifier),
    (error) => error?.code === 'PROCESS_CRASH_AFTER_INTENT_CONSUME',
  );
  assert.equal(storage.values.has(receiptKeyForOrder(fixture.orderId)), false);

  currentTime = afterExpiry;
  assert.equal(checkoutIntentCanAuthorizeOrder(simulatedIntentRow, fixture.payload, currentTime), true);
  assert.equal(checkoutIntentCanAuthorizeOrder(simulatedIntentRow, {
    ...fixture.payload,
    id: 'different-paid-order',
  }, currentTime), false);
  const recovered = await verifiedOrReceiptedPaidReadingAuthorities({ ...fixture.row, attempts: 2 }, env, verifier);
  assert.equal(recovered.intent.intentId, fixture.verified.intent.intentId);
  assert.equal(verifierCalls, 2);
  assert.equal(storage.values.has(receiptKeyForOrder(fixture.orderId)), true);

  let enqueueCalls = 0;
  const resumed = await processUndeliveredPaidOrder({ ...fixture.row, attempts: 3 }, env, {
    verifyAuthorities: async () => {
      throw new Error('durable receipt retry must not re-read the intent row');
    },
    replay: replayPaidWebhookThroughLegacy,
    validateMembership: async () => {},
    enqueue: async () => {
      enqueueCalls += 1;
      return { queued: true };
    },
  });
  assert.equal(resumed.verifiedAuthorities.intent.intentId, fixture.verified.intent.intentId);
  assert.equal(enqueueCalls, 1);

  const queue = await readFile(new URL('lib/reading-queue-processor.ts', root), 'utf8');
  assert.match(queue, /\(status = 'pending' and expires_at > clock_timestamp\(\)\)/);
  assert.match(queue, /or \(status = 'paid' and order_id = \$\{orderId\}\)/);
});

test('successor receipt cutover preserves only an exact-order legacy customer review state', async () => {
  const { processUndeliveredPaidOrder, verifiedOrReceiptedPaidReadingAuthorities } = await loadQueueProcessor();
  const fixture = retryAuthorityFixture('preview');
  const secret = 'legacy-draft-receipt-cutover-secret';
  const accessToken = '9'.repeat(32);
  const draftKey = `paid-draft:${fixture.orderId}`;
  const accessKey = `paid-access:${accessToken}`;
  const originalQuestion = fixture.question;
  const editedQuestion = `What grounded guidance should this exact preview order preserve after a delayed retry?`;
  const createdAt = Date.parse(fixture.payload.created_at);
  const legacyDraft = {
    schemaVersion: 2,
    orderId: fixture.orderId,
    accessToken,
    originalQuestion,
    question: editedQuestion,
    status: 'confirmed',
    editCount: 1,
    missingQuestion: false,
    createdAt,
    reviewUntil: createdAt + 40 * 60_000,
    confirmedAt: createdAt + 10 * 60_000,
    editedAt: createdAt + 9 * 60_000,
    reviewEmailSentAt: createdAt + 2 * 60_000,
    verifiedFields: {
      question: 'Forged legacy browser question that must not survive.',
      cards: 'Forged legacy browser evidence that must not survive.',
    },
  };
  const storage = atomicReceiptCache([
    [draftKey, JSON.stringify(legacyDraft)],
    [accessKey, fixture.orderId],
  ]);
  const env = {
    READINGS_CACHE: storage.cache,
    INTERNAL_ORDER_REPLAY_SECRET: secret,
    SHOPIFY_WEBHOOK_SECRET: secret,
    ...paidReceiptKeyEnv(secret),
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
  };

  await verifiedOrReceiptedPaidReadingAuthorities(fixture.row, env, async () => fixture.verified);
  let cutoverDraft = JSON.parse(storage.values.get(draftKey));
  assert.equal(cutoverDraft.originalQuestion, originalQuestion);
  assert.equal(cutoverDraft.question, editedQuestion);
  assert.equal(cutoverDraft.status, 'confirmed');
  assert.equal(cutoverDraft.editCount, 1);
  assert.equal(cutoverDraft.missingQuestion, false);
  assert.equal(cutoverDraft.createdAt, legacyDraft.createdAt);
  assert.equal(cutoverDraft.reviewUntil, legacyDraft.reviewUntil);
  assert.equal(cutoverDraft.confirmedAt, legacyDraft.confirmedAt);
  assert.equal(cutoverDraft.editedAt, legacyDraft.editedAt);
  assert.equal(cutoverDraft.reviewEmailSentAt, legacyDraft.reviewEmailSentAt);
  assert.equal(cutoverDraft.accessToken, accessToken);
  assert.equal(cutoverDraft.verifiedFields.question, fixture.verified.preview.verifiedFields.question);
  assert.equal(cutoverDraft.verifiedFields.cards, fixture.verified.preview.verifiedFields.cards);
  assert.notEqual(cutoverDraft.verifiedFields.cards, legacyDraft.verifiedFields.cards);
  assert.equal(cutoverDraft.authorityReceiptVersion, 'paid-reading-authority-receipt-v2');

  await replayPaidWebhookThroughLegacy(fixture.row, env);
  cutoverDraft = JSON.parse(storage.values.get(draftKey));
  assert.equal(cutoverDraft.question, editedQuestion);
  assert.equal(cutoverDraft.status, 'confirmed');
  assert.equal(cutoverDraft.editCount, 1);
  const verifiedCutoverDraft = await verifiedPaidReadingDraftAuthority(fixture.payload, cutoverDraft, env);
  const hydrated = await hydratePaidReadingItemFields({
    freeToken: fixture.verified.preview.token,
    question: 'Browser retry copy must not replace receipt evidence.',
  }, verifiedCutoverDraft, 0, env);
  assert.equal(hydrated.freeToken, '');
  assert.equal(hydrated.question, editedQuestion,
    'the exact-order server-reviewed question must be the question used for paid generation');
  assert.equal(hydrated.originalPaidQuestion, fixture.verified.preview.verifiedFields.question,
    'the receipt-owned original question remains available for subject-continuity validation');
  assert.equal(hydrated.cards, fixture.verified.preview.verifiedFields.cards);

  const persistedOrders = [];
  const deliveryJobs = [];
  const processed = await processUndeliveredPaidOrder({ ...fixture.row, attempts: 2 }, env, {
    verifyAuthorities: async () => {
      throw new Error('the exact-order durable receipt must authorize this retry');
    },
    replay: replayPaidWebhookThroughLegacy,
    validateMembership: async () => {},
    enqueueOperations: {
      persistPaidOrder: async (...args) => persistedOrders.push(args),
      recordEvents: async () => ({ accepted: 1, duplicate: 0, limited: false }),
      enqueueDelivery: async (job) => {
        deliveryJobs.push(job);
        return { order_id: fixture.orderId, status: 'queued' };
      },
    },
  });
  assert.equal(processed.replay.ignored, false);
  assert.equal(persistedOrders.length, 1, 'the real enqueue path must persist one paid-order projection');
  assert.equal(deliveryJobs.length, 1, 'the real enqueue path must publish one deterministic delivery job');
  const persistedDraft = persistedOrders[0][2];
  assert.equal(persistedDraft.question, editedQuestion);
  assert.equal(persistedDraft.originalQuestion, originalQuestion);
  assert.equal(persistedDraft.status, 'confirmed');
  assert.equal(persistedDraft.editCount, 1);
  assert.equal(persistedDraft.verifiedFields.question, fixture.verified.preview.verifiedFields.question);
  assert.equal(persistedDraft.verifiedFields.cards, fixture.verified.preview.verifiedFields.cards);
  assert.notEqual(persistedDraft.verifiedFields.cards, legacyDraft.verifiedFields.cards);
  assert.equal(deliveryJobs[0].orderId, fixture.orderId);
  cutoverDraft = JSON.parse(storage.values.get(draftKey));
  assert.equal(cutoverDraft.question, editedQuestion);
  assert.equal(cutoverDraft.status, 'confirmed');
  assert.equal(cutoverDraft.editCount, 1);

  const mismatchedStorage = atomicReceiptCache([
    [draftKey, JSON.stringify(legacyDraft)],
    [accessKey, 'different-order'],
  ]);
  await assert.rejects(
    verifiedOrReceiptedPaidReadingAuthorities(fixture.row, {
      ...env,
      READINGS_CACHE: mismatchedStorage.cache,
    }, async () => fixture.verified),
    authorityError('PAID_READING_AUTHORITY_RECEIPT_INVALID'),
  );
  assert.equal(mismatchedStorage.values.has(receiptKeyForOrder(fixture.orderId)), false);
});

test('successor receipt cutover preserves an imported pending review window without delaying fresh receipts', async () => {
  const { processUndeliveredPaidOrder } = await loadQueueProcessor();
  const fixture = retryAuthorityFixture('preview');
  const accessToken = '8'.repeat(32);
  const now = Date.now();
  const pendingQuestion = 'What grounded guidance should remain open for my exact pending review?';
  const pendingDraft = {
    schemaVersion: 2,
    orderId: fixture.orderId,
    accessToken,
    originalQuestion: pendingQuestion,
    question: pendingQuestion,
    status: 'pending',
    editCount: 0,
    missingQuestion: false,
    createdAt: now - 60_000,
    reviewUntil: now + 30 * 60_000,
    reviewEmailSentAt: now - 30_000,
    verifiedFields: {
      question: 'Forged pending browser question that must not become evidence.',
      cards: 'Forged pending browser cards that must not become evidence.',
    },
  };
  const draftKey = `paid-draft:${fixture.orderId}`;
  const storage = atomicReceiptCache([
    [draftKey, JSON.stringify(pendingDraft)],
    [`paid-access:${accessToken}`, fixture.orderId],
  ]);
  const env = {
    READINGS_CACHE: storage.cache,
    INTERNAL_ORDER_REPLAY_SECRET: 'pending-legacy-cutover-secret',
    SHOPIFY_WEBHOOK_SECRET: 'pending-legacy-cutover-secret',
    ...paidReceiptKeyEnv('pending-legacy-cutover-secret'),
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
  };
  const persistedOrders = [];
  const deliveryJobs = [];
  const processed = await processUndeliveredPaidOrder({ ...fixture.row, attempts: 2 }, env, {
    verifyAuthorities: async () => fixture.verified,
    replay: replayPaidWebhookThroughLegacy,
    validateMembership: async () => {},
    enqueueOperations: {
      persistPaidOrder: async (...args) => { persistedOrders.push(args); },
      recordEvents: async () => ({ accepted: 1, duplicate: 0, limited: false }),
      enqueueDelivery: async (job) => {
        deliveryJobs.push(job);
        return { order_id: fixture.orderId, status: 'queued' };
      },
    },
  });
  assert.equal(processed.replay.ignored, false);
  assert.equal(persistedOrders.length, 1);
  assert.equal(deliveryJobs.length, 1);
  const finalDraft = JSON.parse(storage.values.get(draftKey));
  const paidOrderDraft = persistedOrders[0][2];
  for (const draft of [finalDraft, paidOrderDraft]) {
    assert.equal(draft.question, pendingQuestion);
    assert.equal(draft.originalQuestion, pendingQuestion);
    assert.equal(draft.status, 'pending');
    assert.equal(draft.reviewUntil, pendingDraft.reviewUntil);
    assert.equal(draft.reviewEmailSentAt, pendingDraft.reviewEmailSentAt);
    assert.equal(draft.legacyReviewStatePreserved, true);
    assert.equal(draft.verifiedFields.question, fixture.verified.preview.verifiedFields.question);
    assert.equal(draft.verifiedFields.cards, fixture.verified.preview.verifiedFields.cards);
    assert.notEqual(draft.verifiedFields.cards, pendingDraft.verifiedFields.cards);
  }
  assert.ok(deliveryJobs[0].dueAt.getTime() >= pendingDraft.reviewUntil + 5 * 60_000,
    'the imported pending review window must remain ahead of automated generation');

  const freshFixture = retryAuthorityFixture('context');
  const freshStorage = atomicReceiptCache();
  const freshPersistedOrders = [];
  await processUndeliveredPaidOrder(freshFixture.row, {
    ...env,
    READINGS_CACHE: freshStorage.cache,
  }, {
    verifyAuthorities: async () => freshFixture.verified,
    replay: replayPaidWebhookThroughLegacy,
    validateMembership: async () => {},
    enqueueOperations: {
      persistPaidOrder: async (...args) => { freshPersistedOrders.push(args); },
      recordEvents: async () => ({ accepted: 1, duplicate: 0, limited: false }),
      enqueueDelivery: async () => ({ order_id: freshFixture.orderId, status: 'queued' }),
    },
  });
  const freshDraft = JSON.parse(freshStorage.values.get(`paid-draft:${freshFixture.orderId}`));
  assert.equal(freshPersistedOrders.length, 1);
  assert.equal(freshDraft.status, 'auto_locked', 'a new successor receipt must not inherit the legacy review hold');
  assert.equal(freshDraft.reviewUntil, freshDraft.createdAt);
  assert.equal(freshDraft.confirmedAt, freshDraft.createdAt);
  assert.equal(freshDraft.reviewEmailSentAt, undefined);
  assert.equal(freshDraft.legacyReviewStatePreserved, undefined);

  const missingFixture = retryAuthorityFixture('context');
  const missingLine = {
    ...missingFixture.line,
    properties: missingFixture.line.properties.filter((property) => (
      String(property.name).trim().toLowerCase() !== 'your question'
    )),
  };
  const missingPayload = { ...missingFixture.payload, line_items: [missingLine] };
  const missingRow = { ...missingFixture.row, payload: missingPayload };
  const missingVerified = {
    ...missingFixture.verified,
    items: [missingLine],
    checkout: {
      ...missingFixture.verified.checkout,
      verifiedFields: { ...missingFixture.verified.checkout.verifiedFields, question: '' },
    },
  };
  const missingStorage = atomicReceiptCache();
  await processUndeliveredPaidOrder(missingRow, {
    ...env,
    READINGS_CACHE: missingStorage.cache,
  }, {
    verifyAuthorities: async () => missingVerified,
    replay: replayPaidWebhookThroughLegacy,
    validateMembership: async () => {},
    enqueueOperations: {
      persistPaidOrder: async () => {},
      recordEvents: async () => ({ accepted: 1, duplicate: 0, limited: false }),
      enqueueDelivery: async () => ({ order_id: missingFixture.orderId, status: 'queued' }),
    },
  });
  const missingDraft = JSON.parse(missingStorage.values.get(`paid-draft:${missingFixture.orderId}`));
  assert.equal(missingDraft.status, 'pending');
  assert.equal(missingDraft.missingQuestion, true);
  assert.ok(missingDraft.reviewUntil > missingDraft.createdAt);
});

test('queue draft CAS reloads a concurrent secure question confirmation instead of overwriting it', async () => {
  const { processUndeliveredPaidOrder, verifiedOrReceiptedPaidReadingAuthorities } = await loadQueueProcessor();
  const fixture = retryAuthorityFixture('preview');
  const accessToken = '7'.repeat(32);
  const createdAt = Date.parse(fixture.payload.created_at);
  const draftKey = `paid-draft:${fixture.orderId}`;
  const originalQuestion = fixture.verified.preview.verifiedFields.question;
  const editedQuestion = 'What grounded guidance should this exact saved preview emphasize for my next step?';
  const legacyPending = {
    schemaVersion: 2,
    orderId: fixture.orderId,
    accessToken,
    originalQuestion,
    question: originalQuestion,
    status: 'pending',
    editCount: 0,
    missingQuestion: false,
    createdAt,
    reviewUntil: createdAt + 40 * 60_000,
  };
  const storage = atomicReceiptCache([
    [draftKey, JSON.stringify(legacyPending)],
    [`paid-access:${accessToken}`, fixture.orderId],
  ]);
  const secret = 'queue-review-cas-secret';
  const env = {
    READINGS_CACHE: storage.cache,
    INTERNAL_ORDER_REPLAY_SECRET: secret,
    SHOPIFY_WEBHOOK_SECRET: secret,
    ...paidReceiptKeyEnv(secret),
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
  };
  await verifiedOrReceiptedPaidReadingAuthorities(fixture.row, env, async () => fixture.verified);

  const baseCas = storage.cache.compareAndSetMany.bind(storage.cache);
  let injected = false;
  storage.cache.compareAndSetMany = async (entries) => {
    if (!injected && entries.length === 1 && entries[0].key === draftKey) {
      injected = true;
      const current = JSON.parse(storage.values.get(draftKey));
      storage.values.set(draftKey, JSON.stringify({
        ...current,
        question: editedQuestion,
        status: 'confirmed',
        editCount: 1,
        confirmedAt: createdAt + 5 * 60_000,
        editedAt: createdAt + 5 * 60_000,
      }));
      return false;
    }
    return baseCas(entries);
  };
  const persistedOrders = [];
  await processUndeliveredPaidOrder({ ...fixture.row, attempts: 2 }, env, {
    verifyAuthorities: async () => { throw new Error('receipt retry must not reverify'); },
    replay: async () => ({ ignored: false }),
    validateMembership: async () => {},
    enqueueOperations: {
      persistPaidOrder: async (...args) => { persistedOrders.push(args); },
      recordEvents: async () => ({ accepted: 1, duplicate: 0, limited: false }),
      enqueueDelivery: async () => ({ order_id: fixture.orderId, status: 'queued' }),
    },
  });
  assert.equal(injected, true);
  assert.equal(persistedOrders.length, 1);
  const finalDraft = JSON.parse(storage.values.get(draftKey));
  assert.equal(finalDraft.question, editedQuestion);
  assert.equal(finalDraft.status, 'confirmed');
  assert.equal(finalDraft.editCount, 1);
  assert.equal(finalDraft.verifiedFields.cards, fixture.verified.preview.verifiedFields.cards);
  assert.equal(persistedOrders[0][2].question, editedQuestion);
  assert.equal(persistedOrders[0][2].status, 'confirmed');
});

for (const kind of ['intent', 'context', 'preview']) {
  test(`${kind} authority receipt survives a downstream failure and resumes through real legacy replay after source expiry`, async () => {
    const { processUndeliveredPaidOrder } = await loadQueueProcessor();
    const fixture = retryAuthorityFixture(kind);
    const receiptKind = kind === 'context' ? 'checkout' : kind;
    const sourceKey = `mutable-authority:${kind}`;
    const token = fixture.verified[kind === 'context' ? 'checkout' : kind].verifiedFields.freeToken;
    const storage = atomicReceiptCache([[sourceKey, 'active']]);
    const originalGet = storage.cache.get.bind(storage.cache);
    let mutablePreviewReads = 0;
    storage.cache.get = async (key, type) => {
      if (key === `preview:${token}`) mutablePreviewReads += 1;
      return originalGet(key, type);
    };
    const secret = `durable-receipt-secret-${kind}`;
    const env = {
      READINGS_CACHE: storage.cache,
      INTERNAL_ORDER_REPLAY_SECRET: secret,
      SHOPIFY_WEBHOOK_SECRET: secret,
      ...paidReceiptKeyEnv(secret),
      PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
    };
    let verifierCalls = 0;
    const verifier = async () => {
      verifierCalls += 1;
      if (await storage.cache.get(sourceKey) !== 'active') {
        const error = new Error(`${kind} authority expired`);
        error.code = `${kind.toUpperCase()}_AUTHORITY_EXPIRED`;
        throw error;
      }
      return fixture.verified;
    };
    let replayAttempts = 0;
    let emailSends = 0;
    let failDownstream = true;
    const jobIdentities = new Set();
    const generationIdentities = new Set();
    const dependencies = {
      verifyAuthorities: verifier,
      replay: async (row, runtimeEnv) => {
        replayAttempts += 1;
        const result = await replayPaidWebhookThroughLegacy(row, runtimeEnv);
        const draftKey = `paid-draft:${fixture.orderId}`;
        const draft = JSON.parse(storage.values.get(draftKey));
        if (!draft.reviewEmailSentAt) {
          emailSends += 1;
          draft.reviewEmailSentAt = Date.parse('2026-08-17T09:31:00.000Z');
          draft.verifiedFields = {
            ...draft.verifiedFields,
            persistedServerField: `preserved-${kind}`,
          };
          await storage.cache.put(draftKey, JSON.stringify(draft), { expirationTtl: 365 * 24 * 60 * 60 });
        }
        return result;
      },
      validateMembership: async () => {},
      enqueue: async (queuedRow, runtimeEnv, restored) => {
        assert.equal(restored[kind === 'context' ? 'checkout' : kind].verifiedFields.receiptAuthority, kind);
        // These are the production idempotency identities used by the paid
        // order/delivery paths. A retry may revisit the boundary but cannot
        // mint a second logical job or generation for the same order.
        jobIdentities.add(`paid-reading:${fixture.orderId}`);
        generationIdentities.add(`reading:${fixture.orderId}`);
        if (failDownstream) {
          failDownstream = false;
          const error = new Error('synthetic downstream persistence failure');
          error.code = 'SYNTHETIC_DOWNSTREAM_FAILURE';
          throw error;
        }
        const draft = JSON.parse(storage.values.get(`paid-draft:${fixture.orderId}`));
        const readsBeforeHydration = mutablePreviewReads;
        const verifiedDraft = await verifiedPaidReadingDraftAuthority(queuedRow.payload, draft, runtimeEnv);
        const hydrated = await hydratePaidReadingItemFields({
          freeToken: token,
          question: 'Browser copy must not replace receipt evidence.',
        }, verifiedDraft, 0, runtimeEnv);
        assert.equal(mutablePreviewReads, readsBeforeHydration,
          'receipt-bound hydration must not re-read an expired preview token');
        assert.equal(hydrated.freeToken, '');
        assert.equal(hydrated.receiptAuthority, kind);
        assert.equal(hydrated.persistedServerField, undefined,
          'an old worker cannot add receipt-trusted evidence by editing draft.verifiedFields');
        assert.equal(hydrated.cards, fixture.verified[kind === 'context' ? 'checkout' : kind].verifiedFields.cards);
        return { queued: true };
      },
    };

    await assert.rejects(
      processUndeliveredPaidOrder(fixture.row, env, dependencies),
      (error) => error?.code === 'SYNTHETIC_DOWNSTREAM_FAILURE',
    );
    const receiptKey = receiptKeyForOrder(fixture.orderId);
    const receiptBytes = storage.values.get(receiptKey);
    assert.equal(typeof receiptBytes, 'string');
    const receipt = JSON.parse(receiptBytes);
    assert.equal(receipt.orderId, fixture.orderId);
    assert.equal(receipt.authorityKind, receiptKind);
    assert.equal(receipt.lineKey, `id:${fixture.line.id}`);
    assert.equal(receipt.variantId, String(fixture.line.variant_id));
    assert.equal(receipt.sku, fixture.line.sku);
    assert.match(receipt.accessToken, /^[a-f0-9]{32}$/);
    assert.equal(storage.values.get(`paid-access:${receipt.accessToken}`), fixture.orderId);
    assert.match(receipt.lineDigest, /^[a-f0-9]{64}$/);
    assert.match(receipt.signature, /^[a-f0-9]{64}$/);
    assert.equal(storage.casWrites[0].length, 3, 'receipt, draft, and access must publish in one CAS');
    const receiptWrite = storage.casWrites[0].find((entry) => entry.key === receiptKey);
    assert.equal(receiptWrite.options?.expiration, Math.floor(receipt.expiresAt / 1_000));
    assert.ok(storage.casWrites[0]
      .filter((entry) => entry.key.startsWith('paid-draft:') || entry.key.startsWith('paid-access:'))
      .every((entry) => entry.options?.expirationTtl === 365 * 24 * 60 * 60));

    storage.values.delete(sourceKey);
    storage.values.delete(`preview:${token}`);
    const retry = await processUndeliveredPaidOrder({ ...fixture.row, attempts: 2 }, env, dependencies);
    assert.equal(retry.replay.ignored, false);
    assert.equal(verifierCalls, 1, 'retry must not touch the expired mutable authority');
    assert.equal(replayAttempts, 2, 'the real legacy replay remains retryable after receipt publication');
    assert.equal(emailSends, 1, 'the receipt CAS must preserve the legacy email marker');
    assert.equal(jobIdentities.size, 1);
    assert.equal(generationIdentities.size, 1);
    assert.equal(storage.values.get(receiptKey), receiptBytes, 'the durable HMAC receipt is immutable across retry');
    const finalDraft = JSON.parse(storage.values.get(`paid-draft:${fixture.orderId}`));
    assert.equal(finalDraft.authorityReceiptVersion, 'paid-reading-authority-receipt-v2');
    assert.equal(finalDraft.authorityReceiptSignature, receipt.signature);
    assert.equal(finalDraft.authorityReceiptKind, receiptKind);
    assert.equal(finalDraft.authorityReceiptLineDigest, receipt.lineDigest);
    assert.equal(finalDraft.verifiedFields.persistedServerField, undefined);
    const accessEntries = [...storage.values.entries()].filter(([key]) => key.startsWith('paid-access:'));
    assert.equal(accessEntries.length, 1);
    assert.equal(accessEntries[0][1], fixture.orderId);
  });
}

test('successor rebinds old-worker draft and reading overwrites after enqueue before generation', async () => {
  const { processUndeliveredPaidOrder } = await loadQueueProcessor();
  const fixture = retryAuthorityFixture('preview');
  const storage = atomicReceiptCache();
  const secret = 'mixed-worker-rebind-secret';
  const env = {
    READINGS_CACHE: storage.cache,
    INTERNAL_ORDER_REPLAY_SECRET: secret,
    SHOPIFY_WEBHOOK_SECRET: secret,
    ...paidReceiptKeyEnv(secret),
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
    SHOPIFY_STORE_DOMAIN: 'example.myshopify.com',
    SHOPIFY_ADMIN_TOKEN: 'test-admin-token',
  };
  const attackerQuestion = 'Storefront supplied question that has no server authority.';
  const attackerCards = 'Storefront supplied cards that have no server authority.';
  let replayCalls = 0;
  let enqueueCalls = 0;

  await processUndeliveredPaidOrder(fixture.row, env, {
    verifyAuthorities: async () => fixture.verified,
    replay: async (row, runtimeEnv) => {
      replayCalls += 1;
      return replayPaidWebhookThroughLegacy(row, runtimeEnv);
    },
    validateMembership: async () => {},
    enqueue: async () => {
      enqueueCalls += 1;
      const rebound = JSON.parse(storage.values.get(`paid-draft:${fixture.orderId}`));
      assert.equal(rebound.authorityReceiptVersion, 'paid-reading-authority-receipt-v2');
      assert.match(rebound.authorityReceiptSignature, /^[a-f0-9]{64}$/);
      assert.equal(rebound.verifiedFields.question, fixture.verified.preview.verifiedFields.question);
      assert.equal(rebound.verifiedFields.cards, fixture.verified.preview.verifiedFields.cards);
      assert.notEqual(rebound.verifiedFields.question, attackerQuestion);
      assert.notEqual(rebound.verifiedFields.cards, attackerCards);
      return { queued: true };
    },
  });

  assert.equal(replayCalls, 1);
  assert.equal(enqueueCalls, 1);

  const draftKey = `paid-draft:${fixture.orderId}`;
  const receiptBoundDraft = JSON.parse(storage.values.get(draftKey));
  const receipt = JSON.parse(storage.values.get(receiptKeyForOrder(fixture.orderId)));
  const staleAccessToken = receiptBoundDraft.accessToken === 'f'.repeat(32) ? 'e'.repeat(32) : 'f'.repeat(32);
  const staleLegacyDraft = {
    schemaVersion: 2,
    orderId: fixture.orderId,
    accessToken: staleAccessToken,
    originalQuestion: attackerQuestion,
    question: attackerQuestion,
    status: 'auto_locked',
    editCount: 0,
    missingQuestion: false,
    createdAt: receiptBoundDraft.createdAt,
    reviewUntil: receiptBoundDraft.reviewUntil,
    confirmedAt: receiptBoundDraft.createdAt,
    verifiedFields: {
      question: attackerQuestion,
      cards: attackerCards,
      freeToken: fixture.verified.preview.token,
    },
  };
  // The old invocation outlives the successor lease and writes after the new
  // webhook replay/enqueue has already completed. It also mints a different
  // markerless access token; the successor must restore the token HMAC-bound
  // inside the receipt rather than adopting this late mutable capability.
  await storage.cache.put(draftKey, JSON.stringify(staleLegacyDraft), { expirationTtl: 365 * 24 * 60 * 60 });
  await storage.cache.put(`paid-access:${staleAccessToken}`, fixture.orderId, { expirationTtl: 365 * 24 * 60 * 60 });
  await storage.cache.put(`reading:${fixture.orderId}`, JSON.stringify({
    html: '<p>Attacker-controlled stale reading.</p>',
    readings: [{ html: '<p>Attacker-controlled stale reading.</p>', question: attackerQuestion, cards: attackerCards }],
    total: 1,
  }), { expirationTtl: 365 * 24 * 60 * 60 });

  const reboundDraft = await verifiedPaidReadingDraftAuthority(fixture.payload, staleLegacyDraft, env);
  assert.equal(reboundDraft.accessToken, receipt.accessToken);
  assert.notEqual(reboundDraft.accessToken, staleAccessToken);
  assert.equal(storage.values.get(`paid-access:${receipt.accessToken}`), fixture.orderId);
  const hydrated = await hydratePaidReadingItemFields({
    question: attackerQuestion,
    cards: attackerCards,
    freeToken: fixture.verified.preview.token,
  }, reboundDraft, 0, env);
  assert.equal(hydrated.question, fixture.verified.preview.verifiedFields.question);
  assert.equal(hydrated.cards, fixture.verified.preview.verifiedFields.cards);
  assert.notEqual(hydrated.question, attackerQuestion);
  assert.notEqual(hydrated.cards, attackerCards);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    const body = requestUrl.includes('/orders.json?') ? { orders: [fixture.payload] } : { order: fixture.payload };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    storage.values.set(draftKey, JSON.stringify(staleLegacyDraft));
    const deliveryDraft = await verifiedPaidReadingDraftForOrderId(fixture.orderId, env);
    assert.equal(deliveryDraft.question, fixture.verified.preview.verifiedFields.question);
    assert.equal(deliveryDraft.verifiedFields.cards, fixture.verified.preview.verifiedFields.cards);
    const staleCapability = await readingsWorker.fetch(
      new Request(`https://reading.deckaura.com/r/${staleAccessToken}`),
      env,
    );
    assert.equal(staleCapability.status, 404,
      'a late markerless paid-access mapping must not borrow the receipt-bound order authority');
    assert.equal(await trustedCachedPaidReading(fixture.orderId, env), null,
      'a markerless old-worker cache must be deleted rather than served');
    assert.equal(storage.values.has(`reading:${fixture.orderId}`), false);
    const published = await publishTrustedPaidReadingRecord(fixture.orderId, {
      html: '<p>Receipt-owned generated reading.</p>',
      readings: [{
        html: '<p>Receipt-owned generated reading.</p>',
        question: hydrated.question,
        cards: hydrated.cards,
      }],
      total: 1,
    }, env);
    assert.match(published.authorityReceiptSignature, /^[a-f0-9]{64}$/);
    const trusted = await trustedCachedPaidReading(fixture.orderId, env);
    assert.match(trusted.html, /Receipt-owned generated reading/);
    assert.doesNotMatch(JSON.stringify(trusted), /Attacker-controlled|Storefront supplied/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const queueSource = await readFile(new URL('lib/reading-queue-processor.ts', root), 'utf8');
  const deliveryProjection = queueSource.slice(
    queueSource.indexOf('async function updatePaidOrderBeforeDelivery'),
    queueSource.indexOf('async function updatePaidOrderAfterDelivery'),
  );
  assert.match(deliveryProjection, /verifiedPaidReadingDraftForOrderId/);
  assert.doesNotMatch(deliveryProjection, /READINGS_CACHE\.get\(`paid-draft:/);
});

test('receipt-bound credit updates append exactly once instead of returning the unchanged cache', async () => {
  const { verifiedOrReceiptedPaidReadingAuthorities } = await loadQueueProcessor();
  const fixture = retryAuthorityFixture('preview');
  const storage = atomicReceiptCache();
  const secret = 'receipt-bound-credit-update-secret';
  const env = {
    READINGS_CACHE: storage.cache,
    INTERNAL_ORDER_REPLAY_SECRET: secret,
    SHOPIFY_WEBHOOK_SECRET: secret,
    ...paidReceiptKeyEnv(secret),
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
    SHOPIFY_STORE_DOMAIN: 'example.myshopify.com',
    SHOPIFY_ADMIN_TOKEN: 'test-admin-token',
  };
  await verifiedOrReceiptedPaidReadingAuthorities(fixture.row, env, async () => fixture.verified);
  const receipt = JSON.parse(storage.values.get(receiptKeyForOrder(fixture.orderId)));
  const cacheKey = `reading:${fixture.orderId}`;
  storage.values.set(cacheKey, JSON.stringify({
    html: '<p>Base receipt-bound reading.</p>',
    readings: [{ html: '<p>Base receipt-bound reading.</p>', requestId: 'base-reading' }],
    total: 2,
    authorityReceiptVersion: receipt.receiptVersion,
    authorityReceiptKeyId: receipt.keyId,
    authorityReceiptSignature: receipt.signature,
    authorityReceiptOrderDigest: receipt.orderDigest,
    authorityReceiptLineDigest: receipt.lineDigest,
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(JSON.stringify(
    String(url).includes('/orders.json?') ? { orders: [fixture.payload] } : { order: fixture.payload },
  ), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const requestId = 'paid-credit-request-0001';
  try {
    const first = await appendTrustedPaidReadingRecord(fixture.orderId, {
      html: '<p>New paid credit reading.</p>',
      question: 'What grounded step should I take next?',
      requestId,
    }, requestId, 2, env);
    assert.equal(first.appended, true);
    assert.equal(first.record.readings.length, 2);
    assert.equal(first.record.readings.filter((reading) => reading.requestId === requestId).length, 1);

    const retry = await appendTrustedPaidReadingRecord(fixture.orderId, {
      html: '<p>This duplicate must not be stored.</p>',
      requestId,
    }, requestId, 2, env);
    assert.equal(retry.appended, false);
    assert.equal(retry.replayed, true);
    assert.equal(retry.record.readings.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const workerSource = await readFile(new URL('lib/legacy-worker.mjs', root), 'utf8');
  const spendSlice = workerSource.slice(workerSource.indexOf('async function spendCredit('), workerSource.indexOf('__name(spendCredit'));
  assert.match(spendSlice, /appendTrustedPaidReadingRecord/);
  assert.doesNotMatch(spendSlice, /publishTrustedPaidReadingRecord/);
});

test('receipt retry accepts reconciliation transport reconstruction but rejects protected projection drift', async () => {
  const { verifiedOrReceiptedPaidReadingAuthorities } = await loadQueueProcessor();
  const { shopifyReconciledOrderPayload } = await loadReconciliation();
  const fixture = retryAuthorityFixture('preview');
  const reconciledOrderId = '9000000000001';
  const reconciledLineId = '8000000000002';
  const originalLine = {
    ...fixture.line,
    id: reconciledLineId,
    title: 'Server-side original Shopify line title',
    vendor: 'DeckAura',
    fulfillment_service: 'manual',
    tax_lines: [{ title: 'VAT', price: '0.00' }],
  };
  const originalPayload = {
    ...fixture.payload,
    id: reconciledOrderId,
    browser_ip: '203.0.113.9',
    line_items: [originalLine],
  };
  const originalRow = {
    ...fixture.row,
    order_id: reconciledOrderId,
    payload: originalPayload,
    payload_sha256: createHash('sha256').update(JSON.stringify(originalPayload), 'utf8').digest('hex'),
  };
  const originalVerified = {
    ...fixture.verified,
    items: [originalLine],
    preview: { ...fixture.verified.preview, lineKey: `id:${reconciledLineId}` },
  };
  const storage = atomicReceiptCache();
  const env = {
    READINGS_CACHE: storage.cache,
    INTERNAL_ORDER_REPLAY_SECRET: 'transport-independent-receipt-secret',
    SHOPIFY_WEBHOOK_SECRET: 'transport-independent-receipt-secret',
    ...paidReceiptKeyEnv('transport-independent-receipt-secret'),
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
  };
  await verifiedOrReceiptedPaidReadingAuthorities(originalRow, env, async () => originalVerified);

  // Admin reconciliation intentionally reconstructs a reduced order/line
  // payload and therefore changes the raw webhook hash and raw object shape.
  const rebuiltPayload = shopifyReconciledOrderPayload({
    id: `gid://shopify/Order/${reconciledOrderId}`,
    name: fixture.payload.name,
    createdAt: fixture.payload.created_at,
    updatedAt: fixture.payload.created_at,
    currencyCode: 'USD',
    email: '',
    customerAcceptsMarketing: false,
    customer: null,
    billingAddress: null,
    lineItems: {
      nodes: [{
        id: `gid://shopify/LineItem/${reconciledLineId}`,
        sku: fixture.line.sku,
        quantity: 1,
        originalUnitPriceSet: { shopMoney: { amount: '5.990' } },
        customAttributes: fixture.line.properties.map(({ name, value }) => ({ key: name, value })),
      }],
    },
  });
  const rebuiltLine = rebuiltPayload.line_items[0];
  const rebuiltRow = {
    ...fixture.row,
    order_id: reconciledOrderId,
    webhook_id: 'admin-reconciliation-rebuilt',
    payload: rebuiltPayload,
    payload_sha256: createHash('sha256').update(JSON.stringify(rebuiltPayload), 'utf8').digest('hex'),
    attempts: 2,
  };
  let fallbackCalls = 0;
  const restored = await verifiedOrReceiptedPaidReadingAuthorities(rebuiltRow, env, async () => {
    fallbackCalls += 1;
    throw new Error('receipt retry must not revalidate an expired mutable source');
  });
  assert.equal(fallbackCalls, 0);
  assert.equal(restored.preview.token, fixture.verified.preview.token);

  for (const [label, linePatch] of [
    ['variant', { variant_id: FREE_TAROT_PACKAGES.medium.variantId }],
    ['sku', { sku: FREE_TAROT_PACKAGES.medium.sku }],
    ['quantity', { quantity: 2 }],
    ['price', { price: '6.99' }],
    ['authority-property', {
      properties: rebuiltLine.properties.map((property) => (
        String(property.name).toLowerCase().replace(/^_/, '') === 'free_token'
          ? { ...property, value: 'f'.repeat(32) }
          : property
      )),
    }],
    ['question-property', {
      properties: rebuiltLine.properties.map((property) => (
        String(property.name).toLowerCase() === 'your question'
          ? { ...property, value: 'A different protected paid question.' }
          : property
      )),
    }],
  ]) {
    const changedLine = { ...rebuiltLine, ...linePatch };
    const changedPayload = { ...rebuiltPayload, line_items: [changedLine] };
    await assert.rejects(
      verifiedOrReceiptedPaidReadingAuthorities({
        ...rebuiltRow,
        webhook_id: `admin-reconciliation-tampered-${label}`,
        payload: changedPayload,
        payload_sha256: createHash('sha256').update(JSON.stringify(changedPayload), 'utf8').digest('hex'),
      }, env, async () => {
        throw new Error('tampered retry must not fall back to mutable authority');
      }),
      authorityError('PAID_READING_AUTHORITY_RECEIPT_INVALID'),
      label,
    );
  }

  for (const [label, payloadPatch] of [
    ['created-at', { created_at: '2026-08-17T09:31:00.000Z' }],
    ['currency', { currency: 'EUR' }],
  ]) {
    const changedPayload = { ...rebuiltPayload, ...payloadPatch };
    await assert.rejects(
      verifiedOrReceiptedPaidReadingAuthorities({
        ...rebuiltRow,
        webhook_id: `admin-reconciliation-tampered-${label}`,
        payload: changedPayload,
        payload_sha256: createHash('sha256').update(JSON.stringify(changedPayload), 'utf8').digest('hex'),
      }, env, async () => {
        throw new Error('tampered retry must not fall back to mutable authority');
      }),
      authorityError('PAID_READING_AUTHORITY_RECEIPT_INVALID'),
      label,
    );
  }
});

test('receipt key rotation converges previous-key receipts onto current and supports a second rotation', async () => {
  const { verifiedOrReceiptedPaidReadingAuthorities } = await loadQueueProcessor();
  const fixture = retryAuthorityFixture('preview');
  const storage = atomicReceiptCache();
  const replaySecret = 'receipt-rotation-replay-secret';
  const key1 = paidReceiptKeyEnv('rotation-secret-one', 'receipt-key-1');
  const key2 = paidReceiptKeyEnv('rotation-secret-two', 'receipt-key-2');
  const key3 = paidReceiptKeyEnv('rotation-secret-three', 'receipt-key-3');
  const runtime = (current, previous = null) => ({
    READINGS_CACHE: storage.cache,
    INTERNAL_ORDER_REPLAY_SECRET: replaySecret,
    SHOPIFY_WEBHOOK_SECRET: replaySecret,
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
    ...current,
    ...(previous ? {
      PAID_READING_AUTHORITY_RECEIPT_PREVIOUS_KEY_ID: previous.PAID_READING_AUTHORITY_RECEIPT_KEY_ID,
      PAID_READING_AUTHORITY_RECEIPT_PREVIOUS_SECRET: previous.PAID_READING_AUTHORITY_RECEIPT_SECRET,
    } : {}),
  });

  await verifiedOrReceiptedPaidReadingAuthorities(fixture.row, runtime(key1), async () => fixture.verified);
  const receiptKey = receiptKeyForOrder(fixture.orderId);
  const firstBytes = storage.values.get(receiptKey);
  const first = JSON.parse(firstBytes);
  assert.equal(first.receiptVersion, 'paid-reading-authority-receipt-v2');
  assert.equal(first.keyId, 'receipt-key-1');
  assert.match(first.accessToken, /^[a-f0-9]{32}$/);
  assert.ok(Number.isSafeInteger(first.issuedAt) && first.expiresAt > first.issuedAt);
  const readingKey = `reading:${fixture.orderId}`;
  storage.values.set(readingKey, JSON.stringify({
    html: '<p>Key-independent generated reading.</p>',
    readings: [{ html: '<p>Key-independent generated reading.</p>' }],
    total: 1,
    authorityReceiptVersion: first.receiptVersion,
    authorityReceiptKeyId: first.keyId,
    authorityReceiptSignature: first.signature,
    authorityReceiptOrderDigest: first.orderDigest,
    authorityReceiptLineDigest: first.lineDigest,
  }));

  await verifiedOrReceiptedPaidReadingAuthorities({ ...fixture.row, attempts: 2 }, runtime(key2, key1), async () => {
    throw new Error('the previous-key receipt must restore without mutable authority');
  });
  const secondBytes = storage.values.get(receiptKey);
  const second = JSON.parse(secondBytes);
  assert.equal(second.keyId, 'receipt-key-2');
  assert.notEqual(second.signature, first.signature);
  assert.equal(second.issuedAt, first.issuedAt);
  assert.equal(second.expiresAt, first.expiresAt);
  assert.equal(second.accessToken, first.accessToken);
  assert.equal(paidReadingAuthorityDigest(second), paidReadingAuthorityDigest(first));
  assert.equal(JSON.parse(storage.values.get(`paid-draft:${fixture.orderId}`)).authorityReceiptKeyId, 'receipt-key-2');
  assert.equal(JSON.parse(storage.values.get(readingKey)).authorityReceiptKeyId, 'receipt-key-2');
  assert.match(JSON.parse(storage.values.get(readingKey)).html, /Key-independent generated reading/);

  await verifiedOrReceiptedPaidReadingAuthorities({ ...fixture.row, attempts: 3 }, runtime(key3, key2), async () => {
    throw new Error('the converged key-2 receipt must support the next rotation');
  });
  const third = JSON.parse(storage.values.get(receiptKey));
  assert.equal(third.keyId, 'receipt-key-3');
  assert.equal(third.issuedAt, first.issuedAt);
  assert.equal(third.expiresAt, first.expiresAt);
  assert.equal(third.accessToken, first.accessToken);
  assert.equal(paidReadingAuthorityDigest(third), paidReadingAuthorityDigest(first));
  assert.equal(JSON.parse(storage.values.get(`paid-draft:${fixture.orderId}`)).authorityReceiptKeyId, 'receipt-key-3');
  assert.equal(JSON.parse(storage.values.get(readingKey)).authorityReceiptKeyId, 'receipt-key-3');
  assert.equal(storage.values.get(`paid-access:${first.accessToken}`), fixture.orderId);

  const noPreviousStorage = atomicReceiptCache([...new Map([
    ...storage.values,
    [receiptKey, firstBytes],
  ])]);
  await assert.rejects(
    verifiedOrReceiptedPaidReadingAuthorities(fixture.row, {
      ...runtime(key2),
      READINGS_CACHE: noPreviousStorage.cache,
    }, async () => fixture.verified),
    authorityError('PAID_READING_AUTHORITY_RECEIPT_INVALID'),
  );

  const tamperedStorage = atomicReceiptCache([...storage.values]);
  const tampered = JSON.parse(tamperedStorage.values.get(receiptKey));
  tampered.keyId = 'unknown-receipt-key';
  tamperedStorage.values.set(receiptKey, JSON.stringify(tampered));
  await assert.rejects(
    verifiedOrReceiptedPaidReadingAuthorities(fixture.row, {
      ...runtime(key3, key2),
      READINGS_CACHE: tamperedStorage.cache,
    }, async () => fixture.verified),
    authorityError('PAID_READING_AUTHORITY_RECEIPT_INVALID'),
  );

  await assert.rejects(
    verifiedOrReceiptedPaidReadingAuthorities(retryAuthorityFixture('context').row, {
      READINGS_CACHE: atomicReceiptCache().cache,
      INTERNAL_ORDER_REPLAY_SECRET: replaySecret,
      SHOPIFY_WEBHOOK_SECRET: replaySecret,
      PAID_READING_AUTHORITY_RECEIPT_KEY_ID: 'partial-key',
      PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
    }, async () => retryAuthorityFixture('context').verified),
    authorityError('PAID_READING_AUTHORITY_RECEIPT_SECRET_MISSING'),
  );
  const partialPreviousFixture = retryAuthorityFixture('intent');
  await assert.rejects(
    verifiedOrReceiptedPaidReadingAuthorities(partialPreviousFixture.row, {
      READINGS_CACHE: atomicReceiptCache().cache,
      INTERNAL_ORDER_REPLAY_SECRET: replaySecret,
      SHOPIFY_WEBHOOK_SECRET: replaySecret,
      ...key3,
      PAID_READING_AUTHORITY_RECEIPT_PREVIOUS_KEY_ID: 'partial-previous-key',
      PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
    }, async () => partialPreviousFixture.verified),
    authorityError('PAID_READING_AUTHORITY_RECEIPT_KEYRING_INVALID'),
  );
});

test('paid generation limiter supersedes legacy completion and repairs only one canonical receipt owner', async () => {
  const values = new Map();
  const storage = {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    async setAlarm() {},
  };
  const limiter = new FreeEntitlementLimiter({ storage }, {});
  const invoke = async (body) => {
    const response = await limiter.fetch(new Request('https://free-entitlement.internal/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  };
  const legacyClaim = 'legacy-complete-claim-0001';
  assert.equal((await invoke({ action: 'claim-paid-generation', claimId: legacyClaim })).body.allowed, true);
  assert.equal((await invoke({ action: 'commit-paid-generation', claimId: legacyClaim })).body.allowed, true);

  const authorityDigest = 'a'.repeat(64);
  const successorClaim = 'successor-repair-claim-001';
  const successor = await invoke({
    action: 'claim-paid-generation',
    claimId: successorClaim,
    authorityDigest,
    repair: true,
  });
  assert.equal(successor.body.allowed, true, 'receipt authority must supersede a legacy completed marker');
  assert.equal((await invoke({ action: 'commit-paid-generation', claimId: successorClaim })).body.allowed, true);
  assert.equal(values.get('paidGenerationAuthorityDigest'), authorityDigest);

  const cachedRetry = await invoke({
    action: 'claim-paid-generation',
    claimId: 'successor-idempotent-0002',
    authorityDigest,
    repair: false,
  });
  assert.equal(cachedRetry.body.allowed, false);
  assert.equal(cachedRetry.body.reason, 'generation_complete');

  const repairClaim = 'successor-cache-repair-003';
  assert.equal((await invoke({
    action: 'claim-paid-generation',
    claimId: repairClaim,
    authorityDigest,
    repair: true,
  })).body.allowed, true);
  const competing = await invoke({
    action: 'claim-paid-generation',
    claimId: 'successor-competing-0004',
    authorityDigest,
    repair: true,
  });
  assert.equal(competing.body.allowed, false);
  assert.equal(competing.body.reason, 'generation_in_progress');

  const workerEnvSource = await readFile(new URL('lib/worker-env.ts', root), 'utf8');
  const adapterSlice = workerEnvSource.slice(
    workerEnvSource.indexOf("if (['claim-paid-generation'"),
    workerEnvSource.indexOf("} else if (['claim-usage'"),
  );
  assert.match(adapterSlice, /paidGenerationAuthorityDigest/);
  assert.match(adapterSlice, /paidGenerationClaimDigest/);
  assert.match(adapterSlice, /body\.repair === true/);
});

test('legacy generation accepts a primary signed intent with supplemental numerology on the same line', async () => {
  const { verifiedOrReceiptedPaidReadingAuthorities } = await loadQueueProcessor();
  const fixture = retryAuthorityFixture('intent');
  const line = {
    ...fixture.line,
    properties: [
      ...fixture.line.properties,
      lineProperty('Reading Type', 'Numerology Life Path'),
      lineProperty('_Numerology Product', 'life_path'),
    ],
  };
  const payload = { ...fixture.payload, line_items: [line] };
  const row = {
    ...fixture.row,
    payload,
    payload_sha256: createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex'),
  };
  const verified = {
    ...fixture.verified,
    items: [line],
    numerology: {
      kind: 'life_path',
      variantId: String(line.variant_id),
      sku: String(line.sku),
      verifiedFields: {
        numerologyEvidence: 'receipt-owned-life-path-evidence',
      },
    },
  };
  const storage = atomicReceiptCache();
  const secret = 'numerology-intent-receipt-secret';
  const env = {
    READINGS_CACHE: storage.cache,
    INTERNAL_ORDER_REPLAY_SECRET: secret,
    SHOPIFY_WEBHOOK_SECRET: secret,
    ...paidReceiptKeyEnv(secret),
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
  };

  await verifiedOrReceiptedPaidReadingAuthorities(row, env, async () => verified);
  const draft = JSON.parse(storage.values.get(`paid-draft:${fixture.orderId}`));
  const trustedDraft = await verifiedPaidReadingDraftAuthority(payload, draft, env);
  const hydrated = await hydratePaidReadingItemFields({}, trustedDraft, 0, env);
  assert.equal(hydrated.receiptAuthority, 'intent');
  assert.equal(hydrated.numerologyEvidence, 'receipt-owned-life-path-evidence');
  assert.equal(hydrated.cards, fixture.verified.intent.verifiedFields.cards);
});

test('paid authority receipts reject cross-order, line, type, and verified-field tampering without mutable fallback', async () => {
  const { verifiedOrReceiptedPaidReadingAuthorities } = await loadQueueProcessor();
  const fixture = retryAuthorityFixture('preview');
  const storage = atomicReceiptCache();
  const env = {
    READINGS_CACHE: storage.cache,
    INTERNAL_ORDER_REPLAY_SECRET: 'receipt-negative-secret',
    SHOPIFY_WEBHOOK_SECRET: 'receipt-negative-secret',
    ...paidReceiptKeyEnv('receipt-negative-secret'),
    PAID_READING_AUTHORITY_CUTOFF: '2026-08-17T08:00:00.000Z',
  };
  await verifiedOrReceiptedPaidReadingAuthorities(fixture.row, env, async () => fixture.verified);
  const receiptKey = receiptKeyForOrder(fixture.orderId);
  const originalReceipt = storage.values.get(receiptKey);
  const rejectWithoutFallback = async (row) => {
    let fallbackCalls = 0;
    await assert.rejects(
      verifiedOrReceiptedPaidReadingAuthorities(row, env, async () => {
        fallbackCalls += 1;
        throw new Error('mutable fallback must not run');
      }),
      authorityError('PAID_READING_AUTHORITY_RECEIPT_INVALID'),
    );
    assert.equal(fallbackCalls, 0);
  };

  const otherOrderId = 'durable-preview-other-order';
  const otherPayload = { ...fixture.payload, id: otherOrderId };
  const otherRow = {
    ...fixture.row,
    order_id: otherOrderId,
    payload: otherPayload,
    payload_sha256: createHash('sha256').update(JSON.stringify(otherPayload), 'utf8').digest('hex'),
  };
  storage.values.set(receiptKeyForOrder(otherOrderId), originalReceipt);
  await rejectWithoutFallback(otherRow);

  const tamperedFields = JSON.parse(originalReceipt);
  tamperedFields.authorities.preview.verifiedFields.question = 'A forged different paid question';
  storage.values.set(receiptKey, JSON.stringify(tamperedFields));
  await rejectWithoutFallback(fixture.row);

  const tamperedType = JSON.parse(originalReceipt);
  tamperedType.authorityKind = 'intent';
  storage.values.set(receiptKey, JSON.stringify(tamperedType));
  await rejectWithoutFallback(fixture.row);

  storage.values.set(receiptKey, originalReceipt);
  const changedLine = {
    ...fixture.line,
    properties: [...fixture.line.properties, lineProperty('_Market', 'de')],
  };
  const changedPayload = { ...fixture.payload, line_items: [changedLine] };
  await rejectWithoutFallback({ ...fixture.row, payload: changedPayload });
});

test('paid queue guard quarantines unsigned legacy orders before every automated fulfillment effect', async () => {
  const queue = await readFile(new URL('lib/reading-queue-processor.ts', root), 'utf8');
  const processStart = queue.indexOf('async function processWebhookClaim');
  const paidProcessor = queue.indexOf('export async function processUndeliveredPaidOrder');
  const receiptGate = queue.indexOf('await verifiedOrReceiptedPaidReadingAuthorities(', paidProcessor);
  const replay = queue.indexOf('dependencies.replay || replayShopifyWebhook', receiptGate);
  const enqueue = queue.indexOf('dependencies.enqueue', replay);
  const processDispatch = queue.indexOf('await processUndeliveredPaidOrder(row, env)', processStart);
  const verifierStart = queue.indexOf('export async function verifyPaidReadingAuthorities');
  const manualReviewThrow = queue.indexOf("throw new QueueOperationError('PAID_READING_LEGACY_MANUAL_REVIEW_REQUIRED')", verifierStart);
  const receiptStart = queue.indexOf('async function persistPaidReadingAuthorityReceipt');
  const receiptCas = queue.indexOf('compareAndSetMany([', receiptStart);
  const receiptEntry = queue.indexOf('key: receiptKey', receiptCas);
  const draftEntry = queue.indexOf('key: draftKey', receiptEntry);
  const accessEntry = queue.indexOf('key: accessKey', draftEntry);
  const enqueueStart = queue.indexOf('async function enqueueReadingFromWebhook');
  const enqueueAuthority = queue.indexOf('verifiedAuthorities || await verifyPaidReadingAuthorities(payload, env)', enqueueStart);
  const draft = queue.indexOf('await queueDraftForOrder(', enqueueAuthority);
  const paidOrder = queue.indexOf('operations.persistPaidOrder || persistPaidOrder', draft);
  const lifecycleEmail = queue.indexOf('operations.enqueuePostPurchase', paidOrder);
  const job = queue.indexOf('operations.enqueueDelivery', lifecycleEmail);

  assert.ok(processStart >= 0 && paidProcessor >= 0 && verifierStart >= 0 && manualReviewThrow > verifierStart
    && receiptGate > paidProcessor && replay > receiptGate && enqueue > replay && processDispatch > processStart,
  'durable authority must publish before legacy replay can draft, email, or fulfill');
  assert.ok(receiptStart >= 0 && receiptCas > receiptStart && receiptEntry > receiptCas
    && draftEntry > receiptEntry && accessEntry > draftEntry,
  'receipt, authority-only draft, and access mapping must share one atomic CAS');
  assert.ok(enqueueStart >= 0 && enqueueAuthority > enqueueStart && draft > enqueueAuthority
    && paidOrder > draft && lifecycleEmail > paidOrder && job > lifecycleEmail,
  'authority must fail before draft, paid_order, lifecycle email, and delivery-job persistence');
  assert.doesNotMatch(queue.slice(queue.indexOf('async function verifiedReadingIntent'), queue.indexOf('function checkoutContextCanonical')),
    /const relevant =|CHECKOUT_INTENT_REQUIRED/);
  assert.doesNotMatch(queue.slice(queue.indexOf('async function verifiedTarotCheckoutContext'), queue.indexOf('function parsedStoredObject')),
    /contextRequired|clarifier-checkout-2026-08-v40/);
  assert.match(queue, /if \(items\.length !== 1\) throw new QueueOperationError\('PAID_READING_LINE_COUNT_INVALID'\)/);
  assert.match(queue, /throw new QueueOperationError\('PAID_READING_LEGACY_MANUAL_REVIEW_REQUIRED'\)/);
  assert.match(queue, /PAID_READING_AUTHORITY_CUTOFF/);
  assert.match(queue, /throw new QueueOperationError\('PAID_READING_AUTHORITY_REQUIRED'\)/);
});
