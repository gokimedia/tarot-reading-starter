export const BIRTH_CHART_PAGE = '/pages/birth-chart-calculator';
// v2 is the storefront's live, canonical checkout contract. Keep v1 readable
// for already-created carts and signed intents; both versions carry the same
// strictly validated birth-chart snapshot schema.
export const BIRTH_CHART_FUNNEL_VERSION = 'birth-chart-evidence-checkout-2026-08-v2';
export const BIRTH_CHART_LEGACY_FUNNEL_VERSIONS = Object.freeze([
  'birth-chart-evidence-checkout-2026-08-v1',
] as const);
export const BIRTH_CHART_SNAPSHOT_VERSION = 'birth-chart-snapshot-v1';

export const BIRTH_CHART_INTENTS = Object.freeze({
  self: Object.freeze({ label: 'Understand myself', category: 'personal' as const }),
  love: Object.freeze({ label: 'Love & relationships', category: 'love' as const }),
  career: Object.freeze({ label: 'Career & purpose', category: 'career' as const }),
  pattern: Object.freeze({ label: 'A repeating pattern', category: 'personal' as const }),
  current: Object.freeze({ label: 'What is changing now', category: 'personal' as const }),
  explore: Object.freeze({ label: 'Strongest chart theme', category: 'personal' as const }),
});

export type BirthChartIntent = keyof typeof BIRTH_CHART_INTENTS;
export type BirthTimeStatus = 'exact' | 'approximate' | 'unknown';

export const BIRTH_CHART_PACKAGE_SCOPE = Object.freeze({
  standard: Object.freeze({
    title: 'Focused Chart Answer',
    instruction: 'Answer the exact question through four to six relevant chart factors, name the central pattern, and give one practical way to work with it.',
  }),
  medium: Object.freeze({
    title: 'Core Natal Reading',
    instruction: 'Integrate the Sun, Moon and Rising when available, the chart ruler when supported, the strongest reliable aspects, and the selected life-area chapter. Explain strengths, tensions and a grounded growth direction.',
  }),
  premium: Object.freeze({
    title: 'Full Birth Chart Reading',
    instruction: 'Connect the complete supplied natal chart into one coherent story across identity, emotions, relationships, career and purpose. Use the supplied planets, Whole Sign houses and reliable aspects, then finish with practical integration.',
  }),
});

const PLANETS = Object.freeze({
  Sun: 'Sun',
  Moon: 'Moon',
  Mercury: 'Mercury',
  Venus: 'Venus',
  Mars: 'Mars',
  Jupiter: 'Jupiter',
  Saturn: 'Saturn',
  Uranus: 'Uranus',
  Neptune: 'Neptune',
  Pluto: 'Pluto',
  NorthNode: 'North Node',
} as const);

const PLANET_KEYS = Object.freeze(Object.keys(PLANETS) as Array<keyof typeof PLANETS>);
const SIGNS = Object.freeze([
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
] as const);
const ELEMENTS = Object.freeze(['Fire', 'Earth', 'Air', 'Water'] as const);
const MODALITIES = Object.freeze(['Cardinal', 'Fixed', 'Mutable'] as const);
const SIGN_ELEMENT = Object.freeze(['Fire', 'Earth', 'Air', 'Water', 'Fire', 'Earth', 'Air', 'Water', 'Fire', 'Earth', 'Air', 'Water'] as const);
const SIGN_MODALITY = Object.freeze(['Cardinal', 'Fixed', 'Mutable', 'Cardinal', 'Fixed', 'Mutable', 'Cardinal', 'Fixed', 'Mutable', 'Cardinal', 'Fixed', 'Mutable'] as const);
const ASPECT_ANGLES = Object.freeze({ conjunction: 0, sextile: 60, square: 90, trine: 120, opposition: 180 } as const);
const ASPECT_ORBS = Object.freeze({ conjunction: 8, sextile: 5, square: 7, trine: 7, opposition: 8 } as const);
const TIME_SENSITIVE_UNKNOWN_KEYS = new Set(['Moon', 'Mercury', 'Venus', 'Mars']);
const TRANSITING_PLANETS = new Set(['Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']);

type JsonObject = Record<string, unknown>;

export type SafeBirthChartSnapshot = {
  version: typeof BIRTH_CHART_SNAPSHOT_VERSION;
  focus: BirthChartIntent;
  focusLabel: string;
  birth: {
    date: string;
    time: string | null;
    status: BirthTimeStatus;
    place: {
      name: string;
      region: string;
      country: string;
      latitude: number;
      longitude: number;
      timezone: string;
    };
  };
  systems: { zodiac: 'Western Tropical'; houses: 'Whole Sign' };
  angles: { ascendant: number | null; midheaven: number | null };
  placements: Array<{
    key: keyof typeof PLANETS;
    name: string;
    longitude: number;
    sign: typeof SIGNS[number];
    degree: number;
    house: number | null;
    retrograde: boolean;
    ambiguous: boolean;
    possibleSigns: typeof SIGNS[number][];
  }>;
  aspects: Array<{
    first: keyof typeof PLANETS;
    second: keyof typeof PLANETS;
    type: keyof typeof ASPECT_ANGLES;
    orb: number;
  }>;
  balance: {
    elements: Record<typeof ELEMENTS[number], number>;
    modalities: Record<typeof MODALITIES[number], number>;
    dominantElement: typeof ELEMENTS[number];
    dominantModality: typeof MODALITIES[number];
  };
  currentTransit: null | {
    moving: string;
    natal: keyof typeof PLANETS;
    type: keyof typeof ASPECT_ANGLES;
    orb: number;
    longitude?: number;
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

function longitude(value: unknown) {
  const number = finite(value);
  return number != null && number >= 0 && number < 360 ? rounded(number, 6) : null;
}

function signIndex(value: number) {
  return Math.floor(((value % 360) + 360) % 360 / 30);
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
    && year >= 1800
    && timestamp <= Date.now() + 86_400_000;
}

function dominant<T extends string>(values: Record<T, number>, order: readonly T[]) {
  return order.reduce((winner, value) => values[value] > values[winner] ? value : winner, order[0]);
}

export function isBirthChartIntent(value: unknown): value is BirthChartIntent {
  return Object.hasOwn(BIRTH_CHART_INTENTS, clean(value, 40).toLowerCase());
}

export function isSupportedBirthChartFunnelVersion(value: unknown) {
  const version = clean(value, 128);
  return version === BIRTH_CHART_FUNNEL_VERSION
    || BIRTH_CHART_LEGACY_FUNNEL_VERSIONS.includes(
      version as typeof BIRTH_CHART_LEGACY_FUNNEL_VERSIONS[number],
    );
}

export function safeBirthChartSnapshot(value: unknown): SafeBirthChartSnapshot | null {
  const source = record(value);
  const version = clean(source.version, 64);
  const focus = clean(source.focus, 40).toLowerCase();
  if (version !== BIRTH_CHART_SNAPSHOT_VERSION || !isBirthChartIntent(focus)) return null;

  const birthSource = record(source.birth);
  const status = clean(birthSource.status, 20) as BirthTimeStatus;
  const date = clean(birthSource.date, 16);
  const time = clean(birthSource.time, 8);
  if (!['exact', 'approximate', 'unknown'].includes(status)
    || !validBirthDate(date)
    || (status === 'unknown' ? Boolean(time) : !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return null;

  const placeSource = record(birthSource.place);
  const latitude = finite(placeSource.latitude);
  const placeLongitude = finite(placeSource.longitude);
  const timezone = clean(placeSource.timezone, 80);
  const placeName = clean(placeSource.name, 100);
  if (!placeName
    || latitude == null || latitude < -90 || latitude > 90
    || placeLongitude == null || placeLongitude < -180 || placeLongitude > 180
    || !/^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+\-]+)+)$/.test(timezone)) return null;

  const systems = record(source.systems);
  if (clean(systems.zodiac, 40) !== 'Western Tropical' || clean(systems.houses, 40) !== 'Whole Sign') return null;

  const rawPlacements = Array.isArray(source.placements) ? source.placements : [];
  if (rawPlacements.length !== PLANET_KEYS.length) return null;
  const placements: SafeBirthChartSnapshot['placements'] = [];
  const placementByKey = new Map<keyof typeof PLANETS, SafeBirthChartSnapshot['placements'][number]>();
  for (const entry of rawPlacements) {
    const planet = record(entry);
    const key = clean(planet.key, 24) as keyof typeof PLANETS;
    const lon = longitude(planet.longitude);
    const houseRaw = planet.house == null || planet.house === '' ? null : Number(planet.house);
    const ambiguous = planet.ambiguous === true;
    if (!Object.hasOwn(PLANETS, key)
      || placementByKey.has(key)
      || lon == null
      || (status === 'unknown' ? houseRaw != null : !Number.isInteger(houseRaw) || Number(houseRaw) < 1 || Number(houseRaw) > 12)
      || (ambiguous && (status !== 'unknown' || !TIME_SENSITIVE_UNKNOWN_KEYS.has(key)))) return null;

    const index = signIndex(lon);
    const possibleSigns: typeof SIGNS[number][] = [SIGNS[index]];
    if (ambiguous) {
      const start = longitude(planet.startLongitude);
      const end = longitude(planet.endLongitude);
      if (start == null || end == null || signIndex(start) === signIndex(end)) return null;
      possibleSigns.splice(0, possibleSigns.length, SIGNS[signIndex(start)], SIGNS[signIndex(end)]);
    }
    const sanitized = {
      key,
      name: PLANETS[key],
      longitude: lon,
      sign: SIGNS[index],
      degree: rounded(lon % 30, 4),
      house: status === 'unknown' ? null : Number(houseRaw),
      retrograde: planet.retrograde === true,
      ambiguous,
      possibleSigns: [...new Set(possibleSigns)],
    };
    placements.push(sanitized);
    placementByKey.set(key, sanitized);
  }
  if (PLANET_KEYS.some((key) => !placementByKey.has(key))) return null;

  const angles = record(source.angles);
  const ascendant = angles.ascendant == null ? null : longitude(angles.ascendant);
  const midheaven = angles.midheaven == null ? null : longitude(angles.midheaven);
  if ((status === 'unknown' && (ascendant != null || midheaven != null))
    || (status !== 'unknown' && (ascendant == null || midheaven == null))) return null;

  const aspects: SafeBirthChartSnapshot['aspects'] = [];
  const rawAspects = Array.isArray(source.aspects) ? source.aspects.slice(0, 20) : [];
  for (const entry of rawAspects) {
    const aspect = record(entry);
    const first = clean(aspect.first, 24) as keyof typeof PLANETS;
    const second = clean(aspect.second, 24) as keyof typeof PLANETS;
    const type = clean(aspect.type, 24).toLowerCase() as keyof typeof ASPECT_ANGLES;
    const firstPlacement = placementByKey.get(first);
    const secondPlacement = placementByKey.get(second);
    if (!firstPlacement || !secondPlacement || first === second || !Object.hasOwn(ASPECT_ANGLES, type)) return null;
    if (status === 'unknown' && (first === 'Moon' || second === 'Moon' || firstPlacement.ambiguous || secondPlacement.ambiguous)) continue;
    const computedOrb = Math.abs(angularDistance(firstPlacement.longitude, secondPlacement.longitude) - ASPECT_ANGLES[type]);
    const submittedOrb = finite(aspect.orb);
    if (computedOrb > ASPECT_ORBS[type] || submittedOrb == null || Math.abs(computedOrb - submittedOrb) > 0.2) return null;
    aspects.push({ first, second, type, orb: rounded(computedOrb, 2) });
  }
  aspects.sort((left, right) => left.orb - right.orb);

  const elementCounts = { Fire: 0, Earth: 0, Air: 0, Water: 0 };
  const modalityCounts = { Cardinal: 0, Fixed: 0, Mutable: 0 };
  for (const placement of placements) {
    const weight = placement.key === 'Sun' || placement.key === 'Moon' ? 2 : 1;
    const index = signIndex(placement.longitude);
    elementCounts[SIGN_ELEMENT[index]] += weight;
    modalityCounts[SIGN_MODALITY[index]] += weight;
  }

  let currentTransit: SafeBirthChartSnapshot['currentTransit'] = null;
  if (source.currentTransit != null) {
    const transit = record(source.currentTransit);
    const moving = clean(transit.moving, 24);
    const natal = clean(transit.natal, 24) as keyof typeof PLANETS;
    const type = clean(transit.type, 24).toLowerCase() as keyof typeof ASPECT_ANGLES;
    const movingLongitude = longitude(transit.longitude);
    const submittedOrb = finite(transit.orb);
    const natalPlacement = placementByKey.get(natal);
    if (!TRANSITING_PLANETS.has(moving)
      || !natalPlacement
      || natalPlacement.ambiguous
      || movingLongitude == null
      || !Object.hasOwn(ASPECT_ANGLES, type)
      || submittedOrb == null) return null;
    const computedOrb = Math.abs(angularDistance(movingLongitude, natalPlacement.longitude) - ASPECT_ANGLES[type]);
    if (computedOrb > 2.5 || Math.abs(computedOrb - submittedOrb) > 0.2) return null;
    currentTransit = {
      moving,
      natal,
      type,
      orb: rounded(computedOrb, 2),
      longitude: movingLongitude,
    };
  }

  const snapshot: SafeBirthChartSnapshot = {
    version: BIRTH_CHART_SNAPSHOT_VERSION,
    focus,
    focusLabel: BIRTH_CHART_INTENTS[focus].label,
    birth: {
      date,
      time: status === 'unknown' ? null : time,
      status,
      place: {
        name: placeName,
        region: clean(placeSource.region, 100),
        country: clean(placeSource.country, 100),
        latitude: rounded(latitude, 6),
        longitude: rounded(placeLongitude, 6),
        timezone,
      },
    },
    systems: { zodiac: 'Western Tropical', houses: 'Whole Sign' },
    angles: { ascendant, midheaven },
    placements,
    aspects: aspects.slice(0, 16),
    balance: {
      elements: elementCounts,
      modalities: modalityCounts,
      dominantElement: dominant(elementCounts, ELEMENTS),
      dominantModality: dominant(modalityCounts, MODALITIES),
    },
    currentTransit,
  };
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <= 8_192 ? snapshot : null;
}

function hydrateSignedPersistedAmbiguities(source: JsonObject): JsonObject | null {
  const placements = Array.isArray(source.placements) ? source.placements : [];
  const hydrated: JsonObject[] = [];
  for (const entry of placements) {
    const placement = record(entry);
    if (placement.ambiguous !== true) {
      hydrated.push(placement);
      continue;
    }

    const possibleSigns = Array.isArray(placement.possibleSigns)
      ? placement.possibleSigns.map((value) => clean(value, 20))
      : [];
    const firstIndex = SIGNS.indexOf(possibleSigns[0] as typeof SIGNS[number]);
    const secondIndex = SIGNS.indexOf(possibleSigns[1] as typeof SIGNS[number]);
    const submittedLongitude = longitude(placement.longitude);
    const submittedSign = clean(placement.sign, 20);
    const adjacent = firstIndex >= 0 && secondIndex >= 0
      && (Math.abs(firstIndex - secondIndex) === 1 || Math.abs(firstIndex - secondIndex) === SIGNS.length - 1);
    if (possibleSigns.length !== 2
      || firstIndex === secondIndex
      || !adjacent
      || submittedLongitude == null
      || SIGNS[signIndex(submittedLongitude)] !== submittedSign
      || !possibleSigns.includes(submittedSign)) return null;

    // The first sanitizer persisted the verified possible signs but omitted
    // the raw range endpoints. Recreate interior points for the strict
    // sanitizer; the signed canonical signs remain the source of truth.
    hydrated.push({
      ...placement,
      startLongitude: firstIndex * 30 + 15,
      endLongitude: secondIndex * 30 + 15,
    });
  }
  return { ...source, placements: hydrated };
}

/**
 * Accepts canonical birth-chart fields that the old sanitizer itself
 * persisted without their raw reconstruction inputs: ambiguous-placement
 * range endpoints and, in an older shape, current-transit longitude. This
 * must only be used after both the snapshot hash and checkout-intent
 * signatures have been verified. Untrusted checkout input must continue to
 * use safeBirthChartSnapshot.
 */
export function safeSignedPersistedBirthChartSnapshot(
  value: unknown,
  options: { integrityVerified: boolean },
): SafeBirthChartSnapshot | null {
  const strict = safeBirthChartSnapshot(value);
  if (strict) return strict;
  if (!options?.integrityVerified) return null;

  const source = hydrateSignedPersistedAmbiguities(record(value));
  if (!source) return null;
  const transit = record(source.currentTransit);
  if (source.currentTransit == null || Object.hasOwn(transit, 'longitude')) {
    return safeBirthChartSnapshot(source);
  }
  const transitKeys = Object.keys(transit);
  if (transitKeys.length !== 4
    || !transitKeys.every((key) => ['moving', 'natal', 'type', 'orb'].includes(key))
    || typeof transit.moving !== 'string'
    || typeof transit.natal !== 'string'
    || typeof transit.type !== 'string'
    || typeof transit.orb !== 'number') return null;

  const withoutTransit = { ...source, currentTransit: null };
  const base = safeBirthChartSnapshot(withoutTransit);
  if (!base) return null;

  const moving = clean(transit.moving, 24);
  const natal = clean(transit.natal, 24) as keyof typeof PLANETS;
  const type = clean(transit.type, 24).toLowerCase() as keyof typeof ASPECT_ANGLES;
  const submittedOrb = finite(transit.orb);
  const natalPlacement = base.placements.find((placement) => placement.key === natal);
  if (!TRANSITING_PLANETS.has(moving)
    || !natalPlacement
    || natalPlacement.ambiguous
    || !Object.hasOwn(ASPECT_ANGLES, type)
    || submittedOrb == null
    || submittedOrb < 0
    || submittedOrb > 2.5
    || rounded(submittedOrb, 2) !== submittedOrb) return null;

  const recovered: SafeBirthChartSnapshot = {
    ...base,
    currentTransit: { moving, natal, type, orb: submittedOrb },
  };
  return new TextEncoder().encode(JSON.stringify(recovered)).byteLength <= 8_192 ? recovered : null;
}

function degreeLabel(value: number) {
  const degree = Math.floor(value % 30);
  const minutes = Math.round(((value % 30) - degree) * 60);
  return `${degree}°${String(minutes === 60 ? 0 : minutes).padStart(2, '0')}′`;
}

export function birthChartEvidence(snapshot: SafeBirthChartSnapshot) {
  const placements = snapshot.placements.map((placement) => {
    const sign = placement.ambiguous ? placement.possibleSigns.join(' or ') : `${degreeLabel(placement.longitude)} ${placement.sign}`;
    const house = placement.house ? `, ${placement.house}H` : '';
    return `${placement.name}: ${sign}${house}${placement.retrograde ? ', retrograde' : ''}`;
  }).join('; ');
  const aspects = snapshot.aspects.map((aspect) => (
    `${PLANETS[aspect.first]} ${aspect.type} ${PLANETS[aspect.second]} (${aspect.orb.toFixed(2)}° orb)`
  )).join('; ');
  const angles = snapshot.birth.status === 'unknown'
    ? 'Ascendant, Midheaven and houses were not calculated because birth time is unknown.'
    : `Ascendant ${degreeLabel(snapshot.angles.ascendant as number)} ${SIGNS[signIndex(snapshot.angles.ascendant as number)]}; Midheaven ${degreeLabel(snapshot.angles.midheaven as number)} ${SIGNS[signIndex(snapshot.angles.midheaven as number)]}.`;
  const transit = snapshot.currentTransit
    ? `Current transit evidence captured at checkout: ${snapshot.currentTransit.moving} ${snapshot.currentTransit.type} natal ${PLANETS[snapshot.currentTransit.natal]} (${snapshot.currentTransit.orb.toFixed(2)}° orb). No timing windows or exact dates were supplied, so do not invent them.`
    : snapshot.focus === 'current'
      ? 'No qualifying current transit was supplied. Do not claim current timing or invent transit dates; answer only as a natal pattern asking for attention.'
      : '';
  return [
    `Verified deterministic natal chart. Focus: ${snapshot.focusLabel}.`,
    `Birth time confidence: ${snapshot.birth.status}. Birthplace: ${snapshot.birth.place.name}${snapshot.birth.place.region ? `, ${snapshot.birth.place.region}` : ''}, ${snapshot.birth.place.country}; historical timezone ${snapshot.birth.place.timezone}.`,
    `Western Tropical Zodiac; Whole Sign houses. ${angles}`,
    `Placements: ${placements}.`,
    `Reliable major aspects: ${aspects || 'none supplied'}.`,
    `Chart balance: ${snapshot.balance.dominantElement} dominant, ${snapshot.balance.dominantModality} dominant.`,
    transit,
  ].filter(Boolean).join(' ');
}

/**
 * Stable label/value rows consumed by the paid-reading evidence validator.
 * Every value comes from the already-sanitized snapshot; the full degree,
 * house, aspect and limitation detail remains in birthChartEvidence().
 */
export function birthChartQueueSignals(snapshot: SafeBirthChartSnapshot) {
  const placementRow = (key: keyof typeof PLANETS, label: string) => {
    const placement = snapshot.placements.find((entry) => entry.key === key);
    if (!placement) return `${label}: not supplied`;
    const position = placement.ambiguous
      ? placement.possibleSigns.join(' or ')
      : `${placement.longitude.toFixed(2)}° ${placement.sign}`;
    return `${label}: ${position}${placement.house ? `, ${placement.house}H` : ''}`;
  };
  const rising = snapshot.birth.status === 'unknown'
    ? 'not calculated because birth time is unknown'
    : `verified in the closed chart evidence (${snapshot.birth.status} birth time)`;
  const aspects = snapshot.aspects.map((aspect) => (
    `${aspect.first} ${aspect.type} ${aspect.second} · ${aspect.orb.toFixed(2)}° orb`
  )).join(', ');
  return [
    placementRow('Sun', 'Sun'),
    placementRow('Moon', 'Moon'),
    `Rising: ${rising}`,
    `Dominant element: ${snapshot.balance.dominantElement}`,
    `Dominant modality: ${snapshot.balance.dominantModality}`,
    `Reliable major aspects: ${aspects || 'none supplied'}`,
  ].join('; ');
}
