export const FREE_TAROT_FUNNEL_VERSION = 'premium-choice-2026-08-v57';
export const FREE_TAROT_FUNNEL_VERSIONS = Object.freeze([
  'premium-choice-2026-08-v50',
  'premium-choice-2026-08-v51',
  'premium-choice-2026-08-v52',
  'premium-choice-2026-08-v53',
  'premium-choice-2026-08-v54',
  'premium-choice-2026-08-v55',
  'premium-choice-2026-08-v56',
  FREE_TAROT_FUNNEL_VERSION,
]);
export const FREE_TAROT_PAGE = '/pages/free-tarot-reading';

export const FREE_TAROT_PACKAGES = Object.freeze({
  standard: Object.freeze({
    tier: 'standard',
    variantId: '53782500606225',
    sku: 'READING-DEEP',
  }),
  medium: Object.freeze({
    tier: 'medium',
    variantId: '53782500638993',
    sku: 'READING-MEDIUM',
  }),
  premium: Object.freeze({
    tier: 'premium',
    variantId: '53782500671761',
    sku: 'READING-PREMIUM',
  }),
});

const PACKAGES = Object.freeze(Object.values(FREE_TAROT_PACKAGES));
const PACKAGE_BY_SKU = new Map(PACKAGES.map((entry) => [entry.sku, entry]));
const PACKAGE_BY_VARIANT = new Map(PACKAGES.map((entry) => [entry.variantId, entry]));
const SUPPORTED_FUNNEL_VERSIONS = new Set(FREE_TAROT_FUNNEL_VERSIONS);

function normalizedSku(value) {
  return String(value || '').trim().toUpperCase().slice(0, 80);
}

function normalizedVariantId(value) {
  return String(value || '').trim().slice(0, 64);
}

/**
 * Shopify's reconciliation token cannot currently read ProductVariant. The
 * Admin order line SKU is still order-owned, so an explicitly allow-listed
 * funnel version + page + SKU tuple can safely recover the immutable variant
 * selected at checkout. v50, v51 and v52 remain supported for missed-webhook
 * recovery while v57 is the current release; unknown future versions fail
 * closed.
 */
export function freeTarotReconciledVariantId(input = {}) {
  const funnelVersion = String(input.funnelVersion || '').trim();
  const page = String(input.page || '').trim();
  if (!SUPPORTED_FUNNEL_VERSIONS.has(funnelVersion) || page !== FREE_TAROT_PAGE) return '';
  return PACKAGE_BY_SKU.get(normalizedSku(input.sku))?.variantId || '';
}

/**
 * Returns null for variants owned by another funnel. Known Free Tarot variants
 * are fail-closed when their Shopify SKU does not match the canonical tier.
 */
export function freeTarotPaidPackageAuthority(input = {}) {
  const variantId = normalizedVariantId(input.variantId ?? input.variant_id);
  const sku = normalizedSku(input.sku);
  const product = PACKAGE_BY_VARIANT.get(variantId);
  if (!product) return null;
  if (product.sku !== sku) {
    return Object.freeze({ ok: false, reason: 'SHOPIFY_PACKAGE_VARIANT_SKU_MISMATCH' });
  }
  return Object.freeze({
    ok: true,
    variantId: product.variantId,
    sku: product.sku,
    tier: product.tier,
  });
}

export function shopifyFinancialStatusAllowsReadingFulfillment(value) {
  // `authorized` is only a card authorization and `partially_paid` is not a
  // captured full payment. Shopify's orders/paid topic and reconciliation query
  // both converge on `paid`, which is the only status allowed to generate work.
  return String(value || '').trim().toLowerCase() === 'paid';
}

/**
 * @param {unknown} orderId
 * @param {Date} dueAt
 * @returns {{ orderId: string, jobType: 'paid_reading', dueAt: Date, idempotencyKey: string, maxRetries: number }}
 */
export function paidReadingDeliveryJobInput(orderId, dueAt) {
  const normalizedOrderId = String(orderId || '').trim().slice(0, 96);
  if (!normalizedOrderId) throw new Error('SHOPIFY_ORDER_ID_REQUIRED');
  if (!(dueAt instanceof Date) || !Number.isFinite(dueAt.getTime())) {
    throw new Error('DELIVERY_DUE_AT_INVALID');
  }
  return {
    orderId: normalizedOrderId,
    jobType: 'paid_reading',
    dueAt,
    idempotencyKey: `paid-reading:${normalizedOrderId}`,
    maxRetries: 3,
  };
}
