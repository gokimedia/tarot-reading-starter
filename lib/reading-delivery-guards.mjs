const SHOPIFY_FULFILLMENT_ID = /^gid:\/\/shopify\/Fulfillment\/\d+$/;

function boundedText(value, maximum = 192) {
  return String(value ?? '').trim().slice(0, maximum);
}

function validTimestamp(value) {
  return Number.isFinite(Date.parse(String(value ?? '')));
}

/**
 * A completed database delivery can close a duplicate paid-order replay only
 * when the queued webhook, Shopify payload, paid order and paid-reading job all
 * name the same order and SKU. This guard deliberately does not make an
 * undelivered order trusted merely because it is paid or has an allow-listed
 * SKU; those orders must still cross the normal signed checkout verification.
 */
export function hasAuthoritativeDeliveredOrderEvidence(input = {}) {
  const queuedOrderId = boundedText(input.queuedOrderId, 96);
  const payloadOrderId = boundedText(input.payloadOrderId, 96);
  const paidOrder = input.paidOrder && typeof input.paidOrder === 'object' ? input.paidOrder : {};
  const deliveryJob = input.deliveryJob && typeof input.deliveryJob === 'object' ? input.deliveryJob : {};
  const readingSkus = Array.from(new Set((Array.isArray(input.readingSkus) ? input.readingSkus : [])
    .map((value) => boundedText(value, 80).toUpperCase())
    .filter((value) => /^READING-[A-Z0-9_-]+$/.test(value))));
  const paidSku = boundedText(paidOrder.sku, 80).toUpperCase();

  return Boolean(
    queuedOrderId
    && payloadOrderId
    && queuedOrderId === payloadOrderId
    && boundedText(paidOrder.order_id, 96) === payloadOrderId
    && boundedText(paidOrder.financial_status, 40).toLowerCase() === 'paid'
    && boundedText(paidOrder.status, 40).toLowerCase() === 'delivered'
    && validTimestamp(paidOrder.delivered_at)
    && SHOPIFY_FULFILLMENT_ID.test(boundedText(paidOrder.fulfillment_id, 160))
    && paidSku
    && readingSkus.length === 1
    && readingSkus[0] === paidSku
    && boundedText(deliveryJob.order_id, 96) === payloadOrderId
    && boundedText(deliveryJob.job_type, 40) === 'paid_reading'
    && boundedText(deliveryJob.status, 40) === 'completed'
    && validTimestamp(deliveryJob.completed_at)
    && boundedText(deliveryJob.idempotency_key, 192) === `paid-reading:${payloadOrderId}`
  );
}

export function readingIntentPropertiesMatch(input = {}) {
  const actual = input.actual && typeof input.actual === 'object' ? input.actual : {};
  const expected = input.expected && typeof input.expected === 'object' ? input.expected : {};
  const universalKeys = ['funnelVersion', 'readingId', 'readingType', 'question', 'tier'];
  if (universalKeys.some((key) => {
    const actualValue = String(actual[key] ?? '');
    if (key === 'question' && input.allowMissingQuestion === true && actualValue === '') return false;
    return actualValue !== String(expected[key] ?? '');
  })) {
    return false;
  }

  // Dedicated signed intents authenticate their structured snapshot separately.
  // Their Shopify display properties may omit the legacy card fields, but a
  // non-empty contradictory value is still evidence of tampering and must fail.
  return ['category', 'answer', 'cardName'].every((key) => {
    const actualValue = String(actual[key] ?? '');
    const expectedValue = String(expected[key] ?? '');
    return actualValue === expectedValue || (input.knownIntentKind === true && actualValue === '');
  });
}

export function hasConfirmedReadingFulfillment(result) {
  if (!result || typeof result !== 'object') return false;
  const fulfillmentId = String(result.fulfillmentId || '').trim();
  if (!SHOPIFY_FULFILLMENT_ID.test(fulfillmentId)) return false;
  if (result.deliveryVerified !== true) return false;
  if (result.fulfilled === true) return result.notified === true;
  return result.skipped === 'no open fulfillment orders'
    || result.skipped === 'reading line items already fulfilled';
}
