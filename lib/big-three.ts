import { EclipticGeoMoon, SunPosition } from 'astronomy-engine';

export const BIG_THREE_PAGE = '/pages/sun-moon-rising-calculator';
export const BIG_THREE_FUNNEL_VERSION = 'big-three-synthesis-checkout-2026-08-v1';
export const BIG_THREE_SNAPSHOT_VERSION = 'big-three-snapshot-v1';

export const BIG_THREE_FOCUSES = Object.freeze({
  self: Object.freeze({ label: 'Understand myself', category: 'personal' as const }),
  love: Object.freeze({ label: 'Love & relationships', category: 'love' as const }),
  career: Object.freeze({ label: 'Career & purpose', category: 'career' as const }),
  pattern: Object.freeze({ label: 'A repeating pattern', category: 'personal' as const }),
  current: Object.freeze({ label: 'What is changing now', category: 'personal' as const }),
  explore: Object.freeze({ label: 'My strongest theme', category: 'personal' as const }),
});

export type BigThreeFocus = keyof typeof BIG_THREE_FOCUSES;
export type BigThreeBirthTimeStatus = 'exact' | 'approximate' | 'unknown';

export const BIG_THREE_PACKAGE_SCOPE = Object.freeze({
  standard: Object.freeze({
    title: 'Core Synthesis',
    instruction: 'Explain the central Sun-Moon-Rising dynamic, the selected life focus, the main inner-outer mismatch, one natural strength, one blind spot and three grounded insights.',
  }),
  medium: Object.freeze({
    title: 'Pattern & Guidance',
    instruction: 'Include the Core Synthesis, then connect Sun-Moon, Sun-Rising and Moon-Rising; explain emotional triggers, the repeating pattern, one life-area application and a practical 7-day integration plan.',
  }),
  premium: Object.freeze({
    title: 'Big Three Blueprint',
    instruction: 'Include the full pairwise and three-way synthesis across two relevant life areas, supportive and difficult scenarios, communication and coping style, strengths and blind spots, and a practical 30-day reflection plan.',
  }),
});

const SIGNS = Object.freeze([
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
] as const);
const ELEMENTS = Object.freeze(['Fire', 'Earth', 'Air', 'Water'] as const);
const MODALITIES = Object.freeze(['Cardinal', 'Fixed', 'Mutable'] as const);
const SIGN_ELEMENT = Object.freeze(['Fire', 'Earth', 'Air', 'Water', 'Fire', 'Earth', 'Air', 'Water', 'Fire', 'Earth', 'Air', 'Water'] as const);
const SIGN_MODALITY = Object.freeze(['Cardinal', 'Fixed', 'Mutable', 'Cardinal', 'Fixed', 'Mutable', 'Cardinal', 'Fixed', 'Mutable', 'Cardinal', 'Fixed', 'Mutable'] as const);

type JsonObject = Record<string, unknown>;

export type SafeBigThreeSnapshot = {
  version: typeof BIG_THREE_SNAPSHOT_VERSION;
  focus: BigThreeFocus;
  focusLabel: string;
  birth: {
    date: string;
    time: string | null;
    status: BigThreeBirthTimeStatus;
    place: {
      name: string;
      region: string;
      latitude: number;
      longitude: number;
      timezone: string;
    };
  };
  placements: {
    sun: { longitude: number; sign: typeof SIGNS[number]; degree: number };
    moon: {
      longitude: number;
      sign: typeof SIGNS[number];
      degree: number;
      ambiguous: boolean;
      possibleSigns: typeof SIGNS[number][];
      startLongitude: number;
      endLongitude: number;
    };
    rising: null | { longitude: number; sign: typeof SIGNS[number]; degree: number };
  };
  balance: {
    elements: Record<typeof ELEMENTS[number], number>;
    modalities: Record<typeof MODALITIES[number], number>;
    dominantElement: typeof ELEMENTS[number];
    dominantModality: typeof MODALITIES[number];
  };
};

function record(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function clean(value: unknown, maximum: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value: number, places = 6) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function normalizeLongitude(value: number) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function submittedLongitude(value: unknown) {
  const number = finite(value);
  return number != null && number >= 0 && number < 360 ? rounded(number) : null;
}

function signIndex(value: number) {
  return Math.floor(normalizeLongitude(value) / 30) % 12;
}

function angularDistance(left: number, right: number) {
  const raw = Math.abs(left - right) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function validBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  const year = Number(value.slice(0, 4));
  return Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === value
    && year >= 1900
    && timestamp <= Date.now() + 86_400_000;
}

function timeZoneOffsetHours(timezone: string, year: number, month: number, day: number, hour: number, minute: number) {
  try {
    let guess = Date.UTC(year, month - 1, day, hour, minute);
    let offset: number | null = null;
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'longOffset',
      }).formatToParts(new Date(guess));
      const zone = parts.find((part) => part.type === 'timeZoneName')?.value || '';
      if (zone === 'GMT' || zone === 'UTC') offset = 0;
      else {
        const match = zone.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
        if (!match) return null;
        offset = (match[1] === '-' ? -1 : 1)
          * (Number.parseInt(match[2], 10) + Number.parseInt(match[3] || '0', 10) / 60);
      }
      guess = Date.UTC(year, month - 1, day, hour, minute) - offset * 3_600_000;
    }
    return offset;
  } catch {
    return null;
  }
}

function utcFromLocal(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const offset = timeZoneOffsetHours(timezone, year, month, day, hour, minute);
  if (offset == null) return null;
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offset * 3_600_000);
}

function bodyLongitudes(date: Date) {
  return {
    sun: normalizeLongitude(SunPosition(date).elon),
    moon: normalizeLongitude(EclipticGeoMoon(date).lon),
  };
}

function julianDay(date: Date) {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

function ascendant(julian: number, latitude: number, longitudeEast: number) {
  const t = (julian - 2_451_545) / 36_525;
  const gmst = normalizeLongitude(280.46061837 + 360.98564736629 * (julian - 2_451_545) + 0.000387933 * t * t);
  const ramc = normalizeLongitude(gmst + longitudeEast) * Math.PI / 180;
  const obliquity = (23.4392911 - 0.0130042 * t) * Math.PI / 180;
  const latitudeRadians = latitude * Math.PI / 180;
  return normalizeLongitude(Math.atan2(
    Math.cos(ramc),
    -(Math.sin(ramc) * Math.cos(obliquity) + Math.tan(latitudeRadians) * Math.sin(obliquity)),
  ) * 180 / Math.PI);
}

function placement(longitude: number) {
  const index = signIndex(longitude);
  return { longitude: rounded(longitude), sign: SIGNS[index], degree: rounded(longitude % 30, 4) };
}

function dominant<T extends string>(values: Record<T, number>, order: readonly T[]) {
  return order.reduce((winner, value) => values[value] > values[winner] ? value : winner, order[0]);
}

export function isBigThreeFocus(value: unknown): value is BigThreeFocus {
  return Object.hasOwn(BIG_THREE_FOCUSES, clean(value, 40).toLowerCase());
}

export function safeBigThreeSnapshot(value: unknown): SafeBigThreeSnapshot | null {
  const source = record(value);
  const version = clean(source.version, 64);
  const focus = clean(source.focus, 40).toLowerCase();
  if (version !== BIG_THREE_SNAPSHOT_VERSION || !isBigThreeFocus(focus)) return null;

  const birthSource = record(source.birth);
  const status = clean(birthSource.status, 20) as BigThreeBirthTimeStatus;
  const date = clean(birthSource.date, 16);
  const submittedTime = clean(birthSource.time, 8);
  if (!['exact', 'approximate', 'unknown'].includes(status)
    || !validBirthDate(date)
    || (status === 'unknown' ? Boolean(submittedTime) : !/^([01]\d|2[0-3]):[0-5]\d$/.test(submittedTime))) return null;

  const placeSource = record(birthSource.place);
  const latitude = finite(placeSource.latitude);
  const placeLongitude = finite(placeSource.longitude);
  const timezone = clean(placeSource.timezone, 80);
  const placeName = clean(placeSource.name, 100);
  if (!placeName
    || latitude == null || latitude < -90 || latitude > 90
    || placeLongitude == null || placeLongitude < -180 || placeLongitude > 180
    || !/^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+\-]+)+)$/.test(timezone)) return null;

  const time = status === 'unknown' ? '12:00' : submittedTime;
  const birthInstant = utcFromLocal(date, time, timezone);
  const dayStart = utcFromLocal(date, '00:00', timezone);
  const dayEnd = utcFromLocal(date, '23:59', timezone);
  if (!birthInstant || !dayStart || !dayEnd) return null;

  const calculated = bodyLongitudes(birthInstant);
  const moonStart = bodyLongitudes(dayStart).moon;
  const moonEnd = bodyLongitudes(dayEnd).moon;
  const expectedRising = status === 'unknown' ? null : ascendant(julianDay(birthInstant), latitude, placeLongitude);

  const placementsSource = record(source.placements);
  const sunSource = record(placementsSource.sun);
  const moonSource = record(placementsSource.moon);
  const risingSource = placementsSource.rising == null ? null : record(placementsSource.rising);
  const suppliedSun = submittedLongitude(sunSource.longitude);
  const suppliedMoon = submittedLongitude(moonSource.longitude);
  const suppliedMoonStart = submittedLongitude(moonSource.startLongitude);
  const suppliedMoonEnd = submittedLongitude(moonSource.endLongitude);
  const suppliedRising = risingSource ? submittedLongitude(risingSource.longitude) : null;
  const expectedAmbiguous = status === 'unknown' && signIndex(moonStart) !== signIndex(moonEnd);

  if (suppliedSun == null || angularDistance(suppliedSun, calculated.sun) > 0.08
    || suppliedMoon == null || angularDistance(suppliedMoon, calculated.moon) > 0.08
    || suppliedMoonStart == null || angularDistance(suppliedMoonStart, moonStart) > 0.08
    || suppliedMoonEnd == null || angularDistance(suppliedMoonEnd, moonEnd) > 0.08
    || moonSource.ambiguous !== expectedAmbiguous
    || (status === 'unknown' ? suppliedRising != null : suppliedRising == null || expectedRising == null || angularDistance(suppliedRising, expectedRising) > 0.2)) {
    return null;
  }

  const sun = placement(calculated.sun);
  const moon = placement(calculated.moon);
  const rising = expectedRising == null ? null : placement(expectedRising);
  const possibleMoonSigns = expectedAmbiguous
    ? [...new Set([SIGNS[signIndex(moonStart)], SIGNS[signIndex(moonEnd)]])]
    : [moon.sign];
  const elementCounts = { Fire: 0, Earth: 0, Air: 0, Water: 0 };
  const modalityCounts = { Cardinal: 0, Fixed: 0, Mutable: 0 };
  const addBalance = (longitude: number, weight: number) => {
    const index = signIndex(longitude);
    elementCounts[SIGN_ELEMENT[index]] += weight;
    modalityCounts[SIGN_MODALITY[index]] += weight;
  };
  addBalance(sun.longitude, 1);
  if (expectedAmbiguous) {
    addBalance(moonStart, 0.5);
    addBalance(moonEnd, 0.5);
  } else addBalance(moon.longitude, 1);
  if (rising) addBalance(rising.longitude, 1);

  const snapshot: SafeBigThreeSnapshot = {
    version: BIG_THREE_SNAPSHOT_VERSION,
    focus,
    focusLabel: BIG_THREE_FOCUSES[focus].label,
    birth: {
      date,
      time: status === 'unknown' ? null : submittedTime,
      status,
      place: {
        name: placeName,
        region: clean(placeSource.region, 120),
        latitude: rounded(latitude),
        longitude: rounded(placeLongitude),
        timezone,
      },
    },
    placements: {
      sun,
      moon: {
        ...moon,
        ambiguous: expectedAmbiguous,
        possibleSigns: possibleMoonSigns,
        startLongitude: rounded(moonStart),
        endLongitude: rounded(moonEnd),
      },
      rising,
    },
    balance: {
      elements: elementCounts,
      modalities: modalityCounts,
      dominantElement: dominant(elementCounts, ELEMENTS),
      dominantModality: dominant(modalityCounts, MODALITIES),
    },
  };
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <= 6_144 ? snapshot : null;
}

function degreeLabel(value: number) {
  const degree = Math.floor(value % 30);
  const minutes = Math.round(((value % 30) - degree) * 60);
  return `${degree}\u00b0${String(minutes === 60 ? 0 : minutes).padStart(2, '0')}\u2032`;
}

export function bigThreeEvidence(snapshot: SafeBigThreeSnapshot) {
  const moon = snapshot.placements.moon.ambiguous
    ? `${snapshot.placements.moon.possibleSigns.join(' or ')}; the Moon changed signs on the local birth date and the birth time is unknown`
    : `${degreeLabel(snapshot.placements.moon.longitude)} ${snapshot.placements.moon.sign}`;
  const rising = snapshot.placements.rising
    ? `${degreeLabel(snapshot.placements.rising.longitude)} ${snapshot.placements.rising.sign}`
    : 'not calculated because birth time is unknown';
  const currentBoundary = snapshot.focus === 'current'
    ? 'The selected wording asks what is changing now, but no transits were calculated. Treat it only as a natal pattern currently asking for attention; do not invent timing, transit placements or forecasts.'
    : '';
  return [
    `Verified deterministic Big Three calculation. Focus: ${snapshot.focusLabel}.`,
    `Birth time confidence: ${snapshot.birth.status}. Birthplace: ${snapshot.birth.place.name}${snapshot.birth.place.region ? `, ${snapshot.birth.place.region}` : ''}; historical timezone ${snapshot.birth.place.timezone}.`,
    `Sun: ${degreeLabel(snapshot.placements.sun.longitude)} ${snapshot.placements.sun.sign}. Moon: ${moon}. Rising: ${rising}.`,
    `Balance: ${snapshot.balance.dominantElement} dominant and ${snapshot.balance.dominantModality} dominant across the available Big Three placements.`,
    'Evidence boundary: No houses, aspects, other planets, transits or forecasts were calculated.',
    currentBoundary,
  ].filter(Boolean).join(' ');
}
