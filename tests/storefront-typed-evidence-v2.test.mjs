import assert from 'node:assert/strict';
import test from 'node:test';

import { Body, Ecliptic, Equator, GeoVector, Observer, SiderealTime } from 'astronomy-engine';

import {
  STOREFRONT_TYPED_EVIDENCE_CONTRACTS,
  validateNewSharedToolSnapshot,
} from '../lib/new-shared-tool-evidence.mjs';

// The 2026-08-30 storefront rebuild ships Mars v1 (date-only + exact with IANA
// zone), Mercury v2 (exact / ±30 minute / date-only ranges) and Astrocartography
// v2 (six strongest contacts across ten bodies). These tests pin the backend to
// the browser payloads captured on 2026-09-03 and to independent recomputations
// of the theme formulas, and prove tampered evidence is still rejected.

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const HOUR = 3_600_000;

const MARS = {
  page: '/pages/mars-sign-calculator',
  type: 'Mars Sign Astrology',
  exactScope: 'Tropical geocentric Mars sign, degree and apparent motion only; no houses, aspects or complete natal chart.',
  exactConfidence: 'Astronomy Engine ephemeris; historical IANA time zone and exact local birth time supplied.',
  dateScope: 'Tropical Mars sign and date-based midpoint degree estimate; no houses, aspects or exact birth-time claims.',
  dateConfidence: 'Astronomy Engine ephemeris; one Mars sign verified across the full possible UTC window for the local birth date.',
};
const MERCURY = {
  page: '/pages/mercury-sign-calculator',
  type: 'Mercury Sign Astrology',
  exactScope: 'Tropical geocentric Mercury placement and motion from the exact UTC moment.',
  exactConfidence: 'Astronomy Engine ephemeris; exact UTC birth moment.',
  rangeScope: 'Tropical geocentric Mercury sign and bounded degree range only; no exact-degree claim.',
  rangeConfidence: 'Astronomy Engine ephemeris; Mercury sign stable across the full verified time range.',
};
const ASTRO = {
  page: '/pages/astrocartography-calculator',
  type: 'Astrocartography',
  scope: 'Interpret this single-city angular proximity scan as reflective relocation guidance. Do not guarantee events or replace visa, safety, work, healthcare, housing or financial research.',
  exactConfidence: 'Astronomy Engine positions with resolved historical time zone and exact supplied birth time.',
  approximateConfidence: 'Approximate birth time; direction-level location reflection only.',
};

function norm(value) {
  const result = value % 360;
  return result < 0 ? result + 360 : result;
}
function diff180(value) {
  const result = norm(value);
  return result > 180 ? result - 360 : result;
}
function lon(body, date) {
  return norm(Ecliptic(GeoVector(Body[body], date, true)).elon);
}
function signIndex(value) {
  return Math.floor(norm(value) / 30) % 12;
}
function signDegree(value) {
  return norm(value) % 30;
}
function placement(value) {
  return `${signDegree(value).toFixed(2)}° ${SIGNS[signIndex(value)]}`;
}
function motion(body, date) {
  const before = lon(body, new Date(date.getTime() - 6 * HOUR));
  const after = lon(body, new Date(date.getTime() + 6 * HOUR));
  return diff180(after - before) < 0 ? 'Retrograde' : 'Direct';
}
function pad(value) {
  return String(value).padStart(2, '0');
}
// Theme rangeLabel / degreeParts (mercury-enterprise-v2.js), reimplemented independently.
function degreeParts(value) {
  let index = signIndex(value);
  const within = signDegree(value);
  let degree = Math.floor(within);
  let minute = Math.round((within - degree) * 60);
  if (minute === 60) { minute = 0; degree += 1; }
  if (degree === 30) { degree = 0; index = (index + 1) % 12; }
  return { index, label: `${degree}°${pad(minute)}′` };
}
function rangeLabel(start, end) {
  let first = degreeParts(start);
  let last = degreeParts(end);
  if (first.index === last.index) {
    if (signDegree(start) > signDegree(end)) { const swap = first; first = last; last = swap; }
    return `${first.label}–${last.label} ${SIGNS[first.index]}`;
  }
  return `${first.label} ${SIGNS[first.index]} – ${last.label} ${SIGNS[last.index]}`;
}
function scan(body, start, end, step) {
  const samples = [];
  let cursor = start;
  while (cursor <= end) { samples.push(lon(body, new Date(cursor))); cursor += step; }
  if (cursor - step !== end) samples.push(lon(body, new Date(end)));
  return samples;
}

function runtimeContext(context, scope, confidence) {
  return `${context} Reading scope: ${scope}. Calculation confidence: ${confidence}.`;
}

function validate(tool, snapshot) {
  const scope = snapshot.scope;
  const confidence = snapshot.confidence;
  return validateNewSharedToolSnapshot({
    page: tool.page,
    toolType: tool.type,
    snapshot: {
      type: tool.type,
      context: runtimeContext(snapshot.context, scope, confidence),
      signals: `Result signals: ${snapshot.signals}.`,
      scope,
      confidence,
    },
  });
}

test('storefront contract list is exported for the funnel-version probe', () => {
  assert.deepEqual([...STOREFRONT_TYPED_EVIDENCE_CONTRACTS], ['mars-v1', 'mercury-v2', 'astrocartography-v2']);
});

test('Mars v1 date-only browser payload (captured 2026-09-03) passes and tampering fails', () => {
  const captured = {
    context: 'Date-only sign verification — birth=1990-05-15; Mars sign remained Pisces across the complete global UTC window for this local date; midpoint degree is an estimate.',
    signals: 'Mars placement: Approx. 18.33° Pisces; Mars motion: Direct; Calculation precision: Date-only sign verified',
    scope: MARS.dateScope,
    confidence: MARS.dateConfidence,
  };
  assert.deepEqual(validate(MARS, captured), { applies: true, ok: true, reason: '' });
  // independent recomputation of the noon-UTC midpoint used by the theme
  const center = new Date(Date.UTC(1990, 4, 15, 12));
  assert.equal(`Approx. ${placement(lon('Mars', center))}`, 'Approx. 18.33° Pisces');
  assert.equal(motion('Mars', center), 'Direct');

  assert.equal(validate(MARS, { ...captured, signals: captured.signals.replace('18.33', '18.34') }).ok, false);
  assert.equal(validate(MARS, { ...captured, signals: captured.signals.replace('Approx. ', '') }).ok, false);
  assert.equal(validate(MARS, { ...captured, context: captured.context.replace('Pisces', 'Aries') }).ok, false);
  assert.equal(validate(MARS, { ...captured, signals: captured.signals.replace('Date-only sign verified', 'Exact birth moment') }).ok, false);
  assert.equal(validate(MARS, { ...captured, scope: 'Tropical geocentric Mars placement and motion only.' }).ok, false);
  assert.equal(validate(MARS, { ...captured, confidence: MARS.exactConfidence }).ok, false);
});

test('Mars v1 exact payload carries the IANA zone and recomputes the placement', () => {
  const date = new Date(Date.UTC(1990, 4, 15, 14, 30) - 3 * HOUR);
  const snapshot = {
    context: 'Canonical inputs — birth=1990-05-15; localTime=14:30; timeZone=Europe/Istanbul; utcOffset=+3.',
    signals: `Mars placement: ${placement(lon('Mars', date))}; Mars motion: ${motion('Mars', date)}; Calculation precision: Exact birth moment`,
    scope: MARS.exactScope,
    confidence: MARS.exactConfidence,
  };
  assert.deepEqual(validate(MARS, snapshot), { applies: true, ok: true, reason: '' });
  assert.equal(validate(MARS, { ...snapshot, context: snapshot.context.replace('14:30', '02:30') }).ok, false);
  assert.equal(validate(MARS, { ...snapshot, context: snapshot.context.replace('utcOffset=+3', 'utcOffset=+3.3') }).ok, false);
  assert.equal(validate(MARS, { ...snapshot, signals: `${snapshot.signals}; UTC birth moment: 1990-05-15T11:30Z` }).ok, false);
});

test('Mercury v2 date-only browser payload (captured 2026-09-03) passes and the range is recomputed', () => {
  const captured = {
    context: 'Verified date-only inputs — birth=1990-05-15; every possible UTC moment for this calendar date checked; Mercury sign stable=Taurus; degree remains a range.',
    signals: 'Mercury placement: 7°56′–8°11′ Taurus; Mercury motion: Retrograde; Time evidence: Birth date only · all UTC offsets checked',
    scope: MERCURY.rangeScope,
    confidence: MERCURY.rangeConfidence,
  };
  assert.deepEqual(validate(MERCURY, captured), { applies: true, ok: true, reason: '' });
  const base = Date.UTC(1990, 4, 15);
  const samples = scan('Mercury', base - 14 * HOUR, base + 36 * HOUR, HOUR);
  assert.equal(rangeLabel(samples[0], samples[samples.length - 1]), '7°56′–8°11′ Taurus');
  assert.equal(motion('Mercury', new Date(Math.round((base - 14 * HOUR + base + 36 * HOUR) / 2))), 'Retrograde');

  assert.equal(validate(MERCURY, { ...captured, signals: captured.signals.replace('8°11′', '8°12′') }).ok, false);
  assert.equal(validate(MERCURY, { ...captured, signals: captured.signals.replace('Retrograde', 'Direct') }).ok, false);
  assert.equal(validate(MERCURY, { ...captured, context: captured.context.replace('Taurus', 'Gemini') }).ok, false);
  assert.equal(validate(MERCURY, { ...captured, scope: MERCURY.exactScope }).ok, false);
});

test('Mercury v2 approximate and exact modes recompute the theme window', () => {
  const center = Date.UTC(1990, 4, 15, 14, 30) - 3 * HOUR;
  const samples = scan('Mercury', center - 30 * 60_000, center + 30 * 60_000, 5 * 60_000);
  const approximate = {
    context: 'Verified approximate inputs — birth=1990-05-15; localTime=14:30 ±30m; utcOffset=+3; Mercury sign stable=Taurus.',
    signals: `Mercury placement: ${rangeLabel(samples[0], samples[samples.length - 1])}; Mercury motion: ${motion('Mercury', new Date(center))}; Time evidence: Approximate local time 14:30 · verified ±30 minutes`,
    scope: MERCURY.rangeScope,
    confidence: MERCURY.rangeConfidence,
  };
  assert.deepEqual(validate(MERCURY, approximate), { applies: true, ok: true, reason: '' });
  assert.equal(validate(MERCURY, { ...approximate, context: approximate.context.replace('14:30', '09:30') }).ok, false);

  const exact = {
    context: 'Canonical inputs — birth=1990-05-15; localTime=14:30; utcOffset=+3.',
    signals: `Mercury placement: ${placement(lon('Mercury', new Date(center)))}; Mercury motion: ${motion('Mercury', new Date(center))}; Time evidence: Exact local time 14:30`,
    scope: MERCURY.exactScope,
    confidence: MERCURY.exactConfidence,
  };
  assert.deepEqual(validate(MERCURY, exact), { applies: true, ok: true, reason: '' });
  assert.equal(validate(MERCURY, { ...exact, signals: exact.signals.replace('Exact local time 14:30', 'Exact local time 14:31') }).ok, false);
  assert.equal(validate(MERCURY, { ...exact, scope: MERCURY.rangeScope }).ok, false);
});

function astroContacts(date, latitude, longitude) {
  const observer = new Observer(latitude, longitude, 0);
  const lst = norm(SiderealTime(date) * 15 + longitude);
  return ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'].map((key) => {
    const eq = Equator(Body[key], date, observer, true, true);
    const hourAngle = diff180(lst - eq.ra * 15);
    const dec = eq.dec * Math.PI / 180;
    const phi = latitude * Math.PI / 180;
    const ha = hourAngle * Math.PI / 180;
    const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha)) * 180 / Math.PI;
    const candidates = [
      { angle: 'MC', distance: Math.abs(hourAngle) },
      { angle: 'IC', distance: Math.abs(180 - Math.abs(hourAngle)) },
      { angle: hourAngle < 0 ? 'ASC' : 'DSC', distance: Math.abs(altitude) },
    ].sort((a, b) => a.distance - b.distance);
    return { planet: key, angle: candidates[0].angle, distance: candidates[0].distance };
  }).sort((a, b) => a.distance - b.distance);
}
function band(distance) {
  return distance <= 5 ? 'Active contact' : distance <= 10 ? 'Nearby contact' : 'Low activation';
}

test('Astrocartography v2 six-contact payload with city coordinates passes and forgeries fail', () => {
  const utc = new Date(Date.UTC(1990, 4, 15, 11, 30));
  const latitude = 38.7223;
  const longitude = -9.1393;
  const contacts = astroContacts(utc, latitude, longitude);
  const signals = contacts.slice(0, 6).map((contact, index) => ({
    label: `${index + 1}. ${contact.planet} near ${contact.angle}`,
    value: `${contact.distance.toFixed(2)}° · ${band(contact.distance)}`,
  }));
  signals.push({ label: 'Target city', value: 'Lisbon, Lisboa, Portugal' });
  signals.push({ label: 'Location goal', value: 'Career & Visibility' });
  signals.push({ label: 'How the city is being considered', value: 'Moving there' });
  signals.push({ label: 'Birth moment UTC', value: utc.toISOString() });
  signals.push({ label: 'City coordinates', value: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` });
  const snapshot = {
    context: signals.map((signal) => `${signal.label}: ${signal.value}`).join(' | '),
    signals: signals.map((signal) => `${signal.label}: ${signal.value}`).join('; '),
    scope: ASTRO.scope,
    confidence: ASTRO.exactConfidence,
  };
  assert.deepEqual(validate(ASTRO, snapshot), { applies: true, ok: true, reason: '' });
  assert.deepEqual(validate(ASTRO, { ...snapshot, confidence: ASTRO.approximateConfidence }), { applies: true, ok: true, reason: '' });

  const first = signals[0];
  const tampered = snapshot.signals.replace(first.value, `${(Number(first.value.slice(0, first.value.indexOf('°'))) + 0.5).toFixed(2)}° · ${band(0)}`);
  assert.equal(validate(ASTRO, { ...snapshot, signals: tampered }).ok, false);
  assert.equal(validate(ASTRO, { ...snapshot, signals: snapshot.signals.replace('; City coordinates', '; Old coordinates') }).ok, false);
  assert.equal(validate(ASTRO, { ...snapshot, signals: snapshot.signals.replace(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, '41.0082, 28.9784') }).ok, false);
  assert.equal(validate(ASTRO, { ...snapshot, signals: snapshot.signals.replace('Moving there', 'Fleeing there') }).ok, false);
  assert.equal(validate(ASTRO, { ...snapshot, signals: `${snapshot.signals}; Extra signal: forged` }).ok, false);
  assert.equal(validate(ASTRO, { ...snapshot, scope: 'Single-city angular proximity scan; no global map, parans or local-space lines.' }).ok, false);
  assert.equal(validate(ASTRO, { ...snapshot, context: snapshot.context.replace('Birth moment UTC: 1990', 'Birth moment UTC: 1991') }).ok, false);
});

test('legacy exact-moment Mars and Astrocartography contracts still validate after the refactor', () => {
  const date = new Date(Date.UTC(1990, 0, 15, 10));
  assert.deepEqual(validateNewSharedToolSnapshot({
    page: MARS.page,
    toolType: MARS.type,
    snapshot: {
      type: MARS.type,
      context: 'Canonical inputs — birth=1990-01-15; localTime=12:00; utcOffset=+2.',
      signals: `Mars placement: ${placement(lon('Mars', date))}; Mars motion: ${motion('Mars', date)}; UTC birth moment: 1990-01-15T10:00Z`,
      scope: 'Tropical geocentric Mars placement and motion only.',
      confidence: 'Astronomy Engine ephemeris; exact UTC birth moment.',
    },
  }), { applies: true, ok: true, reason: '' });
  assert.deepEqual(validateNewSharedToolSnapshot({
    page: ASTRO.page,
    toolType: ASTRO.type,
    snapshot: {
      type: ASTRO.type,
      context: 'Canonical inputs — birth=1990-01-15; localTime=12:00; utcOffset=+2; latitude=+41.0082; longitude=+28.9784.',
      signals: 'City coordinates: +41.0082, +28.9784; Birth UTC: 1990-01-15T10:00Z; Closest angle: Sun near MC · 3.36°; Second angle: Saturn near MC · 4.86°',
      scope: 'Single-city angular proximity scan; no global map, parans or local-space lines.',
      confidence: 'Astronomy-derived equatorial positions; exact supplied coordinates and birth moment.',
    },
  }), { applies: true, ok: true, reason: '' });
});
