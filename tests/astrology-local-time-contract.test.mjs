import assert from 'node:assert/strict';
import test from 'node:test';
import { EclipticGeoMoon, SiderealTime, SunPosition } from 'astronomy-engine';

import {
  BIG_THREE_LOCAL_TIME_AMBIGUOUS,
  BIG_THREE_LOCAL_TIME_NONEXISTENT,
  bigThreeBirthTimeIssue,
  safeBigThreeSnapshot,
} from '../lib/big-three.ts';
import {
  BIRTH_CHART_LOCAL_TIME_AMBIGUOUS,
  BIRTH_CHART_LOCAL_TIME_NONEXISTENT,
  BIRTH_CHART_TIMEZONE_INVALID,
  birthChartBirthTimeIssue,
  safeBirthChartSnapshot,
} from '../lib/birth-chart.ts';
import {
  DAILY_HOROSCOPE_LOCAL_TIME_AMBIGUOUS,
  DAILY_HOROSCOPE_LOCAL_TIME_NONEXISTENT,
  buildDailyHoroscopeSnapshot,
  dailyHoroscopeBirthTimeIssue,
  safeDailyHoroscopeSnapshot,
} from '../lib/daily-horoscope.ts';
import { resolveIanaLocalDateBounds, resolveIanaLocalDateTime } from '../lib/iana-local-time.mjs';

const PLANETS = [
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter',
  'Saturn', 'Uranus', 'Neptune', 'Pluto', 'NorthNode',
];

function normalize(value) {
  return ((value % 360) + 360) % 360;
}

function angularSeparation(left, right) {
  const difference = Math.abs(normalize(left) - normalize(right));
  return Math.min(difference, 360 - difference);
}

function ascendant(date, latitude, longitudeEast) {
  const julian = date.getTime() / 86_400_000 + 2_440_587.5;
  const t = (julian - 2_451_545) / 36_525;
  const ramc = normalize(SiderealTime(date) * 15 + longitudeEast) * Math.PI / 180;
  const obliquity = (23.4392911 - 0.0130042 * t) * Math.PI / 180;
  const latitudeRadians = latitude * Math.PI / 180;
  return normalize(Math.atan2(
    Math.cos(ramc),
    -(Math.sin(ramc) * Math.cos(obliquity) + Math.tan(latitudeRadians) * Math.sin(obliquity)),
  ) * 180 / Math.PI);
}

function bigThreeSnapshot({
  date = '1990-01-01',
  time = '12:00',
  timezone = 'UTC',
  latitude = 0,
  longitude = 0,
} = {}) {
  const resolution = resolveIanaLocalDateTime(date, time, timezone);
  const bounds = resolveIanaLocalDateBounds(date, timezone);
  assert.equal(resolution?.status, 'unique');
  assert.equal(bounds?.status, 'valid');
  const instant = new Date(resolution.candidates[0]);
  const start = new Date(bounds.start);
  const end = new Date(bounds.end);
  return {
    version: 'big-three-snapshot-v1',
    focus: 'self',
    birth: {
      date,
      time,
      status: 'exact',
      place: { name: 'Test Observatory', region: '', latitude, longitude, timezone },
    },
    placements: {
      sun: { longitude: normalize(SunPosition(instant).elon) },
      moon: {
        longitude: normalize(EclipticGeoMoon(instant).lon),
        startLongitude: normalize(EclipticGeoMoon(start).lon),
        endLongitude: normalize(EclipticGeoMoon(end).lon),
        ambiguous: false,
      },
      rising: { longitude: ascendant(instant, latitude, longitude) },
    },
  };
}

function birthChartSnapshot(overrides = {}) {
  const birth = overrides.birth || {
    date: '1990-01-01',
    time: '12:00',
    status: 'exact',
    place: {
      name: 'Test Observatory', region: '', country: 'Test',
      latitude: 0, longitude: 0, timezone: 'UTC',
    },
  };
  const unknown = birth.status === 'unknown';
  return {
    version: 'birth-chart-snapshot-v1',
    focus: 'self',
    birth,
    systems: { zodiac: 'Western Tropical', houses: 'Whole Sign' },
    angles: { ascendant: unknown ? null : 10, midheaven: unknown ? null : 100 },
    placements: PLANETS.map((key, index) => ({
      key,
      longitude: 5 + index * 25,
      house: unknown ? null : index % 12 + 1,
      retrograde: false,
      ambiguous: false,
    })),
    aspects: [],
    currentTransit: null,
  };
}

function birthOnly(status, date, time, timezone) {
  return {
    birth: {
      date,
      time,
      status,
      place: {
        name: 'Test City', region: '', country: 'Test',
        latitude: 0, longitude: 0, timezone,
      },
    },
  };
}

test('shared IANA resolver distinguishes ordinary times, DST gaps, folds, and skipped dates', () => {
  assert.equal(resolveIanaLocalDateTime('1990-01-01', '12:00', 'UTC')?.status, 'unique');
  assert.equal(resolveIanaLocalDateTime('2024-03-10', '02:30', 'America/New_York')?.status, 'nonexistent');
  assert.deepEqual(resolveIanaLocalDateTime('2024-11-03', '01:10', 'America/New_York'), {
    status: 'ambiguous',
    candidates: ['2024-11-03T05:10:00.000Z', '2024-11-03T06:10:00.000Z'],
  });
  assert.equal(resolveIanaLocalDateTime('2024-03-31', '02:30', 'Europe/Berlin')?.status, 'nonexistent');
  assert.equal(resolveIanaLocalDateTime('2024-10-27', '02:30', 'Europe/Berlin')?.status, 'ambiguous');
  assert.equal(resolveIanaLocalDateTime('2024-10-06', '02:15', 'Australia/Lord_Howe')?.status, 'nonexistent');
  assert.equal(resolveIanaLocalDateTime('2024-04-07', '01:45', 'Australia/Lord_Howe')?.status, 'ambiguous');
  assert.equal(resolveIanaLocalDateTime('2011-12-30', '12:00', 'Pacific/Apia')?.status, 'nonexistent');
  assert.deepEqual(resolveIanaLocalDateBounds('2018-11-04', 'America/Sao_Paulo'), {
    status: 'valid',
    start: '2018-11-04T03:00:00.000Z',
    end: '2018-11-05T01:59:00.000Z',
    startLocalTime: '01:00',
    endLocalTime: '23:59',
  });
  assert.equal(resolveIanaLocalDateBounds('2011-12-30', 'Pacific/Apia')?.status, 'nonexistent');
});

test('Big Three requires unique round-trip instants while preserving ordinary UTC input', () => {
  assert.equal(bigThreeBirthTimeIssue(bigThreeSnapshot()), '');
  assert.ok(safeBigThreeSnapshot(bigThreeSnapshot()));
  assert.equal(
    bigThreeBirthTimeIssue(birthOnly('exact', '2024-03-10', '02:30', 'America/New_York')),
    BIG_THREE_LOCAL_TIME_NONEXISTENT,
  );
  assert.equal(
    bigThreeBirthTimeIssue(birthOnly('approximate', '2024-11-03', '01:10', 'America/New_York')),
    BIG_THREE_LOCAL_TIME_AMBIGUOUS,
  );
  const saoPaulo = bigThreeSnapshot({ date: '2018-11-04', time: '12:00', timezone: 'America/Sao_Paulo' });
  assert.equal(bigThreeBirthTimeIssue(saoPaulo), '');
  assert.ok(safeBigThreeSnapshot(saoPaulo), 'a valid noon must survive a midnight DST gap');

  const newYork = bigThreeSnapshot({
    date: '1990-01-01',
    time: '12:00',
    timezone: 'UTC',
    latitude: 40.7128,
    longitude: -74.006,
  });
  assert.ok(Math.abs(newYork.placements.rising.longitude - 274.6404426) < 0.0001);
  assert.ok(safeBigThreeSnapshot(newYork), 'backend must accept the astronomical Ascendant, not its 180-degree Descendant');

  const newYorkSunrise = new Date('1990-01-01T12:20:08.000Z');
  const sunriseAscendant = ascendant(newYorkSunrise, 40.7128, -74.006);
  const sunriseSun = normalize(SunPosition(newYorkSunrise).elon);
  assert.ok(
    angularSeparation(sunriseAscendant, sunriseSun) < 2,
    'at sunrise the Ascendant must be near the Sun; the opposite-sign formula returns the Descendant',
  );
});

test('Birth Chart fails closed for crafted gap/fold times and keeps a normal UTC contract valid', () => {
  assert.equal(birthChartBirthTimeIssue(birthChartSnapshot()), '');
  assert.ok(safeBirthChartSnapshot(birthChartSnapshot()));
  for (const [birth, code] of [
    [birthOnly('exact', '2024-03-10', '02:30', 'America/New_York').birth, BIRTH_CHART_LOCAL_TIME_NONEXISTENT],
    [birthOnly('approximate', '2024-11-03', '01:10', 'America/New_York').birth, BIRTH_CHART_LOCAL_TIME_AMBIGUOUS],
  ]) {
    const crafted = birthChartSnapshot({ birth });
    assert.equal(birthChartBirthTimeIssue(crafted), code);
    assert.equal(safeBirthChartSnapshot(crafted), null);
  }
  const saoPauloUnknown = birthChartSnapshot({
    birth: birthOnly('unknown', '2018-11-04', '', 'America/Sao_Paulo').birth,
  });
  assert.equal(birthChartBirthTimeIssue(saoPauloUnknown), '');
  assert.ok(safeBirthChartSnapshot(saoPauloUnknown), 'an existing date must not fail because midnight was skipped');
  const invalidTimezone = birthChartSnapshot({
    birth: birthOnly('exact', '1990-01-01', '12:00', 'Mars/Olympus').birth,
  });
  assert.equal(birthChartBirthTimeIssue(invalidTimezone), BIRTH_CHART_TIMEZONE_INVALID);
  assert.equal(safeBirthChartSnapshot(invalidTimezone), null);
});

test('Daily Horoscope rejects gap/fold calculations while preserving a valid UTC snapshot', () => {
  const forecastDate = new Date().toISOString().slice(0, 10);
  const valid = {
    sign: 'Capricorn',
    ...birthOnly('exact', '1990-01-01', '12:00', 'UTC'),
  };
  assert.equal(dailyHoroscopeBirthTimeIssue(valid), '');
  const snapshot = buildDailyHoroscopeSnapshot({ snapshot: valid, focus: 'overall', forecastDate, tier: 'standard' });
  assert.ok(snapshot);
  assert.ok(safeDailyHoroscopeSnapshot(snapshot));
  assert.equal(
    dailyHoroscopeBirthTimeIssue(birthOnly('exact', '2024-03-10', '02:30', 'America/New_York')),
    DAILY_HOROSCOPE_LOCAL_TIME_NONEXISTENT,
  );
  assert.equal(
    dailyHoroscopeBirthTimeIssue(birthOnly('approximate', '2024-11-03', '01:10', 'America/New_York')),
    DAILY_HOROSCOPE_LOCAL_TIME_AMBIGUOUS,
  );
});
