import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  BIG_THREE_FUNNEL_VERSION,
  BIG_THREE_QUOTE_MISMATCH,
  validateBigThreePaidQuote,
} from '../lib/big-three.ts';

const INTENT_ID = '12345678-1234-4234-9234-123456789abc';

function fixture() {
  return {
    snapshot: {
      localeContext: {
        language: 'de', locale: 'de-DE', country: 'DE', currency: 'EUR', market: 'de',
      },
      checkoutQuote: {
        intentId: INTENT_ID,
        variantId: '53782500114705',
        sku: 'READING-MEDIUM',
        priceCents: 949,
        currency: 'EUR',
        country: 'DE',
      },
    },
    row: {
      id: INTENT_ID,
      variantId: '53782500114705',
      sku: 'READING-MEDIUM',
      tier: 'medium',
      funnelVersion: BIG_THREE_FUNNEL_VERSION,
    },
    line: {
      variantId: '53782500114705',
      sku: 'READING-MEDIUM',
      quantity: 1,
      requiresShipping: false,
      checkoutIntent: INTENT_ID,
      funnelVersion: BIG_THREE_FUNNEL_VERSION,
      selectedPackage: 'medium',
      intentKind: 'big_three',
      displayedQuoteCents: '949',
      displayedQuoteCurrency: 'EUR',
      displayedQuoteCountry: 'DE',
      signedQuoteCents: '949',
      signedQuoteCurrency: 'EUR',
      signedQuoteCountry: 'DE',
      language: 'de',
      locale: 'de-DE',
      country: 'DE',
      currency: 'EUR',
      market: 'de',
      presentmentAmount: '9.49',
      presentmentCurrency: 'EUR',
    },
  };
}

test('Big Three paid quote preserves pre-rollout intents without a checkoutQuote', () => {
  const input = fixture();
  delete input.snapshot.checkoutQuote;
  assert.deepEqual(validateBigThreePaidQuote(input), { applies: false, ok: true, reason: '' });
});

test('Big Three paid quote binds signed quote, displayed quote, Shopify money, product and locale', () => {
  const valid = validateBigThreePaidQuote(fixture());
  assert.equal(valid.applies, true);
  assert.equal(valid.ok, true, valid.reason);
  assert.deepEqual(valid.quote, {
    intentId: INTENT_ID,
    variantId: '53782500114705',
    sku: 'READING-MEDIUM',
    priceCents: 949,
    currency: 'EUR',
    country: 'DE',
  });
});

test('Big Three paid quote fails closed for malformed or tampered bindings', () => {
  const mutations = [
    ['null quote', (value) => { value.snapshot.checkoutQuote = null; }],
    ['intent id', (value) => { value.snapshot.checkoutQuote.intentId = '22345678-1234-4234-9234-123456789abc'; }],
    ['variant id', (value) => { value.snapshot.checkoutQuote.variantId = '53782500147473'; }],
    ['sku', (value) => { value.snapshot.checkoutQuote.sku = 'READING-PREMIUM'; }],
    ['price cents', (value) => { value.snapshot.checkoutQuote.priceCents = 950; }],
    ['quote currency', (value) => { value.snapshot.checkoutQuote.currency = 'USD'; }],
    ['quote country', (value) => { value.snapshot.checkoutQuote.country = 'US'; }],
    ['locale language', (value) => { value.snapshot.localeContext.language = 'en'; }],
    ['locale name', (value) => { value.snapshot.localeContext.locale = 'en-US'; }],
    ['locale currency', (value) => { value.snapshot.localeContext.currency = 'USD'; }],
    ['locale country', (value) => { value.snapshot.localeContext.country = 'US'; }],
    ['locale market', (value) => { value.snapshot.localeContext.market = 'us'; }],
    ['line amount', (value) => { value.line.presentmentAmount = '9.50'; }],
    ['line currency', (value) => { value.line.presentmentCurrency = 'USD'; }],
    ['line variant', (value) => { value.line.variantId = '53782500147473'; }],
    ['line sku', (value) => { value.line.sku = 'READING-PREMIUM'; }],
    ['line quantity', (value) => { value.line.quantity = 2; }],
    ['shipping line', (value) => { value.line.requiresShipping = true; }],
    ['checkout intent property', (value) => { value.line.checkoutIntent = '22345678-1234-4234-9234-123456789abc'; }],
    ['funnel property', (value) => { value.line.funnelVersion = 'big-three-v0'; }],
    ['row funnel', (value) => { value.row.funnelVersion = 'big-three-v0'; }],
    ['selected package', (value) => { value.line.selectedPackage = 'premium'; }],
    ['intent kind', (value) => { value.line.intentKind = 'shared_tool'; }],
    ['displayed cents', (value) => { value.line.displayedQuoteCents = '950'; }],
    ['displayed currency', (value) => { value.line.displayedQuoteCurrency = 'USD'; }],
    ['displayed country', (value) => { value.line.displayedQuoteCountry = 'US'; }],
    ['signed cents', (value) => { value.line.signedQuoteCents = '950'; }],
    ['signed currency', (value) => { value.line.signedQuoteCurrency = 'USD'; }],
    ['signed country', (value) => { value.line.signedQuoteCountry = 'US'; }],
    ['line language', (value) => { value.line.language = 'en'; }],
    ['line locale', (value) => { value.line.locale = 'en-US'; }],
    ['line country', (value) => { value.line.country = 'US'; }],
    ['line currency property', (value) => { value.line.currency = 'USD'; }],
    ['line market', (value) => { value.line.market = 'us'; }],
  ];
  for (const [label, mutate] of mutations) {
    const changed = structuredClone(fixture());
    mutate(changed);
    assert.deepEqual(
      validateBigThreePaidQuote(changed),
      { applies: true, ok: false, reason: BIG_THREE_QUOTE_MISMATCH },
      label,
    );
  }
});

test('Big Three fulfillment calls the quote verifier and records verified quote evidence', async () => {
  const source = await readFile(new URL('../lib/reading-queue-processor.ts', import.meta.url), 'utf8');
  const start = source.indexOf("if (intentKind === 'big_three')");
  const end = source.indexOf("if (intentKind === 'angel_number')", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /validateBigThreePaidQuote\(/);
  assert.match(block, /if \(!quoteValidation\.ok\) throw new QueueOperationError\(quoteValidation\.reason\)/);
  assert.match(block, /checkoutQuotePriceCents: quoteValidation\.quote\.priceCents/);
});
