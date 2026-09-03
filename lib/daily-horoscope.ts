import {
  Body,
  Ecliptic,
  EclipticGeoMoon,
  GeoVector,
  SunPosition,
} from 'astronomy-engine';
import { resolveIanaLocalDateTime, uniqueIanaLocalInstant } from './iana-local-time.mjs';
import type { ReadingTier } from '@/lib/reading-products';

export const DAILY_HOROSCOPE_PAGE = '/pages/daily-horoscope';
export const DAILY_HOROSCOPE_FUNNEL_VERSION = 'daily-horoscope-transit-checkout-2026-08-v1';
export const DAILY_HOROSCOPE_SNAPSHOT_VERSION = 'daily-horoscope-transit-v1';
export const DAILY_HOROSCOPE_LOCAL_TIME_NONEXISTENT = 'DAILY_HOROSCOPE_LOCAL_TIME_NONEXISTENT';
export const DAILY_HOROSCOPE_LOCAL_TIME_AMBIGUOUS = 'DAILY_HOROSCOPE_LOCAL_TIME_AMBIGUOUS';

export const DAILY_HOROSCOPE_FOCUSES = Object.freeze({
  overall: Object.freeze({ label: 'Today', category: 'general' as const, lifeArea: 'Overall direction' }),
  love: Object.freeze({ label: 'Love', category: 'love' as const, lifeArea: 'Love & relationships' }),
  career: Object.freeze({ label: 'Career & Money', category: 'career' as const, lifeArea: 'Career, purpose & money' }),
  mood: Object.freeze({ label: 'Mood & Energy', category: 'personal' as const, lifeArea: 'Mood, wellbeing & energy' }),
});

export type DailyHoroscopeFocus = keyof typeof DAILY_HOROSCOPE_FOCUSES;
export type DailyHoroscopeBirthStatus = 'exact' | 'approximate' | 'unknown';

export const DAILY_HOROSCOPE_PACKAGE_SCOPE = Object.freeze({
  standard: Object.freeze({
    title: "Today's Personal Transit Reading",
    days: 1,
    transitCount: 3,
    instruction: 'Interpret the three strongest verified natal transits for today, name the active life area and peak window, then give one opportunity, one caution and one practical action.',
  }),
  medium: Object.freeze({
    title: '7-Day Personal Forecast',
    days: 7,
    transitCount: 7,
    instruction: 'Build a seven-day forecast from the verified natal transits, highlight the clearest timing windows, and give practical guidance for love, work and personal energy without claiming certainty.',
  }),
  premium: Object.freeze({
    title: '30-Day Timing Map',
    days: 30,
    transitCount: 12,
    instruction: 'Build a 30-day timing map from the verified natal transits, distinguish supportive and demanding windows, connect repeating themes, and finish with a practical action plan and safeguards.',
  }),
} as const);

const SIGNS = Object.freeze([
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
] as const);
const NATAL_PLANETS = Object.freeze(['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'] as const);
const TRANSIT_PLANETS = Object.freeze(['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'] as const);
const ASPECTS = Object.freeze([
  { name: 'conjunction', angle: 0, tone: 'activating' },
  { name: 'sextile', angle: 60, tone: 'supportive' },
  { name: 'square', angle: 90, tone: 'demanding' },
  { name: 'trine', angle: 120, tone: 'supportive' },
  { name: 'opposition', angle: 180, tone: 'polarizing' },
] as const);

type JsonObject = Record<string, unknown>;
type PlanetName = typeof NATAL_PLANETS[number];
type AspectName = typeof ASPECTS[number]['name'];

export type DailyHoroscopeTransit = {
  movingPlanet: PlanetName;
  natalPlanet: PlanetName;
  aspect: AspectName;
  orb: number;
  peakAt: string;
  tone: 'activating' | 'supportive' | 'demanding' | 'polarizing';
  lifeArea: string;
};

export type SafeDailyHoroscopeSnapshot = {
  version: typeof DAILY_HOROSCOPE_SNAPSHOT_VERSION;
  focus: DailyHoroscopeFocus;
  focusLabel: string;
  sign: typeof SIGNS[number];
  forecastDate: string;
  birth: {
    date: string;
    time: string | null;
    status: DailyHoroscopeBirthStatus;
    place: {
      name: string;
      region: string;
      country: string;
      latitude: number | null;
      longitude: number | null;
      timezone: string | null;
    };
  };
  calculation: {
    system: 'Western Tropical';
    housesUsed: false;
    confidence: string;
  };
  natalPlacements: Array<{ planet: PlanetName; longitude: number; sign: typeof SIGNS[number] }>;
  transits: DailyHoroscopeTransit[];
  packageTitle: string;
  coverageDays: number;
  deliveryWindowMinutes: 90;
};

function record(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function clean(value: unknown, maximum: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function round(value: number, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function normalizeAngle(value: number) {
  return ((value % 360) + 360) % 360;
}

function angleDistance(first: number, second: number) {
  const distance = Math.abs(normalizeAngle(first) - normalizeAngle(second));
  return Math.min(distance, 360 - distance);
}

function signForLongitude(longitude: number) {
  return SIGNS[Math.floor(normalizeAngle(longitude) / 30)] || 'Aries';
}

function validDateKey(value: unknown) {
  const text = clean(value, 16);
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return { key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, year, month, day, date };
}

export function dailyHoroscopeDateIsCurrent(value: unknown, now = Date.now()) {
  const parsed = validDateKey(value);
  if (!parsed) return false;
  const today = new Date(now);
  const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.abs(parsed.date.getTime() - utcToday) <= 24 * 60 * 60 * 1000;
}

export function isDailyHoroscopeFocus(value: unknown): value is DailyHoroscopeFocus {
  return Object.hasOwn(DAILY_HOROSCOPE_FOCUSES, clean(value, 24).toLowerCase());
}

function isBirthStatus(value: unknown): value is DailyHoroscopeBirthStatus {
  return ['exact', 'approximate', 'unknown'].includes(clean(value, 20).toLowerCase());
}

function timezoneIsValid(timezone: string) {
  if (!timezone || timezone.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function localDateTimeToUtc(input: { year: number; month: number; day: number; hour: number; minute: number; timezone: string }) {
  const date = `${input.year}-${String(input.month).padStart(2, '0')}-${String(input.day).padStart(2, '0')}`;
  const time = `${String(input.hour).padStart(2, '0')}:${String(input.minute).padStart(2, '0')}`;
  return uniqueIanaLocalInstant(date, time, input.timezone);
}

function planetLongitude(planet: PlanetName, date: Date) {
  if (planet === 'Sun') return normalizeAngle(SunPosition(date).elon);
  if (planet === 'Moon') return normalizeAngle(EclipticGeoMoon(date).lon);
  return normalizeAngle(Ecliptic(GeoVector(Body[planet], date, true)).elon);
}

function focusRelevance(focus: DailyHoroscopeFocus, moving: PlanetName, natal: PlanetName) {
  const planets = focus === 'love'
    ? new Set<PlanetName>(['Venus', 'Moon', 'Mars'])
    : focus === 'career'
      ? new Set<PlanetName>(['Sun', 'Mercury', 'Mars', 'Jupiter', 'Saturn'])
      : focus === 'mood'
        ? new Set<PlanetName>(['Moon', 'Sun', 'Mercury'])
        : new Set<PlanetName>(NATAL_PLANETS);
  return Number(planets.has(moving)) + Number(planets.has(natal));
}

function parseBirth(value: unknown) {
  const source = record(value);
  const birth = validDateKey(source.date);
  const status = clean(source.status, 20).toLowerCase();
  const time = clean(source.time, 8);
  const placeSource = record(source.place);
  if (!birth || birth.date.getTime() > Date.now() || birth.year < 1900 || !isBirthStatus(status)) return null;
  if (status !== 'unknown' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const name = clean(placeSource.name, 100);
  const region = clean(placeSource.region, 100);
  const country = clean(placeSource.country, 80);
  const timezone = clean(placeSource.timezone, 80);
  const latitudeSupplied = placeSource.latitude !== null && placeSource.latitude !== undefined && clean(placeSource.latitude, 40) !== '';
  const longitudeSupplied = placeSource.longitude !== null && placeSource.longitude !== undefined && clean(placeSource.longitude, 40) !== '';
  const latitude = latitudeSupplied ? Number(placeSource.latitude) : Number.NaN;
  const longitude = longitudeSupplied ? Number(placeSource.longitude) : Number.NaN;
  const hasCoordinates = latitudeSupplied && longitudeSupplied
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  if (status !== 'unknown' && (!name || !hasCoordinates || !timezoneIsValid(timezone))) return null;
  if (status === 'unknown' && timezone && !timezoneIsValid(timezone)) return null;
  const representativeTime = status === 'unknown' ? '12:00' : time;
  if (timezone && resolveIanaLocalDateTime(birth.key, representativeTime, timezone)?.status !== 'unique') return null;
  return {
    date: birth,
    time: status === 'unknown' ? null : time,
    status,
    place: {
      name,
      region,
      country,
      latitude: hasCoordinates ? round(latitude, 6) : null,
      longitude: hasCoordinates ? round(longitude, 6) : null,
      timezone: timezone || null,
    },
  };
}

export function dailyHoroscopeBirthTimeIssue(value: unknown) {
  const source = record(value);
  const birth = record(source.birth);
  const parsedDate = validDateKey(birth.date);
  const status = clean(birth.status, 20).toLowerCase();
  const submittedTime = clean(birth.time, 8);
  const timezone = clean(record(birth.place).timezone, 80);
  if (!parsedDate
    || !isBirthStatus(status)
    || !timezone
    || !timezoneIsValid(timezone)
    || (status === 'unknown' ? Boolean(submittedTime) : !/^([01]\d|2[0-3]):[0-5]\d$/.test(submittedTime))) return '';
  const resolution = resolveIanaLocalDateTime(
    parsedDate.key,
    status === 'unknown' ? '12:00' : submittedTime,
    timezone,
  );
  if (resolution?.status === 'ambiguous') return DAILY_HOROSCOPE_LOCAL_TIME_AMBIGUOUS;
  if (resolution?.status === 'nonexistent') return DAILY_HOROSCOPE_LOCAL_TIME_NONEXISTENT;
  return '';
}

function strongestTransits(input: {
  natal: Array<{ planet: PlanetName; longitude: number }>;
  start: Date;
  focus: DailyHoroscopeFocus;
  days: number;
  count: number;
}) {
  const candidates = new Map<string, DailyHoroscopeTransit & { score: number }>();
  const stepHours = input.days <= 1 ? 2 : input.days <= 7 ? 4 : 6;
  const endHours = input.days * 24;
  for (let hour = 0; hour <= endHours; hour += stepHours) {
    const when = new Date(input.start.getTime() + hour * 60 * 60 * 1000);
    for (const movingPlanet of TRANSIT_PLANETS) {
      const movingLongitude = planetLongitude(movingPlanet, when);
      for (const natal of input.natal) {
        const separation = angleDistance(movingLongitude, natal.longitude);
        for (const aspect of ASPECTS) {
          const orb = Math.abs(separation - aspect.angle);
          const key = `${movingPlanet}:${aspect.name}:${natal.planet}`;
          const relevance = focusRelevance(input.focus, movingPlanet, natal.planet);
          const speedWeight = movingPlanet === 'Moon' ? 0.5 : movingPlanet === 'Sun' ? 0.3 : 0;
          const score = orb - relevance * 0.45 + speedWeight;
          const previous = candidates.get(key);
          if (!previous || score < previous.score) {
            candidates.set(key, {
              movingPlanet,
              natalPlanet: natal.planet,
              aspect: aspect.name,
              orb: round(orb, 2),
              peakAt: when.toISOString(),
              tone: aspect.tone,
              lifeArea: DAILY_HOROSCOPE_FOCUSES[input.focus].lifeArea,
              score,
            });
          }
        }
      }
    }
  }
  const preferred = [...candidates.values()].filter((entry) => entry.orb <= 6);
  const ranked = (preferred.length >= input.count ? preferred : [...candidates.values()])
    .sort((first, second) => first.score - second.score || first.peakAt.localeCompare(second.peakAt));
  const selected: DailyHoroscopeTransit[] = [];
  const movingCounts = new Map<PlanetName, number>();
  for (const { score: _score, ...entry } of ranked) {
    if ((movingCounts.get(entry.movingPlanet) || 0) >= 3) continue;
    selected.push(entry);
    movingCounts.set(entry.movingPlanet, (movingCounts.get(entry.movingPlanet) || 0) + 1);
    if (selected.length >= input.count) break;
  }
  return selected;
}

export function buildDailyHoroscopeSnapshot(input: {
  snapshot: unknown;
  focus: DailyHoroscopeFocus;
  forecastDate: string;
  tier: ReadingTier;
}) : SafeDailyHoroscopeSnapshot | null {
  const source = record(input.snapshot);
  const birth = parseBirth(source.birth);
  const forecast = validDateKey(input.forecastDate);
  const suppliedSign = clean(source.sign, 20);
  if (!birth || !forecast || !dailyHoroscopeDateIsCurrent(input.forecastDate) || !SIGNS.includes(suppliedSign as typeof SIGNS[number])) return null;
  const [hour, minute] = birth.time ? birth.time.split(':').map(Number) : [12, 0];
  const birthMoment = birth.place.timezone
    ? localDateTimeToUtc({ ...birth.date, hour, minute, timezone: birth.place.timezone })
    : new Date(Date.UTC(birth.date.year, birth.date.month - 1, birth.date.day, 12, 0, 0));
  if (!birthMoment) return null;
  const planets = birth.status === 'unknown' ? NATAL_PLANETS.filter((planet) => planet !== 'Moon') : NATAL_PLANETS;
  const natalPlacements = planets.map((planet) => {
    const longitude = round(planetLongitude(planet, birthMoment), 4);
    return { planet, longitude, sign: signForLongitude(longitude) };
  });
  const calculatedSunSign = natalPlacements.find((placement) => placement.planet === 'Sun')?.sign;
  if (calculatedSunSign !== suppliedSign) return null;
  const scope = DAILY_HOROSCOPE_PACKAGE_SCOPE[input.tier];
  const start = new Date(Date.UTC(forecast.year, forecast.month - 1, forecast.day, 0, 0, 0));
  const transits = strongestTransits({
    natal: natalPlacements,
    start,
    focus: input.focus,
    days: scope.days,
    count: scope.transitCount,
  });
  if (transits.length !== scope.transitCount) return null;
  const confidence = birth.status === 'exact'
    ? 'Exact birth time and resolved historical timezone supplied. Planetary transits are verified; houses are intentionally not used.'
    : birth.status === 'approximate'
      ? 'Approximate birth time and resolved historical timezone supplied. Time-sensitive details must be described as approximate; houses are not used.'
      : 'Birth time unknown. Moon, Ascendant, Midheaven and houses are not inferred; only time-stable natal planets are used.';
  return {
    version: DAILY_HOROSCOPE_SNAPSHOT_VERSION,
    focus: input.focus,
    focusLabel: DAILY_HOROSCOPE_FOCUSES[input.focus].label,
    sign: suppliedSign as typeof SIGNS[number],
    forecastDate: forecast.key,
    birth: {
      date: birth.date.key,
      time: birth.time,
      status: birth.status,
      place: birth.place,
    },
    calculation: { system: 'Western Tropical', housesUsed: false, confidence },
    natalPlacements,
    transits,
    packageTitle: scope.title,
    coverageDays: scope.days,
    deliveryWindowMinutes: 90,
  };
}

export function safeDailyHoroscopeSnapshot(value: unknown): SafeDailyHoroscopeSnapshot | null {
  const source = record(value);
  const focus = clean(source.focus, 24).toLowerCase();
  const version = clean(source.version, 64);
  const sign = clean(source.sign, 20);
  const forecastDate = validDateKey(source.forecastDate);
  const birth = parseBirth(source.birth);
  const calculation = record(source.calculation);
  const packageTitle = clean(source.packageTitle, 100);
  const coverageDays = Number(source.coverageDays);
  const deliveryWindowMinutes = Number(source.deliveryWindowMinutes);
  if (version !== DAILY_HOROSCOPE_SNAPSHOT_VERSION
    || !isDailyHoroscopeFocus(focus)
    || !SIGNS.includes(sign as typeof SIGNS[number])
    || !forecastDate
    || !birth
    || clean(source.focusLabel, 80) !== DAILY_HOROSCOPE_FOCUSES[focus].label
    || clean(calculation.system, 40) !== 'Western Tropical'
    || calculation.housesUsed !== false
    || clean(calculation.confidence, 500).length < 40
    || ![1, 7, 30].includes(coverageDays)
    || deliveryWindowMinutes !== 90) return null;
  const scope = Object.values(DAILY_HOROSCOPE_PACKAGE_SCOPE).find((entry) => entry.days === coverageDays);
  if (!scope || scope.title !== packageTitle) return null;
  const natalPlacements = Array.isArray(source.natalPlacements)
    ? source.natalPlacements.map((value) => {
      const placement = record(value);
      return {
        planet: clean(placement.planet, 20) as PlanetName,
        longitude: Number(placement.longitude),
        sign: clean(placement.sign, 20) as typeof SIGNS[number],
      };
    })
    : [];
  if (natalPlacements.length < 6
    || natalPlacements.some((placement) => !NATAL_PLANETS.includes(placement.planet)
      || !Number.isFinite(placement.longitude)
      || placement.longitude < 0
      || placement.longitude >= 360
      || signForLongitude(placement.longitude) !== placement.sign)
    || (birth.status === 'unknown' && natalPlacements.some((placement) => placement.planet === 'Moon'))) return null;
  const transits = Array.isArray(source.transits)
    ? source.transits.map((value) => {
      const transit = record(value);
      return {
        movingPlanet: clean(transit.movingPlanet, 20) as PlanetName,
        natalPlanet: clean(transit.natalPlanet, 20) as PlanetName,
        aspect: clean(transit.aspect, 20) as AspectName,
        orb: Number(transit.orb),
        peakAt: clean(transit.peakAt, 40),
        tone: clean(transit.tone, 20) as DailyHoroscopeTransit['tone'],
        lifeArea: clean(transit.lifeArea, 100),
      };
    })
    : [];
  if (transits.length !== scope.transitCount
    || transits.some((transit) => !TRANSIT_PLANETS.includes(transit.movingPlanet)
      || !NATAL_PLANETS.includes(transit.natalPlanet)
      || !ASPECTS.some((aspect) => aspect.name === transit.aspect && aspect.tone === transit.tone)
      || !Number.isFinite(transit.orb)
      || transit.orb < 0
      || transit.orb > 180
      || !Number.isFinite(Date.parse(transit.peakAt))
      || transit.lifeArea !== DAILY_HOROSCOPE_FOCUSES[focus].lifeArea)) return null;
  return {
    version: DAILY_HOROSCOPE_SNAPSHOT_VERSION,
    focus,
    focusLabel: DAILY_HOROSCOPE_FOCUSES[focus].label,
    sign: sign as typeof SIGNS[number],
    forecastDate: forecastDate.key,
    birth: {
      date: birth.date.key,
      time: birth.time,
      status: birth.status,
      place: birth.place,
    },
    calculation: {
      system: 'Western Tropical',
      housesUsed: false,
      confidence: clean(calculation.confidence, 500),
    },
    natalPlacements,
    transits,
    packageTitle,
    coverageDays,
    deliveryWindowMinutes: 90,
  };
}

export function dailyHoroscopeEvidence(snapshot: SafeDailyHoroscopeSnapshot) {
  const transitEvidence = snapshot.transits.map((transit) => (
    `${transit.movingPlanet} ${transit.aspect} natal ${transit.natalPlanet} · ${transit.orb.toFixed(2)}° orb · peak ${transit.peakAt}`
  )).join('; ');
  return `${snapshot.sign} Sun · ${snapshot.focusLabel} focus · ${snapshot.coverageDays}-day window. Verified transits: ${transitEvidence}`;
}
