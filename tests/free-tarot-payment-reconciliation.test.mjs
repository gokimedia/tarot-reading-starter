import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import readingsWorker from '../lib/legacy-worker.mjs';

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

for (const product of Object.values(FREE_TAROT_PACKAGES)) {
  test(`${product.tier} Free Tarot orders recover from v50-v57 reconciliation through the delivery-job boundary`, () => {
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

test('v57 is current while v50-v56 remain explicit backward-recovery aliases', () => {
  assert.equal(FREE_TAROT_FUNNEL_VERSION, 'premium-choice-2026-08-v57');
  assert.deepEqual(FREE_TAROT_FUNNEL_VERSIONS, [
    'premium-choice-2026-08-v50',
    'premium-choice-2026-08-v51',
    'premium-choice-2026-08-v52',
    'premium-choice-2026-08-v53',
    'premium-choice-2026-08-v54',
    'premium-choice-2026-08-v55',
    'premium-choice-2026-08-v56',
    'premium-choice-2026-08-v57',
  ]);
});

test('reconciliation fails closed for an unknown release, wrong page, or unknown SKU', () => {
  const valid = {
    funnelVersion: FREE_TAROT_FUNNEL_VERSION,
    page: FREE_TAROT_PAGE,
    sku: 'READING-DEEP',
  };
  assert.equal(freeTarotReconciledVariantId({ ...valid, funnelVersion: 'premium-choice-2026-08-v58' }), '');
  assert.equal(freeTarotReconciledVariantId({ ...valid, page: '/pages/personal-tarot-reading' }), '');
  assert.equal(freeTarotReconciledVariantId({ ...valid, sku: 'READING-UNKNOWN' }), '');
});

test('v57 paid-new-spread missed-webhook recovery keeps the canonical Free Tarot page and package authority', () => {
  const variantId = freeTarotReconciledVariantId({
    funnelVersion: 'premium-choice-2026-08-v57',
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

test('/funnel-version preserves legacy compatibility fields and exposes authoritative v57 payment support', async () => {
  const response = await readingsWorker.fetch(new Request('https://reading.deckaura.com/funnel-version', {
    headers: { Origin: 'https://deckaura.com' },
  }), {});
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.funnelVersion, 'clarifier-checkout-2026-08-v40');
  assert.equal(payload.themeVersion, 45);
  assert.equal(payload.experienceVersion, 'free-tarot-enterprise-2026-08-v45');
  assert.equal(payload.paymentFunnelVersion, 'premium-choice-2026-08-v57');
  assert.deepEqual(payload.acceptedPaymentFunnels, FREE_TAROT_FUNNEL_VERSIONS);
  assert.equal(payload.nextPaymentFunnelRejected, 'premium-choice-2026-08-v58');
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
  assert.match(queue, /deliveryRetry\.enqueueDelivery\(paidReadingDeliveryJobInput\(orderId, dueAt\)\)/);
  const claimStart = queue.indexOf('async function processWebhookClaim');
  const paymentGate = queue.indexOf("throw new QueueOperationError('SHOPIFY_PAYMENT_NOT_CAPTURED')", claimStart);
  const legacyReplay = queue.indexOf('const replay = await replayShopifyWebhook', claimStart);
  assert.ok(claimStart >= 0 && paymentGate > claimStart && legacyReplay > paymentGate,
    'payment finality must be checked before legacy replay can mutate paid state');
  assert.match(worker, /shopifyFinancialStatusAllowsReadingFulfillment\(order\.financial_status\)/);
  assert.match(worker, /return new Response\("Payment not captured", \{ status: 409 \}\)/);
  assert.doesNotMatch(worker, /\["paid",\s*"partially_paid",\s*"authorized"\]\.includes\(order\.financial_status\)/);
});
