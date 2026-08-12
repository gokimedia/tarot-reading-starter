import { createHash } from 'node:crypto';
import { shopifyAdminFetch, shopifyStoreDomain } from '@/lib/shopify-admin-auth.mjs';
import { deliveryRetry, workerEnvironment } from '@/lib/worker-env';
import { DAILY_TAROT_FUNNEL_VERSION } from '@/lib/daily-tarot';
import { DAILY_HOROSCOPE_FUNNEL_VERSION } from '@/lib/daily-horoscope';
import { BIRTH_CHART_FUNNEL_VERSION } from '@/lib/birth-chart';
import { BIG_THREE_FUNNEL_VERSION } from '@/lib/big-three';
import { ANGEL_NUMBER_FUNNEL_VERSION } from '@/lib/angel-number';
import { ZODIAC_COMPATIBILITY_FUNNEL_VERSION } from '@/lib/zodiac-compatibility';
import { MOON_LUNAR_FUNNEL_VERSION } from '@/lib/moon-lunar';
import { NUMEROLOGY_COMPATIBILITY_FUNNEL_VERSION } from '@/lib/numerology-compatibility';
import {
  assertReconciliationPageFetched,
  validatedOrdersConnection,
} from '@/lib/shopify-reconciliation-guards.mjs';
import {
  LOVE_TAROT_FUNNEL_VERSION,
  isSupportedYesNoFunnelVersion,
  productKeyForCategory,
  readingPackage,
  type ReadingTier,
  type YesNoCategory,
} from '@/lib/reading-products';

type JsonObject = Record<string, unknown>;
type ReconciliationResult = {
  scanned: number;
  readingOrders: number;
  enqueued: number;
  duplicates: number;
  pages: number;
  truncated: boolean;
  windowStartedAt: string;
};

const CURSOR_KEY = 'system:shopify-orders-paid-reconciliation-v2';
// Cover multi-day webhook or deployment incidents on a cold cursor. Subsequent
// runs still use the persisted cursor plus the small overlap below.
const INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const OVERLAP_MS = 10 * 60 * 1000;
const MAX_PAGES = 5;
const SIGNED_CHECKOUT_FUNNEL_VERSION = 'clarifier-checkout-2026-08-v40';
const SIGNED_TAROT_VARIANT_BY_SKU = Object.freeze<Record<string, string>>({
  'READING-DEEP': '53782500606225',
  'READING-MEDIUM': '53782500638993',
  'READING-PREMIUM': '53782500671761',
});
const READING_TIER_BY_SKU = Object.freeze<Record<string, ReadingTier>>({
  'READING-DEEP': 'standard',
  'READING-MEDIUM': 'medium',
  'READING-PREMIUM': 'premium',
});

function reconciliationError(code: string, status = 0) {
  const normalized = String(code || 'SHOPIFY_RECONCILIATION_FAILED')
    .replace(/[^A-Za-z0-9_.:-]/g, '_')
    .slice(0, 120);
  const error = new Error(normalized);
  (error as Error & { code?: string; upstreamStatus?: number }).code = normalized;
  if (status) (error as Error & { upstreamStatus?: number }).upstreamStatus = status;
  return error;
}

function text(value: unknown, maximum = 400) {
  return String(value ?? '').trim().slice(0, maximum);
}

function legacyId(value: unknown) {
  const match = String(value || '').match(/\/(\d+)$/);
  return match ? match[1] : '';
}

function attributeValue(attributes: JsonObject[], wanted: string) {
  for (const attribute of attributes) {
    const key = text(attribute.key, 100).toLowerCase().replace(/^_/, '');
    if (key === wanted && attribute.value != null) return text(attribute.value, 400);
  }
  return '';
}

function signedIntentVariantId(attributes: JsonObject[], funnelVersion: string, sku: string) {
  const intentId = attributeValue(attributes, 'checkout intent');
  const signature = attributeValue(attributes, 'checkout signature');
  const tier = READING_TIER_BY_SKU[sku];
  if (!tier
    || !/^[0-9a-f-]{36}$/i.test(intentId)
    || !/^[a-f0-9]{64}$/i.test(signature)) return '';
  if (funnelVersion === LOVE_TAROT_FUNNEL_VERSION) {
    return readingPackage('yes_no_love', tier)?.variantId || '';
  }
  if (funnelVersion === DAILY_TAROT_FUNNEL_VERSION) {
    return readingPackage('daily_tarot', tier)?.variantId || '';
  }
  if (funnelVersion === DAILY_HOROSCOPE_FUNNEL_VERSION) {
    return readingPackage('daily_horoscope', tier)?.variantId || '';
  }
  if (funnelVersion === BIRTH_CHART_FUNNEL_VERSION) {
    return readingPackage('birth_chart', tier)?.variantId || '';
  }
  if (funnelVersion === BIG_THREE_FUNNEL_VERSION) {
    return readingPackage('big_three', tier)?.variantId || '';
  }
  if (funnelVersion === ANGEL_NUMBER_FUNNEL_VERSION) {
    return readingPackage('angel_number', tier)?.variantId || '';
  }
  if (funnelVersion === ZODIAC_COMPATIBILITY_FUNNEL_VERSION) {
    return readingPackage('zodiac_compatibility', tier)?.variantId || '';
  }
  if (funnelVersion === MOON_LUNAR_FUNNEL_VERSION) {
    return readingPackage('moon_lunar', tier)?.variantId || '';
  }
  if (funnelVersion === NUMEROLOGY_COMPATIBILITY_FUNNEL_VERSION) {
    return readingPackage('numerology_compatibility', tier)?.variantId || '';
  }
  if (!isSupportedYesNoFunnelVersion(funnelVersion)) return '';
  const categoryValue = attributeValue(attributes, 'reading category').toLowerCase();
  const category: YesNoCategory = ['love', 'career', 'money', 'personal', 'general'].includes(categoryValue)
    ? categoryValue as YesNoCategory
    : 'general';
  return readingPackage(productKeyForCategory(category), tier)?.variantId || '';
}

function orderPayload(node: JsonObject) {
  const customer = node.customer && typeof node.customer === 'object' ? node.customer as JsonObject : {};
  const billingAddress = node.billingAddress && typeof node.billingAddress === 'object'
    ? node.billingAddress as JsonObject
    : {};
  const lines = node.lineItems && typeof node.lineItems === 'object'
    ? node.lineItems as { nodes?: JsonObject[] }
    : {};
  const lineItems = (lines.nodes || []).map((line) => {
    const moneySet = line.originalUnitPriceSet && typeof line.originalUnitPriceSet === 'object'
      ? line.originalUnitPriceSet as JsonObject
      : {};
    const shopMoney = moneySet.shopMoney && typeof moneySet.shopMoney === 'object'
      ? moneySet.shopMoney as JsonObject
      : {};
    const attributes = (Array.isArray(line.customAttributes) ? line.customAttributes : [])
      .filter((attribute): attribute is JsonObject => Boolean(attribute && typeof attribute === 'object'));
    const sku = text(line.sku, 80).toUpperCase();
    const signedCheckoutContext = attributeValue(attributes, 'checkout context');
    const signedCheckoutSignature = attributeValue(attributes, 'checkout signature');
    const funnelVersion = attributeValue(attributes, 'funnel version');
    // ProductVariant requires read_products. For the signed clarifier checkout,
    // the order-owned SKU selects a candidate and the downstream HMAC-bound
    // checkout context must independently prove the exact tier and variant.
    const reconciledVariantId = funnelVersion === SIGNED_CHECKOUT_FUNNEL_VERSION
      && /^[0-9a-f-]{36}$/i.test(signedCheckoutContext)
      && /^[a-f0-9]{64}$/i.test(signedCheckoutSignature)
      ? SIGNED_TAROT_VARIANT_BY_SKU[sku] || ''
      : signedIntentVariantId(attributes, funnelVersion, sku);
    return {
      id: legacyId(line.id),
      variant_id: reconciledVariantId,
      sku,
      quantity: Number(line.quantity || 0),
      price: text(shopMoney.amount, 32),
      properties: attributes.map((attribute) => ({
        name: text(attribute.key, 100),
        value: text(attribute.value, 400),
      })),
    };
  });
  const orderId = legacyId(node.id);
  return {
    id: orderId,
    name: text(node.name, 40),
    created_at: text(node.createdAt, 80),
    updated_at: text(node.updatedAt, 80),
    financial_status: 'paid',
    currency: text(node.currencyCode, 3),
    email: text(node.email, 320),
    contact_email: text(node.email, 320),
    buyer_accepts_marketing: Boolean(node.customerAcceptsMarketing),
    customer: {
      id: legacyId(customer.id),
      first_name: text(customer.firstName, 80),
      last_name: text(customer.lastName, 80),
      accepts_marketing: Boolean(node.customerAcceptsMarketing),
    },
    billing_address: {
      first_name: text(billingAddress.firstName, 80),
      last_name: text(billingAddress.lastName, 80),
    },
    line_items: lineItems,
  };
}

function hasReadingLine(payload: ReturnType<typeof orderPayload>) {
  return payload.line_items.some((line) => /^READING-/.test(text(line.sku, 80).toUpperCase()));
}

const ORDERS_QUERY = `query PaidOrders($first: Int!, $after: String, $query: String!) {
  orders(first: $first, after: $after, sortKey: UPDATED_AT, reverse: false, query: $query) {
    nodes {
      id
      name
      createdAt
      updatedAt
      email
      currencyCode
      customerAcceptsMarketing
      customer { id firstName lastName }
      billingAddress { firstName lastName }
      lineItems(first: 50) {
        nodes {
          id
          sku
          quantity
          customAttributes { key value }
          originalUnitPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export async function reconcileShopifyPaidOrders(options: { deadlineMs?: number } = {}): Promise<ReconciliationResult> {
  const env = workerEnvironment();
  const deadlineMs = options.deadlineMs || Date.now() + 45_000;
  const runStartedAt = Date.now();
  const state = await env.READINGS_CACHE.get(CURSOR_KEY, 'json') as {
    lastSuccessAt?: string;
    continuation?: { windowStartedAt?: string; windowEndedAt?: string; after?: string };
  } | null;
  const previous = Date.parse(String(state?.lastSuccessAt || ''));
  const continuationStart = Date.parse(String(state?.continuation?.windowStartedAt || ''));
  const continuationEnd = Date.parse(String(state?.continuation?.windowEndedAt || ''));
  const continuing = Number.isFinite(continuationStart)
    && Number.isFinite(continuationEnd)
    && continuationStart < continuationEnd
    && Boolean(state?.continuation?.after);
  const windowStartMs = continuing
    ? continuationStart
    : Number.isFinite(previous)
      ? Math.max(previous - OVERLAP_MS, runStartedAt - INITIAL_LOOKBACK_MS)
      : runStartedAt - INITIAL_LOOKBACK_MS;
  const windowEndMs = continuing ? continuationEnd : runStartedAt;
  const windowStartedAt = new Date(windowStartMs).toISOString();
  const windowEndedAt = new Date(windowEndMs).toISOString();
  const store = shopifyStoreDomain(env);
  const apiVersion = text(process.env.SHOPIFY_API_VERSION || '2026-07', 20);
  const endpoint = `https://${store}/admin/api/${apiVersion}/graphql.json`;
  const query = `financial_status:paid updated_at:>=${windowStartedAt} updated_at:<=${windowEndedAt}`;
  let after: string | null = continuing ? text(state?.continuation?.after, 512) : null;
  let scanned = 0;
  let readingOrders = 0;
  let enqueued = 0;
  let duplicates = 0;
  let pages = 0;
  let hasNextPage = false;

  do {
    if (Date.now() >= deadlineMs - 8_000) break;
    const response = await shopifyAdminFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ORDERS_QUERY, variables: { first: 100, after, query } }),
    }, env);
    const body = await response.json().catch(() => null) as JsonObject | null;
    if (!response.ok || !body) {
      throw reconciliationError(`SHOPIFY_RECONCILIATION_HTTP_${response.status}`, response.status);
    }
    if (Array.isArray(body.errors) && body.errors.length) {
      const first = body.errors[0] && typeof body.errors[0] === 'object'
        ? body.errors[0] as JsonObject
        : {};
      const extensions = first.extensions && typeof first.extensions === 'object'
        ? first.extensions as JsonObject
        : {};
      const graphqlCode = text(extensions.code, 48).toUpperCase().replace(/[^A-Z0-9_]/g, '_')
        || 'GRAPHQL_ERROR';
      const graphqlPath = Array.isArray(first.path)
        ? first.path.map((part) => text(part, 48).replace(/[^A-Za-z0-9_]/g, '_')).filter(Boolean).join('_')
        : '';
      throw reconciliationError(`SHOPIFY_RECONCILIATION_GQL_${graphqlCode}${graphqlPath ? `_${graphqlPath}` : ''}`);
    }
    const connection = validatedOrdersConnection(body);
    pages += 1;
    for (const node of connection.nodes) {
      scanned += 1;
      const payload = orderPayload(node);
      if (!payload.id || !hasReadingLine(payload)) continue;
      readingOrders += 1;
      const raw = JSON.stringify(payload);
      const payloadSha256 = createHash('sha256').update(raw, 'utf8').digest('hex');
      const replayKey = payloadSha256.slice(0, 20);
      const result = await deliveryRetry.enqueueShopifyWebhook({
        webhookId: `reconcile-orders-paid-${payload.id}-${replayKey}`,
        eventId: `reconcile-${payload.id}-${replayKey}`,
        topic: 'orders/paid',
        orderId: payload.id,
        payloadSha256,
        payload,
      });
      if (result.accepted === false) duplicates += 1;
      else enqueued += 1;
    }
    hasNextPage = connection.pageInfo.hasNextPage;
    after = connection.pageInfo.endCursor;
  } while (hasNextPage && after && pages < MAX_PAGES && Date.now() < deadlineMs - 8_000);

  // Never mark a reconciliation window complete when the deadline expired
  // before Shopify returned even one validated page.
  assertReconciliationPageFetched(pages);
  const truncated = Boolean(hasNextPage);
  if (truncated && after) {
    await env.READINGS_CACHE.put(CURSOR_KEY, JSON.stringify({
      lastSuccessAt: state?.lastSuccessAt || null,
      continuation: { windowStartedAt, windowEndedAt, after },
    }), { expirationTtl: 60 * 60 * 24 * 30 });
  } else {
    await env.READINGS_CACHE.put(CURSOR_KEY, JSON.stringify({
      lastSuccessAt: windowEndedAt,
      windowStartedAt,
    }), { expirationTtl: 60 * 60 * 24 * 30 });
  }
  return { scanned, readingOrders, enqueued, duplicates, pages, truncated, windowStartedAt };
}
