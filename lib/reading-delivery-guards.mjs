const SHOPIFY_FULFILLMENT_ID = /^gid:\/\/shopify\/Fulfillment\/\d+$/;

export function readingIntentPropertiesMatch(input = {}) {
  const actual = input.actual && typeof input.actual === 'object' ? input.actual : {};
  const expected = input.expected && typeof input.expected === 'object' ? input.expected : {};
  const universalKeys = ['funnelVersion', 'readingId', 'readingType', 'question', 'tier'];
  if (universalKeys.some((key) => String(actual[key] ?? '') !== String(expected[key] ?? ''))) {
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
