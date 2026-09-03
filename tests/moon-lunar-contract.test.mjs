import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { isSupportedCheckoutFunnelVersion } from '../lib/reading-products.ts';

import {
  MOON_PHASE_LABEL_BOUNDARY_DRIFT_DEGREES,
  MOON_LUNAR_FUNNEL_VERSION,
  MOON_LUNAR_LEGACY_FUNNEL_VERSIONS,
  MOON_LUNAR_LEGACY_REVIEW_REQUIRED,
  MOON_LUNAR_LOCAL_TIME_AMBIGUOUS,
  MOON_LUNAR_LOCAL_TIME_NONEXISTENT,
  MOON_LUNAR_QUOTE_MISMATCH,
  MOON_LUNAR_SNAPSHOT_VERSION,
  MOON_LUNAR_TIMEZONE_CONFIRMATION_VERSION,
  MOON_LUNAR_TIMEZONE_MISMATCH,
  buildMoonLunarSnapshot,
  isLegacyMoonLunarFunnelVersion,
  isSupportedMoonLunarFunnelVersion,
  moonLunarBirthTimeIssue,
  moonLunarEvidence,
  moonLunarTimezoneConfirmation,
  resolveMoonLunarLocalDateTime,
  safeMoonLunarSnapshot,
  validateMoonLunarPaidQuote,
  validateMoonLunarPaidTimezone,
} from '../lib/moon-lunar.ts';

const CAPTURED_AT = '2026-08-12T04:55:09.372Z';
const QUESTION = 'What pattern should I reflect on before making this harmless test decision?';
const LIVE_MOON_PHASE_FIXTURE = Object.freeze({
  version: MOON_LUNAR_SNAPSHOT_VERSION,
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
  timezoneConfirmation: Object.freeze({
    version: 'moon-timezone-confirmation-v1',
    confirmed: true,
    timezone: 'Europe/Istanbul',
    birthPlace: 'Synthetic Test City, United States',
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

function replaceBirth(value, { date, time, status, place, timezone }) {
  value.birth = { date, time, status, place, timezone };
  value.timezoneConfirmation = {
    version: MOON_LUNAR_TIMEZONE_CONFIRMATION_VERSION,
    confirmed: true,
    timezone,
    birthPlace: place,
  };
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

test('Moon v2 is canonical while the v1 funnel remains recognizable without making v1 snapshots valid', () => {
  assert.equal(MOON_LUNAR_FUNNEL_VERSION, 'moon-lunar-intent-checkout-2026-09-v2');
  assert.equal(MOON_LUNAR_SNAPSHOT_VERSION, 'moon-lunar-snapshot-v2');
  assert.equal(MOON_LUNAR_LEGACY_REVIEW_REQUIRED, 'CHECKOUT_INTENT_MOON_LUNAR_LEGACY_CONFIRMATION_REQUIRED');
  assert.deepEqual([...MOON_LUNAR_LEGACY_FUNNEL_VERSIONS], ['moon-lunar-intent-checkout-2026-08-v1']);
  assert.equal(isSupportedMoonLunarFunnelVersion(MOON_LUNAR_FUNNEL_VERSION), true);
  assert.equal(isSupportedMoonLunarFunnelVersion(MOON_LUNAR_LEGACY_FUNNEL_VERSIONS[0]), true);
  assert.equal(isLegacyMoonLunarFunnelVersion(MOON_LUNAR_FUNNEL_VERSION), false);
  assert.equal(isLegacyMoonLunarFunnelVersion(MOON_LUNAR_LEGACY_FUNNEL_VERSIONS[0]), true);
  assert.equal(isSupportedMoonLunarFunnelVersion('moon-lunar-intent-checkout-2026-07-v0'), false);
  assert.equal(isSupportedCheckoutFunnelVersion(MOON_LUNAR_FUNNEL_VERSION), true);
  assert.equal(isSupportedCheckoutFunnelVersion(MOON_LUNAR_LEGACY_FUNNEL_VERSIONS[0]), true);
  assert.equal(build(fixture((value) => { value.version = 'moon-lunar-snapshot-v1'; })), null);
});

test('requires an explicit versioned confirmation bound to the canonical birth place and timezone', () => {
  assert.equal(MOON_LUNAR_TIMEZONE_CONFIRMATION_VERSION, 'moon-timezone-confirmation-v1');
  assert.deepEqual(moonLunarTimezoneConfirmation(fixture()), LIVE_MOON_PHASE_FIXTURE.timezoneConfirmation);
  for (const [label, mutate] of [
    ['missing confirmation', (value) => { delete value.timezoneConfirmation; }],
    ['unconfirmed', (value) => { value.timezoneConfirmation.confirmed = false; }],
    ['wrong version', (value) => { value.timezoneConfirmation.version = 'moon-timezone-confirmation-v0'; }],
    ['timezone mismatch', (value) => { value.timezoneConfirmation.timezone = 'America/New_York'; }],
    ['unknown IANA timezone', (value) => {
      value.birth.timezone = 'Mars/Olympus';
      value.timezoneConfirmation.timezone = 'Mars/Olympus';
    }],
    ['birth place mismatch', (value) => { value.timezoneConfirmation.birthPlace = 'New York, United States'; }],
    ['noncanonical confirmation whitespace', (value) => { value.timezoneConfirmation.birthPlace += ' '; }],
  ]) {
    const value = fixture(mutate);
    assert.equal(moonLunarTimezoneConfirmation(value), null, label);
    assert.equal(build(value), null, label);
  }
});

test('resolves IANA local times by exact round trip, including DST gaps and folds', () => {
  assert.deepEqual(resolveMoonLunarLocalDateTime('2024-11-03', '03:00', 'America/New_York'), {
    status: 'unique',
    candidates: ['2024-11-03T08:00:00.000Z'],
  });
  assert.deepEqual(resolveMoonLunarLocalDateTime('2024-03-10', '02:30', 'America/New_York'), {
    status: 'nonexistent',
    candidates: [],
  });
  assert.deepEqual(resolveMoonLunarLocalDateTime('2024-11-03', '01:10', 'America/New_York'), {
    status: 'ambiguous',
    candidates: ['2024-11-03T05:10:00.000Z', '2024-11-03T06:10:00.000Z'],
  });
  assert.equal(resolveMoonLunarLocalDateTime('2024-03-31', '02:30', 'Europe/Berlin')?.status, 'nonexistent');
  assert.equal(resolveMoonLunarLocalDateTime('2024-10-27', '02:30', 'Europe/Berlin')?.status, 'ambiguous');
  assert.equal(resolveMoonLunarLocalDateTime('2024-10-06', '02:15', 'Australia/Lord_Howe')?.status, 'nonexistent');
  assert.deepEqual(resolveMoonLunarLocalDateTime('2024-04-07', '01:45', 'Australia/Lord_Howe'), {
    status: 'ambiguous',
    candidates: ['2024-04-06T14:45:00.000Z', '2024-04-06T15:15:00.000Z'],
  });
  assert.equal(resolveMoonLunarLocalDateTime('2011-12-30', '12:00', 'Pacific/Apia')?.status, 'nonexistent');
});

test('fails closed for nonexistent or repeated birth times and skipped civil dates', () => {
  for (const [label, birth, expected] of [
    ['New York gap', {
      date: '2024-03-10', time: '02:30', status: 'exact', place: 'New York, United States', timezone: 'America/New_York',
    }, MOON_LUNAR_LOCAL_TIME_NONEXISTENT],
    ['New York fold', {
      date: '2024-11-03', time: '01:10', status: 'exact', place: 'New York, United States', timezone: 'America/New_York',
    }, MOON_LUNAR_LOCAL_TIME_AMBIGUOUS],
    ['New York approximate fold', {
      date: '2024-11-03', time: '01:10', status: 'approximate', place: 'New York, United States', timezone: 'America/New_York',
    }, MOON_LUNAR_LOCAL_TIME_AMBIGUOUS],
    ['Apia skipped date', {
      date: '2011-12-30', time: '', status: 'unknown', place: 'Apia, Samoa', timezone: 'Pacific/Apia',
    }, MOON_LUNAR_LOCAL_TIME_NONEXISTENT],
  ]) {
    const value = fixture();
    replaceBirth(value, birth);
    assert.equal(moonLunarBirthTimeIssue(value), expected, label);
    assert.equal(build(value), null, label);
  }
});

test('preserves honest whole-day natal ranges for approximate and unknown birth times', () => {
  const approximate = fixture();
  replaceBirth(approximate, {
    date: '2024-01-03',
    time: '00:47',
    status: 'approximate',
    place: 'Reykjavik, Iceland',
    timezone: 'UTC',
  });
  const approximateSnapshot = build(approximate);
  assert.ok(approximateSnapshot);
  assert.equal(approximateSnapshot.natalMoon.ambiguous, true);
  assert.deepEqual(approximateSnapshot.natalMoon.possibleSigns, ['Virgo', 'Libra']);
  assert.match(approximateSnapshot.natalMoon.confidence, /instead of asserting one sign or degree/);
  assert.deepEqual(safeMoonLunarSnapshot(approximateSnapshot), approximateSnapshot);

  const unknown = fixture();
  replaceBirth(unknown, {
    date: '2024-11-03',
    time: '',
    status: 'unknown',
    place: 'New York, United States',
    timezone: 'America/New_York',
  });
  const unknownSnapshot = build(unknown);
  assert.ok(unknownSnapshot);
  assert.equal(unknownSnapshot.natalMoon.ambiguous, true);
  assert.deepEqual(unknownSnapshot.natalMoon.possibleSigns, ['Scorpio', 'Sagittarius']);
  assert.deepEqual(safeMoonLunarSnapshot(unknownSnapshot), unknownSnapshot);

  const exact = fixture();
  replaceBirth(exact, {
    date: '2024-11-03',
    time: '03:00',
    status: 'exact',
    place: 'New York, United States',
    timezone: 'America/New_York',
  });
  const exactSnapshot = build(exact);
  assert.ok(exactSnapshot);
  assert.equal(exactSnapshot.natalMoon.ambiguous, false);
  assert.deepEqual(exactSnapshot.natalMoon.possibleSigns, [exactSnapshot.natalMoon.sign]);
  assert.equal(exactSnapshot.natalMoon.startLongitude, exactSnapshot.natalMoon.longitude);
  assert.equal(exactSnapshot.natalMoon.endLongitude, exactSnapshot.natalMoon.longitude);

  for (const status of ['approximate', 'unknown']) {
    const saoPaulo = fixture();
    replaceBirth(saoPaulo, {
      date: '2018-11-04',
      time: status === 'unknown' ? '' : '12:00',
      status,
      place: 'Sao Paulo, Brazil',
      timezone: 'America/Sao_Paulo',
    });
    assert.equal(moonLunarBirthTimeIssue(saoPaulo), '', status);
    const saoPauloSnapshot = build(saoPaulo);
    assert.ok(saoPauloSnapshot, `${status} must use the first real minute instead of rejecting a midnight gap`);
    assert.deepEqual(safeMoonLunarSnapshot(saoPauloSnapshot), saoPauloSnapshot);
  }
});

test('Moon paid timezone guard binds all three cart properties to the signed confirmation', () => {
  const snapshot = build(fixture());
  assert.ok(snapshot);
  const input = {
    snapshot,
    line: {
      birthPlace: 'Synthetic Test City, United States',
      birthTimezone: 'Europe/Istanbul',
      confirmationVersion: MOON_LUNAR_TIMEZONE_CONFIRMATION_VERSION,
    },
  };
  const valid = validateMoonLunarPaidTimezone(input);
  assert.equal(valid.ok, true, valid.reason);
  assert.deepEqual(valid.confirmation, LIVE_MOON_PHASE_FIXTURE.timezoneConfirmation);
  for (const [label, mutate] of [
    ['missing birth place', (value) => { value.line.birthPlace = ''; }],
    ['birth place mismatch', (value) => { value.line.birthPlace = 'New York, United States'; }],
    ['birth place whitespace drift', (value) => { value.line.birthPlace = 'Synthetic  Test City, United States'; }],
    ['timezone mismatch', (value) => { value.line.birthTimezone = 'America/New_York'; }],
    ['version mismatch', (value) => { value.line.confirmationVersion = 'moon-timezone-confirmation-v0'; }],
    ['signed confirmation removed', (value) => { delete value.snapshot.timezoneConfirmation; }],
  ]) {
    const changed = structuredClone(input);
    mutate(changed);
    assert.deepEqual(
      validateMoonLunarPaidTimezone(changed),
      { ok: false, reason: MOON_LUNAR_TIMEZONE_MISMATCH },
      label,
    );
  }
});

test('Moon model evidence keeps the verified timezone but excludes free-form birthplace text', () => {
  const snapshot = build(fixture());
  assert.ok(snapshot);
  const evidence = moonLunarEvidence(snapshot);
  assert.match(evidence, /Birthplace timezone: Europe\/Istanbul/);
  assert.doesNotMatch(evidence, /Synthetic Test City/);
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
  assert.match(moonBlock, /validateMoonLunarPaidTimezone\(/);
  assert.match(moonBlock, /if \(!timezoneValidation\.ok\) throw new QueueOperationError\(timezoneValidation\.reason\)/);
  assert.match(moonBlock, /verified current Moon and natal Moon calculation/);
  assert.match(moonBlock, /current Moon ↔ natal Moon ↔ lunar card ↔ exact question/);
  assert.match(source, /throw new QueueOperationError\(MOON_LUNAR_LEGACY_REVIEW_REQUIRED\)/);
  assert.match(source, /claimsLegacyMoonLunarConfirmationReview\(/);
  assert.match(source, /moon_lunar_legacy_manual_review_required/);
  assert.match(source, /reading_input_confirmation_required/);
  const universalIntentGuard = source.indexOf("throw new QueueOperationError('CHECKOUT_INTENT_READING_MISMATCH')");
  const signatureGuard = source.indexOf("throw new QueueOperationError('CHECKOUT_INTENT_SIGNATURE_INVALID')");
  const expiryGuard = source.indexOf("throw new QueueOperationError('CHECKOUT_INTENT_EXPIRED')");
  const legacyHold = source.indexOf('throw new QueueOperationError(MOON_LUNAR_LEGACY_REVIEW_REQUIRED)');
  const replayClaim = source.indexOf('const legacyMoonLunarReviewClaimed');
  const replayCall = source.indexOf('await replayShopifyWebhook', replayClaim);
  assert.ok(universalIntentGuard >= 0 && legacyHold > universalIntentGuard,
    'legacy hold must follow the signed universal intent/property guards');
  assert.ok(signatureGuard >= 0 && expiryGuard > signatureGuard,
    'an expired checkout must not be classified before its signature is authenticated');
  assert.match(source, /if \(intentExpired && !legacyMoonLunarIntent\)/,
    'authentic legacy Moon carts remain on manual hold even after their intent TTL');
  assert.ok(replayClaim >= 0 && replayCall > replayClaim,
    'the legacy Moon claim must be checked before any legacy replay call');
});
