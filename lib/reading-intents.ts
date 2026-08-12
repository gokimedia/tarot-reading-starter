import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type CheckoutIntentCanonical = {
  id: string;
  expiresAt: string;
  page: string;
  funnelVersion: string;
  readingId: string;
  readingType: string;
  category: string;
  deck: string;
  question: string;
  answer: string;
  cardName: string;
  cardId: number;
  tier: string;
  variantId: string;
  sku: string;
  price: string | number;
  intentKind?: string | null;
  snapshotHash?: string | null;
};

function clean(value: unknown, maximum = 400) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

export function checkoutIntentCanonical(record: CheckoutIntentCanonical) {
  const fields = [
    clean(record.id, 64),
    clean(record.expiresAt, 64),
    clean(record.page, 160),
    clean(record.funnelVersion, 128),
    clean(record.readingId, 80),
    clean(record.readingType, 80),
    clean(record.category, 20),
    clean(record.deck, 32),
    clean(record.question, 400),
    clean(record.answer, 20),
    clean(record.cardName, 80),
    String(Number(record.cardId)),
    clean(record.tier, 20),
    clean(record.variantId, 64),
    clean(record.sku, 80),
    Number(record.price).toFixed(2),
  ];
  if (record.intentKind || record.snapshotHash) {
    fields.push(clean(record.intentKind, 32), clean(record.snapshotHash, 64));
  }
  return fields.join('\u001f');
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableJsonValue(entry)]),
  );
}

export function hashCheckoutIntentSnapshot(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stableJsonValue(value)), 'utf8')
    .digest('hex');
}

export function signCheckoutIntent(record: CheckoutIntentCanonical, secret: string) {
  return createHmac('sha256', secret).update(checkoutIntentCanonical(record), 'utf8').digest('hex');
}

export function checkoutIntentSignatureMatches(expected: string, supplied: string) {
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(supplied, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
