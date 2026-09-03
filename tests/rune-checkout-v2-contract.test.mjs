import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  RUNE_V2_CONTRACT_VERSION,
  canonicalRuneV2Cast,
  validateRuneV2Snapshot,
  verifyRuneV2PaidLine,
} from '../lib/rune-checkout-v2.mjs';
import { runeCheckoutContractForItems } from '../lib/rune-reading.ts';
import { verifySharedToolPaidOrder } from '../lib/shared-tool-order-contract.mjs';

const root = new URL('../', import.meta.url);
const snapshotHash = 'c'.repeat(64);
const intentId = '22222222-2222-4222-8222-222222222222';
const canonicalCast = Object.freeze([
  Object.freeze({ positionId: 'anchor', runeIndex: 0, name: 'Fehu', orientation: 'upright' }),
  Object.freeze({ positionId: 'path_a', runeIndex: 1, name: 'Uruz', orientation: 'reversed' }),
  Object.freeze({ positionId: 'path_b', runeIndex: 3, name: 'Ansuz', orientation: 'upright' }),
  Object.freeze({ positionId: 'gate', runeIndex: 4, name: 'Raidho', orientation: 'reversed' }),
  Object.freeze({ positionId: 'move', runeIndex: 5, name: 'Kenaz', orientation: 'upright' }),
]);

const displays = Object.freeze({
  en: Object.freeze({
    focus: 'A Decision',
    answer: 'Compare two paths',
    timeframe: 'No fixed timeframe',
    signals: 'Anchor: Fehu (upright); Path A: Uruz (reversed); Path B: Ansuz (upright); Gate: Raidho (reversed); Move: Kenaz (upright)',
    language: 'en', locale: 'en-US', country: 'US', currency: 'USD', market: 'us', cents: 599,
  }),
  tr: Object.freeze({
    focus: 'Bir Karar',
    answer: 'İki yolu karşılaştır',
    timeframe: 'Sabit zaman aralığı yok',
    signals: 'Dayanak: Fehu (düz); A Yolu: Uruz (ters); B Yolu: Ansuz (düz); Eşik: Raidho (ters); Adım: Kenaz (düz)',
    language: 'tr', locale: 'tr-TR', country: 'TR', currency: 'TRY', market: 'tr', cents: 19900,
  }),
});

function runeInput(language = 'en') {
  const display = displays[language];
  const question = language === 'tr'
    ? 'İki seçeneğim arasında hangi yolu seçmeliyim?'
    : 'Which of these two paths should I choose?';
  const context = `Focus: ${display.focus}; Answer type: ${display.answer}; Timeframe: ${display.timeframe}; Exact cast: ${display.signals}`;
  const snapshot = {
    version: 'reading-snapshot-v2',
    type: 'Rune Reading',
    question,
    context,
    signals: display.signals,
    cards: '',
    spread: 'crossroads spread',
    scope: 'Interpret this exact rune cast for the customer question and selected spread.',
    confidence: 'Unique runes drawn without replacement from the 24-rune Elder Futhark set.',
    focus: display.focus,
    focusId: 'decision',
    answerId: 'compare',
    answerKind: 'crossroads',
    timeframeId: 'no_fixed_timeframe',
    cast: canonicalCast.map((entry) => ({ ...entry })),
    tool: 'Rune Reading',
    readingId: `rune-${language}-12345678`,
    curiosityQuestion: language === 'tr' ? 'Hangi koşul kararı netleştirir?' : 'Which condition would clarify the decision?',
    presentationVariant: 'rune-v2-direct-v1',
    localeContext: {
      language: display.language,
      locale: display.locale,
      country: display.country,
      currency: display.currency,
      market: display.market,
    },
    checkoutQuote: {
      intentId,
      variantId: '53782500213009',
      sku: 'READING-DEEP',
      priceCents: display.cents,
      currency: display.currency,
      country: display.country,
    },
  };
  return {
    row: {
      id: intentId,
      page: '/pages/rune-reading',
      funnelVersion: 'enterprise-shared-tools-2026-08-v1',
      readingId: snapshot.readingId,
      readingType: 'Rune Reading',
      question,
      tier: 'standard',
      variantId: '53782500213009',
      sku: 'READING-DEEP',
      price: 5.99,
      snapshotHash,
    },
    snapshot,
    line: {
      variantId: '53782500213009',
      sku: 'READING-DEEP',
      quantity: 1,
      requiresShipping: false,
      checkoutIntent: intentId,
      funnelVersion: 'enterprise-shared-tools-2026-08-v1',
      selectedPackage: 'standard',
      intentKind: 'shared_tool',
      toolPage: '/pages/rune-reading',
      toolType: 'Rune Reading',
      snapshotVersion: 'reading-snapshot-v2',
      snapshotHash,
      displayedQuoteCents: String(display.cents),
      displayedQuoteCurrency: display.currency,
      displayedQuoteCountry: display.country,
      signedQuoteCents: String(display.cents),
      signedQuoteCurrency: display.currency,
      signedQuoteCountry: display.country,
      language: display.language,
      locale: display.locale,
      country: display.country,
      currency: display.currency,
      market: display.market,
      contractVersion: RUNE_V2_CONTRACT_VERSION,
      readingType: 'Rune Reading',
      question,
      readingFocus: display.focus,
      focus: display.focus,
      answerType: display.answer,
      timeframe: display.timeframe,
      runeCast: display.signals,
      resultSignals: display.signals,
      spread: 'crossroads spread',
      context,
      readingScope: snapshot.scope,
      calculationConfidence: snapshot.confidence,
      tool: 'https://deckaura.com/pages/rune-reading',
      source: '/pages/rune-reading',
      readingId: snapshot.readingId,
      presentationVariant: 'rune-v2-direct-v1',
      runeFocusId: 'decision',
      runeAnswerId: 'compare',
      runeAnswerKind: 'crossroads',
      runeTimeframeId: 'no_fixed_timeframe',
      runeCanonicalCast: canonicalRuneV2Cast(canonicalCast),
      presentmentAmount: (display.cents / 100).toFixed(2),
      presentmentCurrency: display.currency,
    },
  };
}

function shopifyRuneLine(input) {
  const line = input.line;
  const properties = {
    '_Contract Version': line.contractVersion,
    '_Funnel Version': input.row.funnelVersion,
    '_Source': line.source,
    '_Reading Type': line.readingType,
  };
  return { properties: Object.entries(properties).map(([name, value]) => ({ name, value })) };
}

test('rune-checkout-v2 accepts signed canonical EN and TR snapshots without trusting translated labels', () => {
  for (const language of ['en', 'tr']) {
    const input = runeInput(language);
    const snapshot = validateRuneV2Snapshot({
      page: input.row.page,
      toolType: input.row.readingType,
      presentationVariant: input.snapshot.presentationVariant,
      snapshot: input.snapshot,
    });
    assert.equal(snapshot.ok, true, language);
    assert.equal(verifyRuneV2PaidLine({
      page: input.row.page,
      toolType: input.row.readingType,
      presentationVariant: input.snapshot.presentationVariant,
      snapshot: input.snapshot,
      line: input.line,
    }).ok, true, language);
    const paid = verifySharedToolPaidOrder(input);
    assert.equal(paid.ok, true, language);
    assert.equal(paid.verifiedFields.runeContractVersion, RUNE_V2_CONTRACT_VERSION);
    assert.equal(paid.verifiedFields.runeAnswerKind, 'crossroads');
    assert.match(paid.verifiedFields.signals, /^Anchor: Fehu \(upright\)/);
    assert.doesNotMatch(paid.verifiedFields.signals, /Dayanak|düz|ters/);
  }
});

test('rune-checkout-v2 fails closed on wrong version and translated display tampering', () => {
  const cases = [
    ['wrong version', { contractVersion: 'rune-checkout-v999' }],
    ['translated focus tamper', { readingFocus: 'Aşk ve İlişkiler' }],
    ['translated cast tamper', { runeCast: displays.tr.signals.replace('Fehu', 'Othala') }],
    ['canonical focus tamper', { runeFocusId: 'love' }],
    ['canonical cast tamper', { runeCanonicalCast: canonicalRuneV2Cast(canonicalCast).replace(':Fehu:', ':Othala:') }],
  ];
  for (const [label, override] of cases) {
    const input = runeInput('tr');
    Object.assign(input.line, override);
    assert.deepEqual(
      verifySharedToolPaidOrder(input),
      { ok: false, reason: 'RUNE_CHECKOUT_V2_LINE_MISMATCH' },
      label,
    );
  }
});

test('rune-checkout-v2 fails closed on paid amount, currency and quote-property tampering', () => {
  const cases = [
    ['amount', { presentmentAmount: '999.00' }],
    ['currency', { presentmentCurrency: 'USD' }],
    ['displayed quote', { displayedQuoteCents: '1' }],
    ['signed quote', { signedQuoteCountry: 'US' }],
  ];
  for (const [label, override] of cases) {
    const input = runeInput('tr');
    Object.assign(input.line, override);
    assert.deepEqual(
      verifySharedToolPaidOrder(input),
      { ok: false, reason: 'SHARED_CHECKOUT_QUOTE_MISMATCH' },
      label,
    );
  }
});

test('queue rune gate accepts v2 only with previously verified signed authority while v1 remains separate', () => {
  const input = runeInput('en');
  const paid = verifySharedToolPaidOrder(input);
  assert.equal(paid.ok, true);
  const withoutAuthority = runeCheckoutContractForItems([shopifyRuneLine(input)]);
  assert.equal(withoutAuthority?.ok, false);
  assert.equal(withoutAuthority?.code, 'RUNE_CHECKOUT_V2_SIGNED_AUTHORITY_REQUIRED');
  const withAuthority = runeCheckoutContractForItems([shopifyRuneLine(input)], paid.verifiedFields);
  assert.equal(withAuthority?.ok, true);
  assert.equal(withAuthority?.spread, 'crossroads spread');
  assert.equal(withAuthority?.cast.length, 5);
});

test('intent route validates and explicitly persists the canonical rune v2 snapshot before insert', async () => {
  const route = await readFile(new URL('app/api/readings/intent/route.ts', root), 'utf8');
  const validation = route.indexOf('const runeV2Validation = validateRuneV2Snapshot(');
  const persistence = route.indexOf('...(runeV2CanonicalSnapshot || {})');
  const insert = route.indexOf('insert into deckaura.checkout_intents');
  assert.ok(validation >= 0 && persistence > validation && insert > persistence);
  assert.match(route, /RUNE_CHECKOUT_V2_SNAPSHOT_INVALID/);
});
