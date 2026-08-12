import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  SHOPIFY_ADMIN_READING_VARIANT_QUERY,
  SHOPIFY_READING_VARIANT_QUERY,
  SHOPIFY_STOREFRONT_READING_VARIANT_QUERY,
  verifyShopifyReadingVariant,
} from '../lib/shopify-reading-variant.mjs';

const ENV = { SHOPIFY_STORE: 'deckaura', API_VERSION: '2026-07' };
const STOREFRONT_ENV = {
  ...ENV,
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: 'test-storefront-token-never-logged',
};
const root = new URL('../', import.meta.url);
const VALID_ADMIN_VARIANT = {
  legacyResourceId: '53782499066129',
  sku: 'READING-DEEP',
  price: '5.99',
  availableForSale: true,
  inventoryItem: { requiresShipping: false },
  product: { status: 'ACTIVE' },
};
const VALID_STOREFRONT_VARIANT = {
  id: 'gid://shopify/ProductVariant/53782499066129',
  sku: 'READING-DEEP',
  availableForSale: true,
  requiresShipping: false,
  price: { amount: '5.99', currencyCode: 'USD' },
  product: { onlineStoreUrl: 'https://deckaura.com/products/twin-flame-reading' },
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('uses Storefront GraphQL first and validates the complete published digital-product contract', async () => {
  assert.equal(SHOPIFY_READING_VARIANT_QUERY, SHOPIFY_STOREFRONT_READING_VARIANT_QUERY);
  assert.match(SHOPIFY_STOREFRONT_READING_VARIANT_QUERY, /@inContext\(country: US\)/);
  assert.match(SHOPIFY_STOREFRONT_READING_VARIANT_QUERY, /node\(id: \$id\)/);
  assert.match(SHOPIFY_READING_VARIANT_QUERY, /availableForSale/);
  assert.match(SHOPIFY_READING_VARIANT_QUERY, /requiresShipping/);
  assert.match(SHOPIFY_READING_VARIANT_QUERY, /price\s*\{\s*amount\s+currencyCode/);
  assert.match(SHOPIFY_READING_VARIANT_QUERY, /product\s*\{\s*onlineStoreUrl/);
  let call;
  const result = await verifyShopifyReadingVariant({
    variantId: '53782499066129',
    expectedSku: 'READING-DEEP',
    expectedPrice: 5.99,
    env: {
      ...STOREFRONT_ENV,
      SHOPIFY_STOREFRONT_API_VERSION: '2026-10',
      SHOPIFY_API_VERSION: '2026-07',
      API_VERSION: '2026-04',
    },
    storefrontFetch: async (url, init) => {
      call = { url, init };
      return response({ data: { node: VALID_STOREFRONT_VARIANT } });
    },
    adminFetch: async () => { throw new Error('Admin must not be attempted when a Storefront token exists'); },
  });
  assert.deepEqual(result, {
    ok: true,
    product: { variantId: '53782499066129', sku: 'READING-DEEP', price: 5.99 },
  });
  assert.equal(call.url, 'https://deckaura.myshopify.com/api/2026-10/graphql.json');
  assert.equal(call.init.method, 'POST');
  assert.equal(new Headers(call.init.headers).get('X-Shopify-Storefront-Access-Token'), STOREFRONT_ENV.SHOPIFY_STOREFRONT_ACCESS_TOKEN);
  assert.equal(new Headers(call.init.headers).has('X-Shopify-Access-Token'), false);
  const body = JSON.parse(call.init.body);
  assert.equal(body.variables.id, 'gid://shopify/ProductVariant/53782499066129');
  assert.doesNotMatch(call.url, /\/admin\//);
});

test('uses tokenless Storefront GraphQL when the public token is absent', async () => {
  assert.match(SHOPIFY_ADMIN_READING_VARIANT_QUERY, /legacyResourceId/);
  assert.match(SHOPIFY_ADMIN_READING_VARIANT_QUERY, /inventoryItem\s*\{\s*requiresShipping/);
  let call;
  const result = await verifyShopifyReadingVariant({
    variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99,
    env: { ...ENV, SHOPIFY_API_VERSION: '2026-10', API_VERSION: '2026-04' },
    storefrontFetch: async (url, init) => {
      call = { url, init };
      return response({ data: { node: VALID_STOREFRONT_VARIANT } });
    },
    adminFetch: async () => { throw new Error('Admin must not run when tokenless Storefront succeeds'); },
  });
  assert.equal(result.ok, true);
  assert.equal(call.url, 'https://deckaura.myshopify.com/api/2026-10/graphql.json');
  assert.equal(new Headers(call.init.headers).has('X-Shopify-Storefront-Access-Token'), false);
});

test('tokenless Storefront keeps Storefront and Admin API version precedence separate', async () => {
  let storefrontUrl = '';
  let adminUrl = '';
  const env = {
    SHOPIFY_STORE: 'deckaura',
    SHOPIFY_STOREFRONT_API_VERSION: '2026-10',
    SHOPIFY_API_VERSION: '2026-04',
    API_VERSION: '2026-01',
  };
  const storefront = await verifyShopifyReadingVariant({
    variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99, env,
    storefrontFetch: async (url) => {
      storefrontUrl = url;
      return response({ data: { node: VALID_STOREFRONT_VARIANT } });
    },
    adminFetch: async () => { throw new Error('Admin must not run when Storefront succeeds'); },
  });
  assert.equal(storefront.ok, true);
  assert.equal(storefrontUrl, 'https://deckaura.myshopify.com/api/2026-10/graphql.json');

  const fallback = await verifyShopifyReadingVariant({
    variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99, env,
    storefrontFetch: async () => { throw new Error('simulated Storefront outage'); },
    adminFetch: async (url) => {
      adminUrl = url;
      return response({ data: { productVariant: VALID_ADMIN_VARIANT } });
    },
  });
  assert.equal(fallback.ok, true);
  assert.equal(adminUrl, 'https://deckaura.myshopify.com/admin/api/2026-04/graphql.json');
});

test('retries a rejected public Storefront token without a token', async () => {
  const calls = [];
  const result = await verifyShopifyReadingVariant({
    variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99,
    env: STOREFRONT_ENV,
    storefrontFetch: async (_url, init) => {
      const token = new Headers(init.headers).get('X-Shopify-Storefront-Access-Token');
      calls.push(token);
      return token
        ? response({ error: 'invalid token must not propagate' }, 401)
        : response({ data: { node: VALID_STOREFRONT_VARIANT } });
    },
    adminFetch: async () => { throw new Error('Admin must not run after tokenless Storefront succeeds'); },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [STOREFRONT_ENV.SHOPIFY_STOREFRONT_ACCESS_TOKEN, null]);
  assert.equal(JSON.stringify(result).includes(STOREFRONT_ENV.SHOPIFY_STOREFRONT_ACCESS_TOKEN), false);
});

test('uses Admin GraphQL only when tokenless Storefront is unavailable', async () => {
  let adminCall;
  const result = await verifyShopifyReadingVariant({
    variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99,
    env: { ...ENV, SHOPIFY_API_VERSION: '2026-10' },
    storefrontFetch: async () => { throw new Error('simulated storefront outage'); },
    adminFetch: async (url, init) => {
      adminCall = { url, init };
      return response({ data: { productVariant: VALID_ADMIN_VARIANT } });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(adminCall.url, 'https://deckaura.myshopify.com/admin/api/2026-10/graphql.json');
});

test('classifies upstream and credential failures as retryable 503 without exposing bodies', async () => {
  const http = await verifyShopifyReadingVariant({
    variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99,
    env: STOREFRONT_ENV,
    storefrontFetch: async () => response({ secret: 'must-not-propagate' }, 403),
    adminFetch: async () => { throw new Error('Admin must not be attempted'); },
  });
  assert.deepEqual(http, {
    ok: false,
    kind: 'misconfiguration',
    status: 503,
    reason: 'SHOPIFY_STOREFRONT_HTTP_ERROR',
    upstreamStatus: 403,
  });
  assert.equal(JSON.stringify(http).includes(STOREFRONT_ENV.SHOPIFY_STOREFRONT_ACCESS_TOKEN), false);

  const invalidVersion = await verifyShopifyReadingVariant({
    variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99,
    env: { ...STOREFRONT_ENV, SHOPIFY_STOREFRONT_API_VERSION: '../private' },
    storefrontFetch: async () => { throw new Error('must not run'); },
    adminFetch: async () => { throw new Error('must not run'); },
  });
  assert.equal(invalidVersion.status, 503);
  assert.equal(invalidVersion.kind, 'misconfiguration');
  assert.equal(invalidVersion.reason, 'SHOPIFY_API_VERSION_INVALID');

  const graphqlError = await verifyShopifyReadingVariant({
    variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99,
    env: STOREFRONT_ENV,
    storefrontFetch: async () => response({ errors: [{
      message: 'sensitive upstream detail',
      path: ['query', 'must-not-be-read'],
      extensions: {
        code: 'undefinedField',
        typeName: 'ProductVariant',
        fieldName: 'requiresShipping',
        path: ['node', 'requiresShipping'],
        unsafeDetail: 'must-not-be-read',
      },
    }] }),
    adminFetch: async () => { throw new Error('Admin must not be attempted'); },
  });
  assert.equal(graphqlError.status, 503);
  assert.equal(graphqlError.reason, 'SHOPIFY_STOREFRONT_GRAPHQL_ERRORS');
  assert.equal(
    graphqlError.upstreamCode,
    'code:undefinedField|typeName:ProductVariant|fieldName:requiresShipping|path:node.requiresShipping',
  );
  assert.equal(JSON.stringify(graphqlError).includes('sensitive upstream detail'), false);
  assert.equal(JSON.stringify(graphqlError).includes('must-not-be-read'), false);

  const adminHttp = await verifyShopifyReadingVariant({
    variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99, env: ENV,
    storefrontFetch: async () => { throw new Error('simulated storefront outage'); },
    adminFetch: async () => response({ secret: 'must-not-propagate' }, 403),
  });
  assert.equal(adminHttp.reason, 'SHOPIFY_ADMIN_HTTP_ERROR');
  assert.equal(adminHttp.status, 503);

  const route = await readFile(new URL('app/api/readings/intent/route.ts', root), 'utf8');
  assert.match(route, /\.\.\.\(context\.upstreamCode \? \{ upstreamCode: context\.upstreamCode \} : \{\}\)/);
  assert.doesNotMatch(route, /payload\.errors|response\.text\(/);
});

test('classifies real catalog mismatches as 422', async () => {
  const storefrontCases = [
    ['gid', { ...VALID_STOREFRONT_VARIANT, id: 'gid://shopify/ProductVariant/53782499098897' }, 'SHOPIFY_VARIANT_ID_MISMATCH'],
    ['sku', { ...VALID_STOREFRONT_VARIANT, sku: 'READING-MEDIUM' }, 'SHOPIFY_VARIANT_SKU_MISMATCH'],
    ['price', { ...VALID_STOREFRONT_VARIANT, price: { amount: '0', currencyCode: 'USD' } }, 'SHOPIFY_VARIANT_PRICE_INVALID'],
    ['price mismatch', { ...VALID_STOREFRONT_VARIANT, price: { amount: '6.99', currencyCode: 'USD' } }, 'SHOPIFY_VARIANT_PRICE_MISMATCH'],
    ['currency', { ...VALID_STOREFRONT_VARIANT, price: { amount: '5.99', currencyCode: 'EUR' } }, 'SHOPIFY_VARIANT_CURRENCY_MISMATCH'],
    ['shipping', { ...VALID_STOREFRONT_VARIANT, requiresShipping: true }, 'SHOPIFY_VARIANT_REQUIRES_SHIPPING'],
  ];
  for (const [label, node, reason] of storefrontCases) {
    const result = await verifyShopifyReadingVariant({
      variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99,
      env: STOREFRONT_ENV,
      storefrontFetch: async () => response({ data: { node } }),
      adminFetch: async () => { throw new Error('Admin must not be attempted'); },
    });
    assert.equal(result.status, 422, label);
    assert.equal(result.kind, 'contract', label);
    assert.equal(result.reason, reason, label);
  }

  const adminCases = [
    ['not found', null, 'SHOPIFY_VARIANT_NOT_FOUND'],
    ['legacy id', { ...VALID_ADMIN_VARIANT, legacyResourceId: '53782499098897' }, 'SHOPIFY_VARIANT_ID_MISMATCH'],
    ['sku', { ...VALID_ADMIN_VARIANT, sku: 'READING-MEDIUM' }, 'SHOPIFY_VARIANT_SKU_MISMATCH'],
    ['price', { ...VALID_ADMIN_VARIANT, price: '0' }, 'SHOPIFY_VARIANT_PRICE_INVALID'],
    ['price mismatch', { ...VALID_ADMIN_VARIANT, price: '6.99' }, 'SHOPIFY_VARIANT_PRICE_MISMATCH'],
    ['shipping', { ...VALID_ADMIN_VARIANT, inventoryItem: { requiresShipping: true } }, 'SHOPIFY_VARIANT_REQUIRES_SHIPPING'],
  ];
  for (const [label, productVariant, reason] of adminCases) {
    const result = await verifyShopifyReadingVariant({
      variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99, env: ENV,
      storefrontFetch: async () => { throw new Error('simulated storefront outage'); },
      adminFetch: async () => response({ data: { productVariant } }),
    });
    assert.equal(result.status, 422, `Admin ${label}`);
    assert.equal(result.kind, 'contract', `Admin ${label}`);
    assert.equal(result.reason, reason, `Admin ${label}`);
  }
});

test('classifies unavailable variants and inactive products as 409', async () => {
  for (const [label, node, reason] of [
    ['missing node', null, 'SHOPIFY_VARIANT_UNAVAILABLE'],
    ['unavailable', { ...VALID_STOREFRONT_VARIANT, availableForSale: false }, 'SHOPIFY_VARIANT_UNAVAILABLE'],
    ['unpublished', { ...VALID_STOREFRONT_VARIANT, product: { onlineStoreUrl: null } }, 'SHOPIFY_PRODUCT_UNPUBLISHED'],
  ]) {
    const result = await verifyShopifyReadingVariant({
      variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99,
      env: STOREFRONT_ENV,
      storefrontFetch: async () => response({ data: { node } }),
    });
    assert.equal(result.status, 409, label);
    assert.equal(result.kind, 'unavailable', label);
    assert.equal(result.reason, reason, label);
  }

  const customHost = await verifyShopifyReadingVariant({
    variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99,
    env: { ...STOREFRONT_ENV, SHOPIFY_STOREFRONT_HOST: 'shop.deckaura.com' },
    storefrontFetch: async () => response({ data: { node: {
      ...VALID_STOREFRONT_VARIANT,
      product: { onlineStoreUrl: 'https://shop.deckaura.com/products/twin-flame-reading' },
    } } }),
  });
  assert.equal(customHost.ok, true);

  for (const [productVariant, reason] of [
    [{ ...VALID_ADMIN_VARIANT, availableForSale: false }, 'SHOPIFY_VARIANT_UNAVAILABLE'],
    [{ ...VALID_ADMIN_VARIANT, product: { status: 'DRAFT' } }, 'SHOPIFY_PRODUCT_INACTIVE'],
  ]) {
    const result = await verifyShopifyReadingVariant({
      variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99, env: ENV,
      storefrontFetch: async () => { throw new Error('simulated storefront outage'); },
      adminFetch: async () => response({ data: { productVariant } }),
    });
    assert.equal(result.status, 409);
    assert.equal(result.kind, 'unavailable');
    assert.equal(result.reason, reason);
  }
});

test('invalid or mismatched Storefront host fails retryably with or without a token', async () => {
  for (const [label, env] of [
    ['tokenless', ENV],
    ['token-based', STOREFRONT_ENV],
  ]) {
    const mismatch = await verifyShopifyReadingVariant({
      variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99, env,
      storefrontFetch: async () => response({ data: { node: {
        ...VALID_STOREFRONT_VARIANT,
        product: { onlineStoreUrl: 'https://unexpected.example/products/twin' },
      } } }),
      adminFetch: async () => { throw new Error('A catalog contract mismatch must not fall through to Admin'); },
    });
    assert.equal(mismatch.status, 503, label);
    assert.equal(mismatch.kind, 'misconfiguration', label);
    assert.equal(mismatch.reason, 'SHOPIFY_STOREFRONT_HOST_MISMATCH', label);

    const malformed = await verifyShopifyReadingVariant({
      variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99, env,
      storefrontFetch: async () => response({ data: { node: {
        ...VALID_STOREFRONT_VARIANT,
        product: { onlineStoreUrl: 'javascript:alert(1)' },
      } } }),
      adminFetch: async () => { throw new Error('Malformed Storefront data must not fall through to Admin'); },
    });
    assert.equal(malformed.status, 503, label);
    assert.equal(malformed.kind, 'upstream', label);
    assert.equal(malformed.reason, 'SHOPIFY_STOREFRONT_PRODUCT_URL_INVALID', label);

    const invalidConfig = await verifyShopifyReadingVariant({
      variantId: '53782499066129', expectedSku: 'READING-DEEP', expectedPrice: 5.99,
      env: { ...env, SHOPIFY_STOREFRONT_HOST: 'https://deckaura.com/path' },
      storefrontFetch: async () => { throw new Error('Invalid host configuration must fail before fetch'); },
      adminFetch: async () => { throw new Error('Invalid host configuration must fail before Admin'); },
    });
    assert.equal(invalidConfig.status, 503, label);
    assert.equal(invalidConfig.kind, 'misconfiguration', label);
    assert.equal(invalidConfig.reason, 'SHOPIFY_STOREFRONT_HOST_INVALID', label);
  }
});
