import {
  NUMEROLOGY_FUNNEL_VERSION,
  calculateCompatibilityScore,
  calculateLifePath,
  calculateNameNumbers,
  calculatePatternDimensions,
} from './numerology-compatibility-order.mjs';
import type { ReadingTier } from './reading-products';

export const NUMEROLOGY_COMPATIBILITY_PAGE = '/pages/numerology-calculator';
export const NUMEROLOGY_COMPATIBILITY_FUNNEL_VERSION = NUMEROLOGY_FUNNEL_VERSION;
export const NUMEROLOGY_COMPATIBILITY_SNAPSHOT_VERSION = 'numerology-compatibility-snapshot-v1';

export const NUMEROLOGY_CONNECTIONS = Object.freeze({
  romantic_partner: 'Romantic partner',
  new_connection: 'Crush or someone new',
  ex_unresolved: 'Ex or unresolved connection',
  friend: 'Friend',
  family: 'Family',
  business_partner: 'Business partner',
} as const);

export const NUMEROLOGY_COMPATIBILITY_FOCUSES = Object.freeze({
  attraction: 'Attraction and chemistry',
  communication: 'Communication style',
  emotional_needs: 'Emotional needs',
  long_term_potential: 'Long-term potential',
  recurring_conflict: 'Recurring conflict',
  best_next_step: 'Best next step',
  date_pair: 'Date-based pair only',
} as const);

export const NUMEROLOGY_PREMIUM_FOCUSES = Object.freeze({
  emotional_needs: 'What each person needs emotionally',
  conflict_pattern: 'Why the same conflict keeps returning',
  long_term_direction: 'What supports long-term potential',
  next_12_months: 'How the next 12 months affect the connection',
  best_next_step: 'The most useful next step now',
} as const);

export const NUMEROLOGY_COMPATIBILITY_PACKAGE_SCOPE = Object.freeze({
  standard: Object.freeze({
    title: 'Essential Life Path Pair',
    instruction: 'Use both verified Life Paths and the exact question. Include one core strength, one friction point and a practical 7-day experiment.',
  }),
  medium: Object.freeze({
    title: 'Full Relationship Numerology',
    instruction: 'Use both verified Life Paths, Expression and Soul Urge numbers. Cover emotional needs, communication, the recurring conflict loop, repair and a 7-day plan.',
  }),
  premium: Object.freeze({
    title: 'Complete Relationship Cycle',
    instruction: 'Add Personality and Birthday numbers, the rolling 12-month timing cycle, long-term pressure points, both perspectives and a practical 30-day plan.',
  }),
} as const);

type JsonObject = Record<string, unknown>;
type ConnectionKey = keyof typeof NUMEROLOGY_CONNECTIONS;
type CompatibilityFocusKey = keyof typeof NUMEROLOGY_COMPATIBILITY_FOCUSES;
type PremiumFocusKey = keyof typeof NUMEROLOGY_PREMIUM_FOCUSES;

function record(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function clean(value: unknown, maximum = 400) {
  return String(value ?? '')
    .trim()
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, maximum);
}

function birthDate(value: unknown) {
  const normalized = clean(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

function exactInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

export function safeNumerologyCompatibilitySnapshot(value: unknown, tier: ReadingTier) {
  try {
    const source = record(value);
    if (clean(source.version, 80) !== NUMEROLOGY_COMPATIBILITY_SNAPSHOT_VERSION) return null;
    const connectionType = clean(source.connectionType, 40) as ConnectionKey;
    const compatibilityFocus = clean(source.compatibilityFocus, 40) as CompatibilityFocusKey;
    const premiumFocus = clean(source.premiumFocus, 40) as PremiumFocusKey;
    if (!Object.hasOwn(NUMEROLOGY_CONNECTIONS, connectionType)
      || !Object.hasOwn(NUMEROLOGY_COMPATIBILITY_FOCUSES, compatibilityFocus)
      || !Object.hasOwn(NUMEROLOGY_PREMIUM_FOCUSES, premiumFocus)) return null;

    const personAInput = record(source.personA);
    const personBInput = record(source.personB);
    const personABirthDate = birthDate(personAInput.birthDate);
    const personBBirthDate = birthDate(personBInput.birthDate);
    if (!personABirthDate || !personBBirthDate) return null;

    const personALifePath = calculateLifePath(personABirthDate);
    const personBLifePath = calculateLifePath(personBBirthDate);
    const score = calculateCompatibilityScore(personALifePath, personBLifePath);
    const dimensions = calculatePatternDimensions(personALifePath, personBLifePath, score);
    const claimedDimensions = record(source.dimensions);
    const claimedLifePathA = exactInteger(personAInput.lifePath);
    const claimedLifePathB = exactInteger(personBInput.lifePath);
    const claimedScore = exactInteger(source.score);
    if (claimedLifePathA !== personALifePath || claimedLifePathB !== personBLifePath || claimedScore !== score
      || Object.entries(dimensions).some(([key, expected]) => exactInteger(claimedDimensions[key]) !== expected)) return null;

    const fullBirthNameA = clean(personAInput.fullBirthName, 120);
    const fullBirthNameB = clean(personBInput.fullBirthName, 120);
    const namesRequired = tier !== 'standard';
    if (namesRequired && (!fullBirthNameA || !fullBirthNameB)) return null;
    const nameNumbersA = fullBirthNameA ? calculateNameNumbers(fullBirthNameA) : null;
    const nameNumbersB = fullBirthNameB ? calculateNameNumbers(fullBirthNameB) : null;
    const question = clean(source.question, 400);
    if (question.length < 6) return null;

    return {
      version: NUMEROLOGY_COMPATIBILITY_SNAPSHOT_VERSION,
      packageTier: tier,
      connectionType,
      connectionLabel: NUMEROLOGY_CONNECTIONS[connectionType],
      compatibilityFocus,
      compatibilityFocusLabel: NUMEROLOGY_COMPATIBILITY_FOCUSES[compatibilityFocus],
      premiumFocus,
      premiumFocusLabel: NUMEROLOGY_PREMIUM_FOCUSES[premiumFocus],
      question,
      personA: {
        birthDate: personABirthDate,
        firstName: clean(personAInput.firstName, 40),
        fullBirthName: fullBirthNameA,
        lifePath: personALifePath,
        nameNumbers: nameNumbersA,
      },
      personB: {
        birthDate: personBBirthDate,
        firstName: clean(personBInput.firstName, 40),
        fullBirthName: fullBirthNameB,
        lifePath: personBLifePath,
        nameNumbers: nameNumbersB,
      },
      score,
      dimensions,
    };
  } catch {
    return null;
  }
}

export type NumerologyCompatibilitySnapshot = NonNullable<ReturnType<typeof safeNumerologyCompatibilitySnapshot>>;

export function numerologyCompatibilityEvidence(snapshot: NumerologyCompatibilitySnapshot) {
  const scope = NUMEROLOGY_COMPATIBILITY_PACKAGE_SCOPE[snapshot.packageTier];
  const names = snapshot.personA.nameNumbers && snapshot.personB.nameNumbers
    ? ` Name numbers recalculated: Person A Expression ${snapshot.personA.nameNumbers.expression}, Soul Urge ${snapshot.personA.nameNumbers.soulUrge}; Person B Expression ${snapshot.personB.nameNumbers.expression}, Soul Urge ${snapshot.personB.nameNumbers.soulUrge}.`
    : '';
  return `Verified pair: Life Path ${snapshot.personA.lifePath} + ${snapshot.personB.lifePath}; score ${snapshot.score}/100. Connection: ${snapshot.connectionLabel}. Main concern: ${snapshot.compatibilityFocusLabel}. Paid focus: ${snapshot.premiumFocusLabel}.${names} Package: ${scope.title}.`;
}
