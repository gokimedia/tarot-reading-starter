import {
  Body,
  EclipticGeoMoon,
  Illumination,
  MoonPhase,
  SearchMoonPhase,
  SearchMoonQuarter,
} from 'astronomy-engine';
import type { ReadingTier, YesNoCategory } from '@/lib/reading-products';

export const MOON_LUNAR_PAGE = '/pages/moon-phase-today';
export const MOON_LUNAR_FUNNEL_VERSION = 'moon-lunar-intent-checkout-2026-08-v1';
export const MOON_LUNAR_SNAPSHOT_VERSION = 'moon-lunar-snapshot-v1';

export const MOON_LUNAR_FOCUSES = Object.freeze({
  love_relationships: Object.freeze({ label: 'Love & Relationships', category: 'love' as const }),
  career_money: Object.freeze({ label: 'Career & Money', category: 'career' as const }),
  decision: Object.freeze({ label: 'A Decision', category: 'personal' as const }),
  emotional_clarity: Object.freeze({ label: 'Emotional Clarity', category: 'personal' as const }),
  personal_growth: Object.freeze({ label: 'Personal Growth', category: 'personal' as const }),
});

export type MoonLunarFocus = keyof typeof MOON_LUNAR_FOCUSES;
export type MoonPhaseName =
  | 'New Moon'
  | 'Waxing Crescent'
  | 'First Quarter'
  | 'Waxing Gibbous'
  | 'Full Moon'
  | 'Waning Gibbous'
  | 'Last Quarter'
  | 'Waning Crescent';

const MOON_PHASE_SEQUENCE = Object.freeze<MoonPhaseName[]>([
  'New Moon',
  'Waxing Crescent',
  'First Quarter',
  'Waxing Gibbous',
  'Full Moon',
  'Waning Gibbous',
  'Last Quarter',
  'Waning Crescent',
]);

// The browser and server use independent astronomical implementations. Allow
// only a small, adjacent-label disagreement when their verified angles fall on
// opposite sides of the same phase boundary (1.5 degrees is about three hours
// of a synodic month). All other lunar fields remain server-recalculated.
export const MOON_PHASE_LABEL_BOUNDARY_DRIFT_DEGREES = 1.5;

export const MOON_LUNAR_PACKAGE_SCOPE = Object.freeze({
  standard: Object.freeze({
    title: "Tonight's Moon & You",
    days: 1,
    instruction: 'Connect today\'s exact lunar phase and sign with the natal Moon, the selected focus, the visitor\'s exact question and lunar card. Give one clear action, one thing to postpone, the best timing window before the next phase, a three-minute ritual and one journal prompt.',
  }),
  medium: Object.freeze({
    title: '7-Day Lunar Timing',
    days: 7,
    instruction: 'Include the complete Tonight\'s Moon & You reading, then map seven days of opportunity and tension windows, what to begin or release, two decision checkpoints, a tailored ritual and daily reflection prompts.',
  }),
  premium: Object.freeze({
    title: 'Full Lunar Cycle Reading',
    days: 30,
    instruction: 'Cover the current-to-next lunar cycle, the natal Moon interaction, alternatives and risks, New and Full Moon turning points, what to act on or postpone, a practical 30-day plan, rituals and journal prompts. Keep every timing statement grounded in the verified lunar snapshot.',
  }),
});

export const MOON_PHASE_CARD_POSITIONS = Object.freeze<Record<MoonPhaseName, string>>({
  'New Moon': 'The seed asking to be planted',
  'Waxing Crescent': 'What deserves your commitment',
  'First Quarter': 'The action that breaks the stalemate',
  'Waxing Gibbous': 'What needs refinement before completion',
  'Full Moon': 'What is ready to be seen clearly',
  'Waning Gibbous': 'The wisdom worth carrying forward',
  'Last Quarter': 'What is ready to be released',
  'Waning Crescent': 'What needs rest before renewal',
});

const SIGNS = Object.freeze([
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
] as const);
const LUNAR_CARD_NAMES = Object.freeze([
  'The Fool', 'The Magician', 'The High Priestess', 'The Empress', 'The Emperor',
  'The Hierophant', 'The Lovers', 'The Chariot', 'Strength', 'The Hermit',
  'Wheel of Fortune', 'Justice', 'The Hanged Man', 'Death', 'Temperance', 'The Devil',
  'The Tower', 'The Star', 'The Moon', 'The Sun', 'Judgement', 'The World',
] as const);
const QUARTER_NAMES = Object.freeze(['New Moon', 'First Quarter', 'Full Moon', 'Last Quarter'] as const);
const MAX_SNAPSHOT_AGE_MS = 26 * 60 * 60 * 1000;

type JsonObject = Record<string, unknown>;

export type SafeMoonLunarSnapshot = {
  version: typeof MOON_LUNAR_SNAPSHOT_VERSION;
  capturedAt: string;
  focus: MoonLunarFocus;
  focusLabel: string;
  category: YesNoCategory;
  situation: string;
  packageTier: ReadingTier;
  packageTitle: string;
  coverageDays: number;
  current: {
    dateKey: string;
    phase: MoonPhaseName;
    phaseAngle: number;
    illumination: number;
    age: number;
    moonLongitude: number;
    moonSign: typeof SIGNS[number];
    nextPhase: { name: typeof QUARTER_NAMES[number]; at: string };
  };
  card: {
    id: number;
    name: string;
    orientation: 'Upright';
    position: string;
  };
  birth: {
    date: string;
    time: string | null;
    status: 'exact' | 'approximate' | 'unknown';
    place: string;
    timezone: string;
  };
  natalMoon: {
    longitude: number;
    sign: typeof SIGNS[number];
    degree: number;
    ambiguous: boolean;
    possibleSigns: typeof SIGNS[number][];
    startLongitude: number;
    endLongitude: number;
    confidence: string;
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

function rounded(value: number, places = 4) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function normalizeAngle(value: number) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function angularDistance(left: number, right: number) {
  const raw = Math.abs(normalizeAngle(left) - normalizeAngle(right)) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function signForLongitude(value: number) {
  return SIGNS[Math.floor(normalizeAngle(value) / 30) % 12];
}

function phaseForAngle(angle: number): MoonPhaseName {
  const value = normalizeAngle(angle);
  const primaryWindowDegrees = 0.55 / 29.530588853 * 360;
  if (value <= primaryWindowDegrees || value >= 360 - primaryWindowDegrees) return 'New Moon';
  if (Math.abs(value - 90) <= primaryWindowDegrees) return 'First Quarter';
  if (Math.abs(value - 180) <= primaryWindowDegrees) return 'Full Moon';
  if (Math.abs(value - 270) <= primaryWindowDegrees) return 'Last Quarter';
  if (value < 90) return 'Waxing Crescent';
  if (value < 180) return 'Waxing Gibbous';
  if (value < 270) return 'Waning Gibbous';
  return 'Waning Crescent';
}

function adjacentPhaseLabels(left: MoonPhaseName, right: MoonPhaseName) {
  const leftIndex = MOON_PHASE_SEQUENCE.indexOf(left);
  const rightIndex = MOON_PHASE_SEQUENCE.indexOf(right);
  if (leftIndex < 0 || rightIndex < 0) return false;
  const distance = Math.abs(leftIndex - rightIndex);
  return distance === 1 || distance === MOON_PHASE_SEQUENCE.length - 1;
}

export function moonPhaseLabelMatches(input: {
  submittedPhase: unknown;
  submittedPhaseAngle: unknown;
  calculatedPhase: MoonPhaseName;
  calculatedPhaseAngle: number;
}) {
  const submittedPhase = clean(input.submittedPhase, 40) as MoonPhaseName;
  if (submittedPhase === input.calculatedPhase) return true;
  const submittedAngle = finite(input.submittedPhaseAngle);
  if (submittedAngle == null
    || !MOON_PHASE_SEQUENCE.includes(submittedPhase)
    || angularDistance(submittedAngle, input.calculatedPhaseAngle) > MOON_PHASE_LABEL_BOUNDARY_DRIFT_DEGREES
    || phaseForAngle(submittedAngle) !== submittedPhase
    || phaseForAngle(input.calculatedPhaseAngle) !== input.calculatedPhase) return false;
  return adjacentPhaseLabels(submittedPhase, input.calculatedPhase);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(parsed)
    && new Date(parsed).toISOString().slice(0, 10) === value
    && Number(value.slice(0, 4)) >= 1900
    && parsed <= Date.now() + 86_400_000;
}

function timezoneOffsetHours(timezone: string, date: string, time: string) {
  try {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    let guess = Date.UTC(year, month - 1, day, hour, minute);
    let offset: number | null = null;
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const zone = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'longOffset',
      }).formatToParts(new Date(guess)).find((part) => part.type === 'timeZoneName')?.value || '';
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
  const offset = timezoneOffsetHours(timezone, date, time);
  if (offset == null) return null;
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offset * 3_600_000);
}

export function moonLunarCurrentSnapshot(capturedAt: Date) {
  const angle = normalizeAngle(MoonPhase(capturedAt));
  const illumination = Illumination(Body.Moon, capturedAt).phase_fraction * 100;
  const longitude = normalizeAngle(EclipticGeoMoon(capturedAt).lon);
  const previousNew = SearchMoonPhase(0, capturedAt, -35);
  const nextQuarter = SearchMoonQuarter(new Date(capturedAt.getTime() + 1_000));
  if (!previousNew || !nextQuarter?.time?.date) return null;
  return {
    dateKey: capturedAt.toISOString().slice(0, 10),
    phase: phaseForAngle(angle),
    phaseAngle: rounded(angle),
    illumination: rounded(illumination, 2),
    age: rounded((capturedAt.getTime() - previousNew.date.getTime()) / 86_400_000, 3),
    moonLongitude: rounded(longitude),
    moonSign: signForLongitude(longitude),
    nextPhase: {
      name: QUARTER_NAMES[nextQuarter.quarter],
      at: nextQuarter.time.date.toISOString(),
    },
  };
}

function natalMoon(value: unknown) {
  const source = record(value);
  const date = clean(source.date, 16);
  const status = clean(source.status, 20) as 'exact' | 'approximate' | 'unknown';
  const submittedTime = clean(source.time, 8);
  const place = clean(source.place, 100);
  const timezone = clean(source.timezone, 80);
  if (!validDate(date)
    || !['exact', 'approximate', 'unknown'].includes(status)
    || !place
    || !/^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+\-]+)+)$/.test(timezone)
    || (status === 'unknown' ? Boolean(submittedTime) : !/^([01]\d|2[0-3]):[0-5]\d$/.test(submittedTime))) return null;

  const time = status === 'unknown' ? '12:00' : submittedTime;
  const instant = utcFromLocal(date, time, timezone);
  const start = utcFromLocal(date, '00:00', timezone);
  const end = utcFromLocal(date, '23:59', timezone);
  if (!instant || !start || !end) return null;
  const longitude = normalizeAngle(EclipticGeoMoon(instant).lon);
  const startLongitude = normalizeAngle(EclipticGeoMoon(start).lon);
  const endLongitude = normalizeAngle(EclipticGeoMoon(end).lon);
  const sign = signForLongitude(longitude);
  const possibleSigns = [...new Set([signForLongitude(startLongitude), signForLongitude(endLongitude)])];
  const ambiguous = status === 'unknown' && possibleSigns.length > 1;
  const confidence = status === 'exact'
    ? 'Exact birth time and timezone supplied; natal Moon sign and degree are calculated for that instant.'
    : status === 'approximate'
      ? 'Approximate birth time supplied; use the natal Moon sign while treating its exact degree and timing as approximate.'
      : ambiguous
        ? `Birth time is unknown and the Moon changed signs that date; preserve ${possibleSigns.join(' or ')} as the possible natal Moon range.`
        : `Birth time is unknown, but the Moon stayed in ${sign} throughout that date; the sign is stable while the exact degree remains approximate.`;
  return {
    birth: {
      date,
      time: status === 'unknown' ? null : submittedTime,
      status,
      place,
      timezone,
    },
    natalMoon: {
      longitude: rounded(longitude),
      sign,
      degree: rounded(longitude % 30),
      ambiguous,
      possibleSigns,
      startLongitude: rounded(startLongitude),
      endLongitude: rounded(endLongitude),
      confidence,
    },
  };
}

export function isMoonLunarFocus(value: unknown): value is MoonLunarFocus {
  return Object.hasOwn(MOON_LUNAR_FOCUSES, clean(value, 40).toLowerCase());
}

function canonicalSnapshot(value: unknown, options: { now?: Date; requireFresh: boolean; tier?: ReadingTier }) {
  const source = record(value);
  if (clean(source.version, 64) !== MOON_LUNAR_SNAPSHOT_VERSION) return null;
  const capturedAt = new Date(clean(source.capturedAt, 40));
  const capturedAtMs = capturedAt.getTime();
  const now = options.now || new Date();
  if (!Number.isFinite(capturedAtMs)
    || (options.requireFresh && Math.abs(now.getTime() - capturedAtMs) > MAX_SNAPSHOT_AGE_MS)) return null;

  const focus = clean(source.focus, 40).toLowerCase();
  const situation = clean(source.situation, 400);
  const packageTier = (options.tier || clean(source.packageTier, 20)) as ReadingTier;
  if (!isMoonLunarFocus(focus)
    || situation.length < 12
    || !Object.hasOwn(MOON_LUNAR_PACKAGE_SCOPE, packageTier)) return null;

  const calculatedCurrent = moonLunarCurrentSnapshot(capturedAt);
  const submittedCurrent = record(source.current);
  const submittedNext = record(submittedCurrent.nextPhase);
  const submittedPhaseAngle = finite(submittedCurrent.phaseAngle);
  const submittedIllumination = finite(submittedCurrent.illumination);
  const submittedAge = finite(submittedCurrent.age);
  const submittedLongitude = finite(submittedCurrent.moonLongitude);
  const submittedPhase = clean(submittedCurrent.phase, 40);
  const submittedNextAt = Date.parse(clean(submittedNext.at, 40));
  if (!calculatedCurrent
    || clean(submittedCurrent.dateKey, 16) !== calculatedCurrent.dateKey
    || submittedPhaseAngle == null || angularDistance(submittedPhaseAngle, calculatedCurrent.phaseAngle) > 15
    || !moonPhaseLabelMatches({
      submittedPhase,
      submittedPhaseAngle,
      calculatedPhase: calculatedCurrent.phase,
      calculatedPhaseAngle: calculatedCurrent.phaseAngle,
    })
    || submittedIllumination == null || Math.abs(submittedIllumination - calculatedCurrent.illumination) > 12
    || submittedAge == null || Math.abs(submittedAge - calculatedCurrent.age) > 1.5
    || clean(submittedCurrent.moonSign, 24) !== calculatedCurrent.moonSign
    || (submittedLongitude != null && angularDistance(submittedLongitude, calculatedCurrent.moonLongitude) > 2)
    || clean(submittedNext.name, 40) !== calculatedCurrent.nextPhase.name
    || !Number.isFinite(submittedNextAt)
    || Math.abs(submittedNextAt - Date.parse(calculatedCurrent.nextPhase.at)) > 4 * 60 * 60 * 1000) return null;

  const cardSource = record(source.card);
  const cardId = Number.parseInt(String(cardSource.id || ''), 10);
  const cardName = clean(cardSource.name, 80);
  if (!Number.isInteger(cardId)
    || cardId < 1
    || cardId > 22
    || LUNAR_CARD_NAMES[cardId - 1] !== cardName) return null;

  const natal = natalMoon(source.birth);
  if (!natal) return null;
  const scope = MOON_LUNAR_PACKAGE_SCOPE[packageTier];
  const canonicalPhase = submittedPhase as MoonPhaseName;
  return {
    version: MOON_LUNAR_SNAPSHOT_VERSION,
    capturedAt: capturedAt.toISOString(),
    focus,
    focusLabel: MOON_LUNAR_FOCUSES[focus].label,
    category: MOON_LUNAR_FOCUSES[focus].category,
    situation,
    packageTier,
    packageTitle: scope.title,
    coverageDays: scope.days,
    current: submittedPhase === calculatedCurrent.phase
      ? calculatedCurrent
      : {
        ...calculatedCurrent,
        // Preserve the cross-validated browser label/angle pair at the narrow
        // boundary so the signed snapshot remains self-verifying downstream.
        // Every other lunar field remains server authoritative.
        phase: canonicalPhase,
        phaseAngle: rounded(submittedPhaseAngle),
      },
    card: {
      id: cardId,
      name: cardName,
      orientation: 'Upright' as const,
      position: MOON_PHASE_CARD_POSITIONS[canonicalPhase],
    },
    ...natal,
  } satisfies SafeMoonLunarSnapshot;
}

export function buildMoonLunarSnapshot(input: {
  value: unknown;
  focus: unknown;
  question: unknown;
  tier: ReadingTier;
  now?: Date;
}) {
  const source = record(input.value);
  return canonicalSnapshot({
    ...source,
    focus: clean(input.focus, 40).toLowerCase(),
    situation: clean(input.question, 400),
    packageTier: input.tier,
  }, { now: input.now, requireFresh: true, tier: input.tier });
}

export function safeMoonLunarSnapshot(value: unknown) {
  return canonicalSnapshot(value, { requireFresh: false });
}

export function moonLunarEvidence(snapshot: SafeMoonLunarSnapshot) {
  const natal = snapshot.natalMoon.ambiguous
    ? `Natal Moon range: ${snapshot.natalMoon.possibleSigns.join(' or ')}`
    : `Natal Moon: ${snapshot.natalMoon.degree.toFixed(2)} degrees ${snapshot.natalMoon.sign}`;
  return [
    `Current Moon: ${snapshot.current.phase}, ${snapshot.current.illumination.toFixed(1)}% illuminated, ${snapshot.current.age.toFixed(1)} days old, in ${snapshot.current.moonSign}`,
    `Next primary phase: ${snapshot.current.nextPhase.name} at ${snapshot.current.nextPhase.at}`,
    natal,
    `Lunar card: ${snapshot.card.position}: ${snapshot.card.name} (Upright)`,
    `Selected focus: ${snapshot.focusLabel}`,
  ].join('; ');
}
