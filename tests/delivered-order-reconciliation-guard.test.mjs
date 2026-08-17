import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { hasAuthoritativeDeliveredOrderEvidence } from '../lib/reading-delivery-guards.mjs';

const root = new URL('../', import.meta.url);

function deliveredEvidence(overrides = {}) {
  const orderId = 'authoritative-order-123';
  const input = {
    queuedOrderId: orderId,
    payloadOrderId: orderId,
    readingSkus: ['READING-PREMIUM'],
    paidOrder: {
      order_id: orderId,
      financial_status: 'paid',
      status: 'delivered',
      delivered_at: '2026-08-17T00:14:00.000Z',
      fulfillment_id: 'gid://shopify/Fulfillment/987654321',
      sku: 'READING-PREMIUM',
    },
    deliveryJob: {
      order_id: orderId,
      job_type: 'paid_reading',
      status: 'completed',
      completed_at: '2026-08-17T00:14:01.000Z',
      idempotency_key: `paid-reading:${orderId}`,
    },
  };
  return {
    ...input,
    ...overrides,
    paidOrder: { ...input.paidOrder, ...(overrides.paidOrder || {}) },
    deliveryJob: { ...input.deliveryJob, ...(overrides.deliveryJob || {}) },
  };
}

test('an exact paid order with completed fulfillment and delivery job is authoritative', () => {
  assert.equal(hasAuthoritativeDeliveredOrderEvidence(deliveredEvidence()), true);
});

test('paid but undelivered unsigned orders cannot bypass normal signed validation', () => {
  for (const entry of [
    { paidOrder: { status: 'queued', delivered_at: null, fulfillment_id: null } },
    { paidOrder: { financial_status: 'authorized' } },
    { paidOrder: { status: 'delivered', fulfillment_id: '' } },
    { deliveryJob: { status: 'failed', completed_at: null } },
    { deliveryJob: { status: 'completed', completed_at: null } },
  ]) {
    assert.equal(hasAuthoritativeDeliveredOrderEvidence(deliveredEvidence(entry)), false);
  }
});

test('a mismatched queue, paid order, job, SKU, or idempotency key cannot borrow delivery authority', () => {
  for (const entry of [
    { queuedOrderId: 'different-queue-order' },
    { payloadOrderId: 'different-payload-order' },
    { paidOrder: { order_id: 'different-paid-order' } },
    { deliveryJob: { order_id: 'different-job-order' } },
    { readingSkus: ['READING-DEEP'] },
    { readingSkus: ['READING-PREMIUM', 'READING-DEEP'] },
    { deliveryJob: { idempotency_key: 'paid-reading:different-order' } },
  ]) {
    assert.equal(hasAuthoritativeDeliveredOrderEvidence(deliveredEvidence(entry)), false);
  }
});

test('queue closes an authoritative duplicate before legacy replay and preserves all ordinary rejection gates', async () => {
  const source = await readFile(new URL('lib/reading-queue-processor.ts', root), 'utf8');
  const claimStart = source.indexOf('async function processWebhookClaim');
  const paymentGate = source.indexOf("throw new QueueOperationError('SHOPIFY_PAYMENT_NOT_CAPTURED')", claimStart);
  const deliveredGate = source.indexOf('await hasPreviouslyDeliveredOrderAuthority(row)', claimStart);
  const skipStart = source.indexOf('if (alreadyDelivered) {', deliveredGate);
  const ordinaryPath = source.indexOf('} else {', skipStart);
  const replay = source.indexOf('const replay = await replayShopifyWebhook(row, env)', ordinaryPath);
  const enqueue = source.indexOf('await enqueueReadingFromWebhook(row, env)', replay);
  const completion = source.indexOf('await deliveryRetry.completeShopifyWebhook', enqueue);

  assert.ok(claimStart >= 0 && paymentGate > claimStart, 'captured payment remains the first authority gate');
  assert.ok(deliveredGate > paymentGate && skipStart > deliveredGate, 'delivered evidence is checked only after payment');
  assert.ok(ordinaryPath > skipStart && replay > ordinaryPath && enqueue > replay,
    'undelivered orders continue through legacy and signed-intent validation');
  assert.ok(completion > enqueue, 'both branches converge only on idempotent webhook completion');

  const deliveredBranch = source.slice(skipStart, ordinaryPath);
  assert.doesNotMatch(deliveredBranch, /replayShopifyWebhook|validateMembershipActivation|enqueueReadingFromWebhook|enqueueDelivery|enqueuePostPurchase|deliverDueReadings/);
  assert.match(source, /const intent = await verifiedReadingIntent\(items, payload\)/);
  assert.match(source, /throw new QueueOperationError\('SHOPIFY_PACKAGE_VARIANT_INVALID'\)/);
  assert.match(source, /throw new QueueOperationError\('SHOPIFY_ORDER_ID_MISMATCH'\)/);
});

test('database evidence is exact-order, completed-job, and fulfillment bound', async () => {
  const source = await readFile(new URL('lib/reading-queue-processor.ts', root), 'utf8');
  const guardStart = source.indexOf('async function hasPreviouslyDeliveredOrderAuthority');
  const guardEnd = source.indexOf('\nasync function queueDraftForOrder', guardStart);
  const guard = source.slice(guardStart, guardEnd);

  assert.match(guard, /queuedOrderId !== payloadOrderId/);
  assert.match(guard, /where candidate\.order_id = paid\.order_id/);
  assert.match(guard, /candidate\.job_type = 'paid_reading'/);
  assert.match(guard, /where paid\.order_id = \$\{payloadOrderId\}/);
  assert.match(guard, /candidate\.status = 'completed'/);
  assert.match(guard, /hasAuthoritativeDeliveredOrderEvidence/);
});
