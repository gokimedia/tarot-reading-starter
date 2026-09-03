import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MOON_PHASE_LABEL_BOUNDARY_DRIFT_DEGREES,
  MOON_LUNAR_QUOTE_MISMATCH,
  buildMoonLunarSnapshot,
  safeMoonLunarSnapshot,
  validateMoonLunarPaidQuote,
} from '../lib/moon-lunar.ts';

const CAPTURED_AT = '2026-08-12T04:55:09.372Z';
const QUESTION = 'What pattern should I reflect on before making this harmless test decision?';
const LIVE_MOON_PHASE_FIXTURE = Object.freeze({
  version: 'moon-lunar-snapshot-v1',
  capturedAt: CAPTURED_AT,
  focus: 'love_relationships',
  situation: QUESTION,
  packageTier: 'premium',
  current: Object.freeze({
    dateKey: '2026-08-12',
    phase: 'New Moon',
    phaseAngle: 353.49892425194616,
    illumination: 0.3215134963990951,
    age: 28.79891334986314,
    moonLongitude: 132.35927029133862,
    moonSign: 'Leo',
    nextPhase: Object.freeze({ name: 'New Moon', at: '2026-08-12T17:37:49.472Z' }),
  }),
  card: Object.freeze({ id: 7, name: 'The Lovers' }),
  birth: Object.freeze({
    date: '1990-01-01',
    time: '',
    status: 'unknown',
    place: 'Synthetic Test City, United States',
    timezone: 'Europe/Istanbul',
  }),
});

function fixture(mutate = () => {}) {
  const value = structuredClone(LIVE_MOON_PHASE_FIXTURE);
  mutate(value);
  return value;
}

function build(value) {
  return buildMoonLunarSnapshot({
    value,
    focus: value.focus,
    question: value.situation,
    tier: 'premium',
    now: new Date(CAPTURED_AT),
  });
}

test('accepts the live Moon Phase boundary fixture and remains post-purchase self-verifying', () => {
  const snapshot = build(fixture());
  assert.ok(snapshot);
  assert.equal(snapshot.current.phase, 'New Moon');
  assert.equal(snapshot.current.phaseAngle, 353.4989);
  assert.equal(snapshot.current.illumination, 0.41);
  assert.equal(snapshot.current.moonLongitude, 132.3675);
  assert.equal(snapshot.current.nextPhase.name, 'New Moon');
  assert.equal(snapshot.card.name, 'The Lovers');
  assert.equal(snapshot.card.position, 'The seed asking to be planted');
  assert.deepEqual(
    safeMoonLunarSnapshot(snapshot),
    snapshot,
    'the signed canonical snapshot must remain valid during post-purchase verification',
  );
});

test('rejects unrelated or fabricated phase labels even when the numeric payload is otherwise live', () => {
  assert.equal(build(fixture((value) => { value.current.phase = 'Full Moon'; })), null);
  assert.equal(build(fixture((value) => {
    value.current.phase = 'New Moon';
    value.current.phaseAngle = 353;
  })), null, 'a label must not cross the boundary unless its own submitted angle does');
});

test('bounds adjacent phase-label drift and preserves independent astronomical tamper checks', () => {
  assert.equal(MOON_PHASE_LABEL_BOUNDARY_DRIFT_DEGREES, 1.5);
  assert.equal(build(fixture((value) => {
    value.current.phaseAngle = 354.5;
  })), null, 'an adjacent label more than 1.5 degrees from the server angle must fail');
  assert.equal(build(fixture((value) => {
    value.current.moonLongitude += 2.01;
  })), null, 'longitude validation remains fail-closed');
  assert.equal(build(fixture((value) => {
    value.current.phaseAngle += 15.01;
  })), null, 'the existing phase-angle envelope remains fail-closed');
});

test('Moon paid quote binds the signed intent and locale to Shopify presentment money', () => {
  const intentId = '12345678-1234-4234-9234-123456789abc';
  const variantId = '53782500147473';
  const sku = 'READING-PREMIUM';
  const snapshot = {
    ...build(fixture()),
    localeContext: { locale: 'de-DE', language: 'de', country: 'DE', currency: 'EUR', market: 'de' },
    checkoutQuote: { intentId, variantId, sku, priceCents: 1549, currency: 'EUR', country: 'DE' },
  };
  const input = {
    snapshot,
    row: { id: intentId, variantId, sku },
    line: { presentmentAmount: '15.49', presentmentCurrency: 'EUR' },
  };
  const valid = validateMoonLunarPaidQuote(input);
  assert.equal(valid.ok, true, valid.reason);
  assert.deepEqual(valid.quote, { intentId, variantId, sku, priceCents: 1549, currency: 'EUR', country: 'DE' });

  for (const [label, mutate] of [
    ['missing quote', (value) => { delete value.snapshot.checkoutQuote; }],
    ['intent id', (value) => { value.snapshot.checkoutQuote.intentId = '22345678-1234-4234-9234-123456789abc'; }],
    ['variant id', (value) => { value.snapshot.checkoutQuote.variantId = '53782500114705'; }],
    ['sku', (value) => { value.snapshot.checkoutQuote.sku = 'READING-MEDIUM'; }],
    ['price cents', (value) => { value.snapshot.checkoutQuote.priceCents = 1550; }],
    ['quote currency', (value) => { value.snapshot.checkoutQuote.currency = 'USD'; }],
    ['quote country', (value) => { value.snapshot.checkoutQuote.country = 'US'; }],
    ['signed locale currency', (value) => { value.snapshot.localeContext.currency = 'USD'; }],
    ['signed locale country', (value) => { value.snapshot.localeContext.country = 'US'; }],
    ['line amount', (value) => { value.line.presentmentAmount = '15.50'; }],
    ['line currency', (value) => { value.line.presentmentCurrency = 'USD'; }],
  ]) {
    const changed = structuredClone(input);
    mutate(changed);
    const result = validateMoonLunarPaidQuote(changed);
    assert.deepEqual(result, { ok: false, reason: MOON_LUNAR_QUOTE_MISMATCH }, label);
  }
});

test('Moon delivery copy keeps intended separators instead of mojibake', async () => {
  const source = await readFile(new URL('../lib/reading-queue-processor.ts', import.meta.url), 'utf8');
  const start = source.indexOf("if (intentKind === 'moon_lunar')");
  const end = source.indexOf("if (intentKind === 'shared_tool')", start);
  assert.ok(start >= 0 && end > start);
  const moonBlock = source.slice(start, end);
  assert.doesNotMatch(moonBlock, /Â·|â†”/);
  assert.match(moonBlock, /validateMoonLunarPaidQuote\(/);
  assert.match(moonBlock, /if \(!quoteValidation\.ok\) throw new QueueOperationError\(quoteValidation\.reason\)/);
  assert.match(moonBlock, /verified current Moon and natal Moon calculation/);
  assert.match(moonBlock, /current Moon ↔ natal Moon ↔ lunar card ↔ exact question/);
});
