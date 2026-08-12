import { shopifyAdminFetch, shopifyStoreDomain } from './shopify-admin-auth.mjs';

export const SHOPIFY_STOREFRONT_READING_VARIANT_QUERY = `#graphql
  query CheckoutReadingVariant($id: ID!) @inContext(country: US) {
    node(id: $id) {
      ... on ProductVariant {
        id
        sku
        availableForSale
        requiresShipping
        price {
          amount
          currencyCode
        }
        product {
          onlineStoreUrl
        }
      }
    }
  }
`;

export const SHOPIFY_ADMIN_READING_VARIANT_QUERY = `#graphql
  query CheckoutReadingVariant($id: ID!) {
    productVariant(id: $id) {
      legacyResourceId
      sku
      price
      availableForSale
      inventoryItem {
        requiresShipping
      }
      product {
        status
      }
    }
  }
`;

export const SHOPIFY_READING_VARIANT_QUERY = SHOPIFY_STOREFRONT_READING_VARIANT_QUERY;

function safeSchemaToken(value, maximum = 64) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .slice(0, maximum);
}

function graphqlUpstreamCode(errors) {
  if (!Array.isArray(errors)) return '';
  const error = errors.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
  if (!error) return `errors:${Math.min(errors.length, 99)}`;
  const extensions = error.extensions && typeof error.extensions === 'object' && !Array.isArray(error.extensions)
    ? error.extensions
    : {};
  const parts = [];
  for (const key of ['code', 'typeName', 'fieldName']) {
    const value = safeSchemaToken(extensions[key]);
    if (value) parts.push(`${key}:${value}`);
  }
  const rawPath = Array.isArray(extensions.path) ? extensions.path : [];
  const path = rawPath.slice(0, 8).map((entry) => safeSchemaToken(entry, 48)).filter(Boolean).join('.');
  if (path) parts.push(`path:${path}`);
  return (parts.join('|') || `errors:${Math.min(errors.length, 99)}`).slice(0, 240);
}

function failure(kind, status, reason, upstreamStatus = 0, upstreamCode = '') {
  const result = { ok: false, kind, status, reason, upstreamStatus };
  return upstreamCode ? { ...result, upstreamCode } : result;
}

function validApiVersion(value) {
  return /^\d{4}-(?:01|04|07|10)$/.test(value);
}

function boundedToken(value) {
  const token = String(value || '').trim();
  return token && token.length <= 2_048 ? token : '';
}

function configuredStorefrontHost(env) {
  const host = String(env.SHOPIFY_STOREFRONT_HOST || env.SHOPIFY_PUBLIC_STORE_DOMAIN || 'deckaura.com')
    .trim()
    .toLowerCase();
  return /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host) && host.includes('.') ? host : '';
}

function onlineStorePublication(value, expectedHost) {
  if (value === null || value === undefined || String(value).trim() === '') return 'unpublished';
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return 'invalid';
    return url.hostname.toLowerCase() === expectedHost ? 'published' : 'host_mismatch';
  } catch {
    return 'invalid';
  }
}

async function verifyStorefrontVariant({
  store,
  apiVersion,
  token,
  normalizedId,
  normalizedSku,
  normalizedExpectedPrice,
  onlineStoreHost,
  storefrontFetch,
}) {
  let response;
  try {
    response = await storefrontFetch(`https://${store}/api/${apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { 'X-Shopify-Storefront-Access-Token': token } : {}),
      },
      body: JSON.stringify({
        query: SHOPIFY_STOREFRONT_READING_VARIANT_QUERY,
        variables: { id: `gid://shopify/ProductVariant/${normalizedId}` },
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return failure('upstream', 503, 'SHOPIFY_STOREFRONT_REQUEST_FAILED');
  }
  if (!response || typeof response.ok !== 'boolean') {
    return failure('upstream', 503, 'SHOPIFY_STOREFRONT_RESPONSE_INVALID');
  }
  if (!response.ok) {
    const upstreamStatus = Number.isInteger(response.status) ? response.status : 0;
    const kind = upstreamStatus === 401 || upstreamStatus === 403 ? 'misconfiguration' : 'upstream';
    return failure(kind, 503, 'SHOPIFY_STOREFRONT_HTTP_ERROR', upstreamStatus);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return failure('upstream', 503, 'SHOPIFY_STOREFRONT_RESPONSE_INVALID', response.status);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('upstream', 503, 'SHOPIFY_STOREFRONT_RESPONSE_INVALID', response.status);
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    return failure(
      'misconfiguration',
      503,
      'SHOPIFY_STOREFRONT_GRAPHQL_ERRORS',
      response.status,
      graphqlUpstreamCode(payload.errors),
    );
  }

  const variant = payload.data && payload.data.node;
  if (variant === null) return failure('unavailable', 409, 'SHOPIFY_VARIANT_UNAVAILABLE');
  if (!variant || typeof variant !== 'object' || Array.isArray(variant)
    || !variant.price || typeof variant.price !== 'object' || Array.isArray(variant.price)
    || !variant.product || typeof variant.product !== 'object' || Array.isArray(variant.product)
    || typeof variant.availableForSale !== 'boolean'
    || typeof variant.requiresShipping !== 'boolean') {
    return failure('upstream', 503, 'SHOPIFY_STOREFRONT_RESPONSE_INVALID', response.status);
  }

  const expectedGid = `gid://shopify/ProductVariant/${normalizedId}`;
  const gid = String(variant.id || '').trim();
  const sku = String(variant.sku || '').trim();
  const price = Number.parseFloat(String(variant.price.amount ?? ''));
  const currency = String(variant.price.currencyCode || '').trim().toUpperCase();
  if (gid !== expectedGid) return failure('contract', 422, 'SHOPIFY_VARIANT_ID_MISMATCH');
  if (sku !== normalizedSku) return failure('contract', 422, 'SHOPIFY_VARIANT_SKU_MISMATCH');
  if (!Number.isFinite(price) || price <= 0) return failure('contract', 422, 'SHOPIFY_VARIANT_PRICE_INVALID');
  if (currency !== 'USD') return failure('contract', 422, 'SHOPIFY_VARIANT_CURRENCY_MISMATCH');
  if (Math.abs(price - normalizedExpectedPrice) > 0.001) {
    return failure('contract', 422, 'SHOPIFY_VARIANT_PRICE_MISMATCH');
  }
  if (variant.requiresShipping !== false) return failure('contract', 422, 'SHOPIFY_VARIANT_REQUIRES_SHIPPING');
  const publication = onlineStorePublication(variant.product.onlineStoreUrl, onlineStoreHost);
  if (publication === 'unpublished') {
    return failure('unavailable', 409, 'SHOPIFY_PRODUCT_UNPUBLISHED');
  }
  if (publication === 'host_mismatch') {
    return failure('misconfiguration', 503, 'SHOPIFY_STOREFRONT_HOST_MISMATCH');
  }
  if (publication !== 'published') {
    return failure('upstream', 503, 'SHOPIFY_STOREFRONT_PRODUCT_URL_INVALID', response.status);
  }
  if (variant.availableForSale !== true) {
    return failure('unavailable', 409, 'SHOPIFY_VARIANT_UNAVAILABLE');
  }
  return { ok: true, product: { variantId: normalizedId, sku, price } };
}

async function verifyAdminVariant({
  store,
  apiVersion,
  normalizedId,
  normalizedSku,
  normalizedExpectedPrice,
  adminFetch,
  env,
}) {
  let response;
  try {
    response = await adminFetch(`https://${store}/admin/api/${apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: SHOPIFY_ADMIN_READING_VARIANT_QUERY,
        variables: { id: `gid://shopify/ProductVariant/${normalizedId}` },
      }),
      signal: AbortSignal.timeout(5_000),
    }, env);
  } catch {
    return failure('upstream', 503, 'SHOPIFY_ADMIN_REQUEST_FAILED');
  }

  if (!response || typeof response.ok !== 'boolean') {
    return failure('upstream', 503, 'SHOPIFY_ADMIN_RESPONSE_INVALID');
  }
  if (!response.ok) {
    const upstreamStatus = Number.isInteger(response.status) ? response.status : 0;
    const kind = upstreamStatus === 401 || upstreamStatus === 403
      ? 'misconfiguration'
      : 'upstream';
    return failure(kind, 503, 'SHOPIFY_ADMIN_HTTP_ERROR', upstreamStatus);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return failure('upstream', 503, 'SHOPIFY_GRAPHQL_RESPONSE_INVALID', response.status);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('upstream', 503, 'SHOPIFY_GRAPHQL_RESPONSE_INVALID', response.status);
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    return failure(
      'misconfiguration',
      503,
      'SHOPIFY_GRAPHQL_ERRORS',
      response.status,
      graphqlUpstreamCode(payload.errors),
    );
  }

  const variant = payload.data && payload.data.productVariant;
  if (variant === null) return failure('contract', 422, 'SHOPIFY_VARIANT_NOT_FOUND');
  if (!variant || typeof variant !== 'object' || Array.isArray(variant)
    || !variant.product || typeof variant.product !== 'object' || Array.isArray(variant.product)
    || !variant.inventoryItem || typeof variant.inventoryItem !== 'object' || Array.isArray(variant.inventoryItem)
    || typeof variant.availableForSale !== 'boolean'
    || typeof variant.inventoryItem.requiresShipping !== 'boolean') {
    return failure('upstream', 503, 'SHOPIFY_GRAPHQL_RESPONSE_INVALID', response.status);
  }

  const legacyResourceId = String(variant.legacyResourceId || '').trim();
  const sku = String(variant.sku || '').trim();
  const price = Number.parseFloat(String(variant.price ?? ''));
  if (legacyResourceId !== normalizedId) return failure('contract', 422, 'SHOPIFY_VARIANT_ID_MISMATCH');
  if (sku !== normalizedSku) return failure('contract', 422, 'SHOPIFY_VARIANT_SKU_MISMATCH');
  if (!Number.isFinite(price) || price <= 0) return failure('contract', 422, 'SHOPIFY_VARIANT_PRICE_INVALID');
  if (Math.abs(price - normalizedExpectedPrice) > 0.001) {
    return failure('contract', 422, 'SHOPIFY_VARIANT_PRICE_MISMATCH');
  }
  if (variant.inventoryItem.requiresShipping !== false) return failure('contract', 422, 'SHOPIFY_VARIANT_REQUIRES_SHIPPING');
  if (String(variant.product.status || '').trim().toUpperCase() !== 'ACTIVE') {
    return failure('unavailable', 409, 'SHOPIFY_PRODUCT_INACTIVE');
  }
  if (variant.availableForSale !== true) {
    return failure('unavailable', 409, 'SHOPIFY_VARIANT_UNAVAILABLE');
  }
  return { ok: true, product: { variantId: normalizedId, sku, price } };
}

export async function verifyShopifyReadingVariant({
  variantId,
  expectedSku,
  expectedPrice,
  env = {},
  adminFetch = shopifyAdminFetch,
  storefrontFetch = globalThis.fetch,
}) {
  const normalizedId = String(variantId || '').trim();
  const normalizedSku = String(expectedSku || '').trim();
  const normalizedExpectedPrice = Number(expectedPrice);
  if (!/^\d{8,20}$/.test(normalizedId)
    || !/^READING-(?:DEEP|MEDIUM|PREMIUM)$/.test(normalizedSku)
    || !Number.isFinite(normalizedExpectedPrice)
    || normalizedExpectedPrice <= 0) {
    return failure('contract', 422, 'EXPECTED_VARIANT_CONTRACT_INVALID');
  }

  const rawStorefrontToken = String(env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || '').trim();
  const storefrontToken = boundedToken(rawStorefrontToken);
  if (rawStorefrontToken && !storefrontToken) {
    return failure('misconfiguration', 503, 'SHOPIFY_STOREFRONT_TOKEN_INVALID');
  }
  const storefrontApiVersion = String(
    env.SHOPIFY_STOREFRONT_API_VERSION || env.SHOPIFY_API_VERSION || env.API_VERSION || '2026-07',
  ).trim();
  if (!validApiVersion(storefrontApiVersion)) {
    return failure('misconfiguration', 503, 'SHOPIFY_API_VERSION_INVALID');
  }

  let store;
  try {
    store = shopifyStoreDomain(env);
  } catch {
    return failure('misconfiguration', 503, 'SHOPIFY_STORE_INVALID');
  }
  const onlineStoreHost = configuredStorefrontHost(env);
  if (!onlineStoreHost) {
    return failure('misconfiguration', 503, 'SHOPIFY_STOREFRONT_HOST_INVALID');
  }

  const common = { store, normalizedId, normalizedSku, normalizedExpectedPrice, onlineStoreHost };
  // Product listing fields used here are available through Shopify's tokenless
  // Storefront API. Prefer the configured public token when it is valid, but a
  // stale/revoked public token must not force customer checkout offline: retry
  // the exact same read-only query tokenless on a 401/403 response. Admin is a
  // final compatibility fallback only when the storefront is unavailable.
  let storefrontResult = await verifyStorefrontVariant({
    ...common,
    apiVersion: storefrontApiVersion,
    token: storefrontToken,
    storefrontFetch,
  });
  if (storefrontToken
    && storefrontResult.ok === false
    && storefrontResult.reason === 'SHOPIFY_STOREFRONT_HTTP_ERROR'
    && (storefrontResult.upstreamStatus === 401 || storefrontResult.upstreamStatus === 403)) {
    storefrontResult = await verifyStorefrontVariant({
      ...common,
      apiVersion: storefrontApiVersion,
      token: '',
      storefrontFetch,
    });
  }
  if (storefrontResult.ok
    || storefrontResult.status === 409
    || storefrontResult.status === 422
    || storefrontResult.reason === 'SHOPIFY_STOREFRONT_HOST_MISMATCH'
    || storefrontResult.reason === 'SHOPIFY_STOREFRONT_PRODUCT_URL_INVALID'
    || storefrontToken) {
    return storefrontResult;
  }
  const adminApiVersion = String(env.SHOPIFY_API_VERSION || env.API_VERSION || '2026-07').trim();
  if (!validApiVersion(adminApiVersion)) {
    return failure('misconfiguration', 503, 'SHOPIFY_ADMIN_API_VERSION_INVALID');
  }
  return verifyAdminVariant({ ...common, apiVersion: adminApiVersion, adminFetch, env });
}
