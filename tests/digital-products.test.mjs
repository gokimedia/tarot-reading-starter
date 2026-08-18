import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIGITAL_DOWNLOAD_PATH,
  DIGITAL_PRODUCTS,
  digitalDownloadOrigin,
  digitalDownloadUrl,
  digitalOrderLines,
  digitalProductForSku,
  legacyShopifyId,
} from '../lib/digital-products.mjs';

test('digitalProductForSku matches case-insensitively and rejects unknown skus', () => {
  assert.equal(digitalProductForSku('PDF-TAROT-MASTERY'), DIGITAL_PRODUCTS['PDF-TAROT-MASTERY']);
  assert.equal(digitalProductForSku(' pdf-tarot-mastery '), DIGITAL_PRODUCTS['PDF-TAROT-MASTERY']);
  assert.equal(digitalProductForSku('READING-DEEP'), null);
  assert.equal(digitalProductForSku(''), null);
  assert.equal(digitalProductForSku(null), null);
  assert.equal(digitalProductForSku('toString'), null);
});

test('legacyShopifyId handles gid and numeric shapes', () => {
  assert.equal(legacyShopifyId('gid://shopify/LineItem/18906979205393'), '18906979205393');
  assert.equal(legacyShopifyId('18906979205393'), '18906979205393');
  assert.equal(legacyShopifyId(18906979205393), '18906979205393');
  assert.equal(legacyShopifyId('gid://shopify/LineItem/'), '');
  assert.equal(legacyShopifyId(''), '');
});

test('digitalOrderLines keeps only configured digital lines', () => {
  const lines = digitalOrderLines([
    { id: 'gid://shopify/LineItem/1', sku: 'READING-PREMIUM', quantity: 1 },
    { id: 'gid://shopify/LineItem/2', sku: 'pdf-tarot-mastery', quantity: 2 },
    { id: '', sku: 'PDF-TAROT-MASTERY', quantity: 1 },
    null,
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].lineItemId, '2');
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[0].product.sku, 'PDF-TAROT-MASTERY');
});

test('digitalDownloadOrigin validates https origins and falls back safely', () => {
  assert.equal(
    digitalDownloadOrigin({ DIGITAL_DOWNLOAD_ORIGIN: 'https://reading.deckaura.com/' }),
    'https://reading.deckaura.com',
  );
  assert.equal(
    digitalDownloadOrigin({ READING_SERVICE_ORIGIN: 'https://reading.deckaura.com' }),
    'https://reading.deckaura.com',
  );
  assert.equal(
    digitalDownloadOrigin({ DIGITAL_DOWNLOAD_ORIGIN: 'http://insecure.example.com' }),
    'https://reading.deckaura.com',
  );
  assert.equal(digitalDownloadOrigin({}), 'https://reading.deckaura.com');
});

test('digitalDownloadUrl builds the tokenized route', () => {
  const url = digitalDownloadUrl('https://reading.deckaura.com', 'abc123');
  assert.equal(url, `https://reading.deckaura.com${DIGITAL_DOWNLOAD_PATH}?token=abc123`);
});

test('digital product storage config stays inside the private bucket', () => {
  for (const product of Object.values(DIGITAL_PRODUCTS)) {
    assert.equal(product.bucket, 'digital-products');
    assert.ok(product.storagePath.startsWith(`${product.slug}/`));
    assert.ok(!product.storagePath.includes('..'));
    assert.ok(product.linkValidityDays >= 7);
    assert.ok(product.maxDownloads > 0);
  }
});
