import type { ReadingTier } from '@/lib/reading-products';

export const ZODIAC_COMPATIBILITY_PAGE = '/pages/zodiac-compatibility';
export const ZODIAC_COMPATIBILITY_FUNNEL_VERSION = 'zodiac-context-checkout-2026-08-v1';
export const ZODIAC_COMPATIBILITY_SNAPSHOT_VERSION = 'zodiac-compatibility-snapshot-v1';

export const ZODIAC_RELATIONSHIP_STAGES = Object.freeze({
  new_crush: 'We just met / new crush',
  dating: 'We are dating',
  relationship: 'We are in a relationship',
  on_off: 'We keep breaking up and reconnecting',
  apart: 'We are currently apart',
  friendship: 'Friendship',
  work_family: 'Work or family',
} as const);

export const ZODIAC_RELATIONSHIP_FOCUSES = Object.freeze({
  attraction: 'Attraction & chemistry',
  communication: 'Communication',
  trust: 'Trust',
  emotional_closeness: 'Emotional closeness',
  commitment: 'Commitment & long-term potential',
  recurring_conflict: 'A recurring conflict',
} as const);

export const ZODIAC_COMPATIBILITY_PACKAGE_SCOPE = Object.freeze({
  standard: Object.freeze({
    title: 'One Question Relationship Reading',
    instruction: 'Answer the exact relationship question, explain the main score pattern, identify the deciding condition, and give one practical next step within the customer\'s control.',
  }),
  medium: Object.freeze({
    title: 'Complete Relationship Pattern Reading',
    instruction: 'Cover attraction, communication, emotional needs, trust, the recurring conflict pattern, long-term conditions, and three practical next steps grounded in the supplied context.',
  }),
  premium: Object.freeze({
    title: 'In-Depth Relationship Plan',
    instruction: 'Provide a full Sun-sign relationship-pattern synthesis, reconcile contradictory scores, test realistic alternatives, name decision safeguards, and end with a practical 30-day plan. Do not call this full synastry or invent unsupplied birth-chart placements.',
  }),
} satisfies Record<ReadingTier, { title: string; instruction: string }>);

const SIGNS = Object.freeze([
  Object.freeze({ name: 'Aries', element: 'Fire', modality: 'Cardinal' }),
  Object.freeze({ name: 'Taurus', element: 'Earth', modality: 'Fixed' }),
  Object.freeze({ name: 'Gemini', element: 'Air', modality: 'Mutable' }),
  Object.freeze({ name: 'Cancer', element: 'Water', modality: 'Cardinal' }),
  Object.freeze({ name: 'Leo', element: 'Fire', modality: 'Fixed' }),
  Object.freeze({ name: 'Virgo', element: 'Earth', modality: 'Mutable' }),
  Object.freeze({ name: 'Libra', element: 'Air', modality: 'Cardinal' }),
  Object.freeze({ name: 'Scorpio', element: 'Water', modality: 'Fixed' }),
  Object.freeze({ name: 'Sagittarius', element: 'Fire', modality: 'Mutable' }),
  Object.freeze({ name: 'Capricorn', element: 'Earth', modality: 'Cardinal' }),
  Object.freeze({ name: 'Aquarius', element: 'Air', modality: 'Fixed' }),
  Object.freeze({ name: 'Pisces', element: 'Water', modality: 'Mutable' }),
] as const);

const SUN_CUTOFFS = Object.freeze([20, 19, 20, 20, 21, 21, 22, 23, 23, 23, 22, 21] as const);
const MONTH_START_SIGN_INDEX = Object.freeze([9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8] as const);
const SCORE_KEYS = Object.freeze(['love', 'communication', 'trust', 'emotion'] as const);

type JsonObject = Record<string, unknown>;
type ScoreKey = typeof SCORE_KEYS[number];
type ZodiacSign = typeof SIGNS[number];
export type ZodiacRelationshipStage = keyof typeof ZODIAC_RELATIONSHIP_STAGES;
export type ZodiacRelationshipFocus = keyof typeof ZODIAC_RELATIONSHIP_FOCUSES;

export type ZodiacCompatibilityScores = {
  love: number;
  communication: number;
  trust: number;
  emotion: number;
  overall: number;
};

export type SafeZodiacCompatibilitySnapshot = {
  version: typeof ZODIAC_COMPATIBILITY_SNAPSHOT_VERSION;
  personA: { month: number; day: number; sign: ZodiacSign['name'] };
  personB: { month: number; day: number; sign: ZodiacSign['name'] };
  scores: ZodiacCompatibilityScores;
  strongest: ScoreKey;
  needsCare: ScoreKey;
  relationshipStage: ZodiacRelationshipStage;
  relationshipStageLabel: string;
  focus: ZodiacRelationshipFocus;
  focusLabel: string;
  question: string;
};

function record(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function clean(value: unknown, maximum: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function validMonthDay(month: number, day: number) {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day)) return false;
  const maximum = month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day >= 1 && day <= maximum;
}

export function zodiacSignForBirthday(monthValue: unknown, dayValue: unknown): ZodiacSign | null {
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!validMonthDay(month, day)) return null;
  const startIndex = MONTH_START_SIGN_INDEX[month - 1];
  return SIGNS[day <= SUN_CUTOFFS[month - 1] ? startIndex : (startIndex + 1) % SIGNS.length];
}

export function zodiacCompatibilityScores(first: ZodiacSign, second: ZodiacSign): ZodiacCompatibilityScores {
  const firstIndex = SIGNS.findIndex((sign) => sign.name === first.name);
  const secondIndex = SIGNS.findIndex((sign) => sign.name === second.name);
  let difference = Math.abs(firstIndex - secondIndex);
  if (difference > 6) difference = 12 - difference;

  let base = { love: 50, communication: 50, trust: 50, emotion: 50 };
  if (difference === 0) base = { love: 85, communication: 90, trust: 85, emotion: 80 };
  else if (difference === 1) base = { love: 55, communication: 60, trust: 55, emotion: 50 };
  else if (difference === 2) base = { love: 80, communication: 85, trust: 75, emotion: 70 };
  else if (difference === 3) base = { love: 45, communication: 50, trust: 50, emotion: 55 };
  else if (difference === 4) base = { love: 85, communication: 80, trust: 80, emotion: 85 };
  else if (difference === 5) base = { love: 40, communication: 45, trust: 50, emotion: 45 };
  else if (difference === 6) base = { love: 75, communication: 65, trust: 60, emotion: 70 };

  if (first.element === second.element) {
    base.love += 10;
    base.emotion += 10;
    base.trust += 5;
  }
  if ((first.element === 'Fire' && second.element === 'Air') || (first.element === 'Air' && second.element === 'Fire')) {
    base.communication += 10;
    base.love += 5;
  }
  if ((first.element === 'Earth' && second.element === 'Water') || (first.element === 'Water' && second.element === 'Earth')) {
    base.emotion += 10;
    base.trust += 5;
  }
  if (first.modality === second.modality && difference !== 0) {
    base.communication += 5;
    base.trust += 5;
  }
  if ((first.modality === 'Cardinal' && second.modality === 'Fixed') || (first.modality === 'Fixed' && second.modality === 'Cardinal')) {
    base.trust -= 5;
  }
  if ((first.modality === 'Cardinal' && second.modality === 'Mutable') || (first.modality === 'Mutable' && second.modality === 'Cardinal')) {
    base.communication += 5;
  }

  const scores = {
    love: Math.max(20, Math.min(99, base.love)),
    communication: Math.max(20, Math.min(99, base.communication)),
    trust: Math.max(20, Math.min(99, base.trust)),
    emotion: Math.max(20, Math.min(99, base.emotion)),
    overall: 0,
  };
  scores.overall = Math.round((scores.love + scores.communication + scores.trust + scores.emotion) / 4);
  return scores;
}

function scoreExtreme(scores: ZodiacCompatibilityScores, direction: 'high' | 'low') {
  return SCORE_KEYS.reduce((selected, key) => {
    if (direction === 'high' && scores[key] > scores[selected]) return key;
    if (direction === 'low' && scores[key] < scores[selected]) return key;
    return selected;
  }, SCORE_KEYS[0]);
}

export function isZodiacRelationshipStage(value: unknown): value is ZodiacRelationshipStage {
  return Object.hasOwn(ZODIAC_RELATIONSHIP_STAGES, clean(value, 40).toLowerCase());
}

export function isZodiacRelationshipFocus(value: unknown): value is ZodiacRelationshipFocus {
  return Object.hasOwn(ZODIAC_RELATIONSHIP_FOCUSES, clean(value, 40).toLowerCase());
}

export function safeZodiacCompatibilitySnapshot(value: unknown): SafeZodiacCompatibilitySnapshot | null {
  const source = record(value);
  if (clean(source.version, 64) !== ZODIAC_COMPATIBILITY_SNAPSHOT_VERSION) return null;
  const personAInput = record(source.personA);
  const personBInput = record(source.personB);
  const personA = zodiacSignForBirthday(personAInput.month, personAInput.day);
  const personB = zodiacSignForBirthday(personBInput.month, personBInput.day);
  if (!personA || !personB
    || clean(personAInput.sign, 20) !== personA.name
    || clean(personBInput.sign, 20) !== personB.name) return null;

  const expectedScores = zodiacCompatibilityScores(personA, personB);
  const suppliedScores = record(source.scores);
  if (Object.entries(expectedScores).some(([key, expected]) => Number(suppliedScores[key]) !== expected)) return null;

  const relationshipStage = clean(source.relationshipStage, 40).toLowerCase();
  const focus = clean(source.focus, 40).toLowerCase();
  const question = clean(source.question, 400);
  if (!isZodiacRelationshipStage(relationshipStage)
    || !isZodiacRelationshipFocus(focus)
    || question.length < 12) return null;

  const strongest = scoreExtreme(expectedScores, 'high');
  const needsCare = scoreExtreme(expectedScores, 'low');
  if (clean(source.strongest, 32) !== strongest || clean(source.needsCare, 32) !== needsCare) return null;

  return {
    version: ZODIAC_COMPATIBILITY_SNAPSHOT_VERSION,
    personA: { month: Number(personAInput.month), day: Number(personAInput.day), sign: personA.name },
    personB: { month: Number(personBInput.month), day: Number(personBInput.day), sign: personB.name },
    scores: expectedScores,
    strongest,
    needsCare,
    relationshipStage,
    relationshipStageLabel: ZODIAC_RELATIONSHIP_STAGES[relationshipStage],
    focus,
    focusLabel: ZODIAC_RELATIONSHIP_FOCUSES[focus],
    question,
  };
}

export function zodiacCompatibilityEvidence(snapshot: SafeZodiacCompatibilitySnapshot) {
  return [
    `Verified Sun-sign pair: ${snapshot.personA.sign} + ${snapshot.personB.sign}`,
    `Overall: ${snapshot.scores.overall}%`,
    `Love and attraction: ${snapshot.scores.love}%`,
    `Communication: ${snapshot.scores.communication}%`,
    `Trust: ${snapshot.scores.trust}%`,
    `Emotional bond: ${snapshot.scores.emotion}%`,
    `Relationship stage: ${snapshot.relationshipStageLabel}`,
    `Customer focus: ${snapshot.focusLabel}`,
    `Exact question: ${snapshot.question}`,
  ].join('; ');
}
