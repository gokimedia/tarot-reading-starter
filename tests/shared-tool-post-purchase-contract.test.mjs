import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { verifySharedToolPaidOrder } from '../lib/shared-tool-order-contract.mjs';

const root = new URL('../', import.meta.url);
const snapshotHash = 'a'.repeat(64);

function validInput() {
  return {
    row: {
      page: '/pages/twin-flame-calculator',
      funnelVersion: 'enterprise-shared-tools-2026-08-v1',
      readingId: 'twin-12345678',
      readingType: 'Twin Flame Connection',
      question: 'What pattern should I understand about this connection?',
      tier: 'standard',
      variantId: '53782499066129',
      sku: 'READING-DEEP',
      price: 5.99,
      snapshotHash,
    },
    snapshot: {
      version: 'reading-snapshot-v2',
      type: 'Twin Flame Connection',
      question: 'What pattern should I understand about this connection?',
      context: 'A bounded result context.',
      signals: 'mirroring pattern; timing uncertainty',
      cards: '',
      spread: '',
      scope: 'Use only the supplied result and question.',
      confidence: 'Reflective guidance, not a fixed prediction.',
      focus: 'relationship clarity',
      tool: '/pages/twin-flame-calculator',
      curiosityQuestion: 'What grounded next step would clarify the pattern?',
      readingId: 'twin-12345678',
    },
    line: {
      intentKind: 'shared_tool',
      toolPage: '/pages/twin-flame-calculator',
      toolType: 'Twin Flame Connection',
      snapshotVersion: 'reading-snapshot-v2',
      snapshotHash,
    },
  };
}

function quotedInput() {
  const input = validInput();
  Object.assign(input.row, { id: '11111111-1111-4111-8111-111111111111' });
  Object.assign(input.snapshot, {
    localeContext: { language: 'de', locale: 'de-DE', country: 'DE', currency: 'EUR', market: 'de' },
    checkoutQuote: {
      intentId: input.row.id,
      variantId: input.row.variantId,
      sku: input.row.sku,
      priceCents: 549,
      currency: 'EUR',
      country: 'DE',
    },
  });
  Object.assign(input.line, {
    variantId: input.row.variantId,
    sku: input.row.sku,
    quantity: 1,
    requiresShipping: false,
    checkoutIntent: input.row.id,
    funnelVersion: input.row.funnelVersion,
    selectedPackage: input.row.tier,
    displayedQuoteCents: '549',
    displayedQuoteCurrency: 'EUR',
    displayedQuoteCountry: 'DE',
    signedQuoteCents: '549',
    signedQuoteCurrency: 'EUR',
    signedQuoteCountry: 'DE',
    language: 'de',
    locale: 'de-DE',
    country: 'DE',
    currency: 'EUR',
    market: 'de',
    presentmentAmount: '5.49',
    presentmentCurrency: 'EUR',
  });
  return input;
}

test('post-purchase shared_tool verification preserves the signed snapshot for the delivery draft', () => {
  const result = verifySharedToolPaidOrder(validInput());
  assert.equal(result.ok, true);
  assert.deepEqual(result.product, {
    productKey: 'shared_tool',
    tier: 'standard',
    storefrontTier: 'essential',
    variantId: '53782499066129',
    sku: 'READING-DEEP',
    price: 5.99,
  });
  assert.equal(result.verifiedFields.question, validInput().snapshot.question);
  assert.equal(result.verifiedFields.readingType, 'Twin Flame Connection');
  assert.equal(result.verifiedFields.toolPage, '/pages/twin-flame-calculator');
  assert.equal(result.verifiedFields.signals, validInput().snapshot.signals);
  assert.equal(result.verifiedFields.curiosityQuestion, validInput().snapshot.curiosityQuestion);
});

test('quote-less legacy generic shared_tool rows remain compatible', () => {
  const input = validInput();
  assert.equal(Object.hasOwn(input.snapshot, 'checkoutQuote'), false);
  assert.equal(verifySharedToolPaidOrder(input).ok, true);
});

test('stored generic checkoutQuote binds paid amount, currency, product, locale and quote properties', () => {
  const valid = verifySharedToolPaidOrder(quotedInput());
  assert.equal(valid.ok, true);
  assert.equal(valid.verifiedFields.checkoutQuotePriceCents, 549);
  assert.equal(valid.verifiedFields.checkoutQuoteCurrency, 'EUR');

  const cases = [
    ['paid amount', { presentmentAmount: '9.99' }],
    ['paid currency', { presentmentCurrency: 'USD' }],
    ['variant', { variantId: '53782498312465' }],
    ['sku', { sku: 'READING-MEDIUM' }],
    ['quantity', { quantity: 2 }],
    ['shipping', { requiresShipping: true }],
    ['funnel version', { funnelVersion: 'wrong-funnel' }],
    ['selected package', { selectedPackage: 'premium' }],
    ['displayed quote property', { displayedQuoteCents: '999' }],
    ['signed quote property', { signedQuoteCurrency: 'USD' }],
    ['locale property', { locale: 'en-US' }],
    ['market property', { market: 'us' }],
  ];
  for (const [label, lineOverride] of cases) {
    const input = quotedInput();
    Object.assign(input.line, lineOverride);
    assert.deepEqual(
      verifySharedToolPaidOrder(input),
      { ok: false, reason: 'SHARED_CHECKOUT_QUOTE_MISMATCH' },
      label,
    );
  }
});

test('post-purchase shared_tool verification rejects manifest, price, line and snapshot drift', () => {
  const cases = [
    { row: { variantId: '53782498312465' }, reason: 'SHARED_PRODUCT_CONTRACT_MISMATCH' },
    { row: { price: 9.99 }, reason: 'SHARED_PRODUCT_CONTRACT_MISMATCH' },
    { line: { toolPage: '/pages/birth-chart-calculator' }, reason: 'SHARED_LINE_PROPERTY_CONTRACT_MISMATCH' },
    { line: { snapshotHash: 'b'.repeat(64) }, reason: 'SHARED_LINE_PROPERTY_CONTRACT_MISMATCH' },
    { snapshot: { type: 'Astrology Birth Chart' }, reason: 'SHARED_SNAPSHOT_CONTRACT_MISMATCH' },
    { snapshot: { curiosityQuestion: '' }, reason: 'SHARED_SNAPSHOT_CONTRACT_MISMATCH' },
  ];
  for (const entry of cases) {
    const input = validInput();
    if (entry.row) Object.assign(input.row, entry.row);
    if (entry.line) Object.assign(input.line, entry.line);
    if (entry.snapshot) Object.assign(input.snapshot, entry.snapshot);
    assert.deepEqual(verifySharedToolPaidOrder(input), { ok: false, reason: entry.reason });
  }
});

test('queue processor recognizes shared variants, verifies the snapshot and returns shared_tool authority', async () => {
  const source = await readFile(new URL('lib/reading-queue-processor.ts', root), 'utf8');
  assert.match(source, /SHARED_TOOL_VARIANT_IDS\.includes\(variantId\)/);
  assert.match(source, /intentKind === 'shared_tool'/);
  assert.match(source, /text\(row\.funnel_version, 128\) !== SHARED_TOOL_FUNNEL_VERSION/);
  assert.match(source, /verifySharedToolPaidOrder\(/);
  assert.match(source, /hashCheckoutIntentSnapshot\(snapshot\)/);
  assert.match(source, /itemProperty\(item, \['snapshot hash'\]\)/);
  assert.match(source, /itemProperty\(item, \['signed quote cents'\]\)/);
  assert.match(source, /requiresShipping: item\.requires_shipping/);
  assert.match(source, /intentKind === 'shared_tool' \? 'shared_tool'/);
  assert.match(source, /sharedToolVerifiedFields = sharedOrderVerification\.verifiedFields/);
  assert.match(source, /sourcePage \|\| toolPage/);
});
