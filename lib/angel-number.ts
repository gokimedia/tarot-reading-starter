import type { ReadingTier, YesNoCategory } from '@/lib/reading-products';

export const ANGEL_NUMBER_PAGE = '/pages/angel-number-meaning';
export const ANGEL_NUMBER_FUNNEL_VERSION = 'angel-situational-funnel-2026-08-v1';
export const ANGEL_NUMBER_SNAPSHOT_VERSION = 'angel-number-snapshot-v1';

export const ANGEL_NUMBER_LIFE_AREAS = Object.freeze({
  love_relationships: Object.freeze({ label: 'Love & relationships', category: 'love' as const }),
  specific_person: Object.freeze({ label: 'A specific person / no contact', category: 'love' as const }),
  career_money: Object.freeze({ label: 'Career & money', category: 'career' as const }),
  change_decision: Object.freeze({ label: 'Change or a decision', category: 'personal' as const }),
  spiritual_growth: Object.freeze({ label: 'Spiritual growth', category: 'personal' as const }),
});

export type AngelNumberLifeArea = keyof typeof ANGEL_NUMBER_LIFE_AREAS;

export const ANGEL_NUMBER_SITUATIONS = Object.freeze({
  love_relationships: Object.freeze({
    new_love: 'New love',
    relationship: 'Current relationship',
    healing_boundaries: 'Healing or boundaries',
    stay_or_leave: 'Stay or leave',
  }),
  specific_person: Object.freeze({
    no_contact: 'No contact',
    mixed_signals: 'Mixed signals',
    reconnection: 'Possible reconnection',
    feelings_intentions: 'Feelings or intentions',
  }),
  career_money: Object.freeze({
    job_search: 'Job search',
    current_role: 'Current role',
    business_money: 'Business or money',
    career_decision: 'Career decision',
  }),
  change_decision: Object.freeze({
    new_beginning: 'A new beginning',
    ending_release: 'An ending or release',
    two_paths: 'Choosing between two paths',
    uncertainty: 'General uncertainty',
  }),
  spiritual_growth: Object.freeze({
    repeating_pattern: 'A repeating pattern',
    intuition: 'Trusting intuition',
    identity_growth: 'Identity and growth',
    next_step: 'My next step',
  }),
});

export const ANGEL_NUMBER_PACKAGE_SCOPE = Object.freeze({
  standard: Object.freeze({
    title: 'Your Message Now',
    instruction: 'Give the core message for the exact number and selected life area, one support, one caution, and one practical next step for the current situation.',
  }),
  medium: Object.freeze({
    title: 'Why It Keeps Appearing',
    instruction: 'Include Your Message Now, then explain the repeating pattern, the central tension, what strengthens or weakens it, two grounded options, and a practical 7-day reflection plan.',
  }),
  premium: Object.freeze({
    title: 'Your Sign Pattern',
    instruction: 'Synthesize the main number with the supplied additional numbers or optional birth-date Life Path. Include the pattern across the selected life area, supportive and cautionary signals, decision safeguards, and a practical 30-day plan.',
  }),
} satisfies Record<ReadingTier, { title: string; instruction: string }>);

const CORE_TITLES = Object.freeze({
  '0': 'Infinite Potential',
  '1': 'New Beginnings',
  '2': 'Balance & Partnership',
  '3': 'Creative Expression',
  '4': 'Stability & Protection',
  '5': 'Major Life Changes',
  '6': 'Home & Harmony',
  '7': 'Spiritual Awakening',
  '8': 'Abundance & Power',
  '9': 'Completion & Purpose',
  '11': 'Master Intuitive',
  '22': 'Master Builder',
  '33': 'Master Teacher',
  '111': 'Manifestation Gateway',
  '222': 'Trust & Alignment',
  '333': 'Ascended Master Support',
  '444': 'Angelic Protection',
  '555': 'Transformation Incoming',
  '666': 'Realign & Rebalance',
  '777': 'Divine Luck & Alignment',
  '888': 'Infinite Abundance',
  '999': 'Sacred Completion',
  '1010': 'Spiritual Acceleration',
  '1111': 'Universal Alignment Portal',
  '1212': 'Divine Cycle of Growth',
  '1234': 'Steps of Progress',
} as const);

type JsonObject = Record<string, unknown>;

export type SafeAngelNumberSnapshot = {
  version: typeof ANGEL_NUMBER_SNAPSHOT_VERSION;
  number: string;
  coreNumber: string;
  reduced: boolean;
  coreTitle: string;
  lifeArea: AngelNumberLifeArea;
  lifeAreaLabel: string;
  situation: string | null;
  situationLabel: string | null;
  userContext: string;
  support: string;
  caution: string;
  nextStep: string;
  preview: string;
  additionalNumbers: string[];
  birthDate: string | null;
};

function record(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function clean(value: unknown, maximum: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function normalizedNumber(value: unknown) {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return /^\d{1,6}$/.test(digits) ? digits : '';
}

function reducedNumber(value: string) {
  let sum = [...value].reduce((total, digit) => total + Number(digit), 0);
  while (sum > 9 && sum !== 11 && sum !== 22 && sum !== 33) {
    sum = [...String(sum)].reduce((total, digit) => total + Number(digit), 0);
  }
  return String(sum);
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

export function isAngelNumberLifeArea(value: unknown): value is AngelNumberLifeArea {
  return Object.hasOwn(ANGEL_NUMBER_LIFE_AREAS, clean(value, 40).toLowerCase());
}

export function angelNumberCategory(area: AngelNumberLifeArea): YesNoCategory {
  return ANGEL_NUMBER_LIFE_AREAS[area].category;
}

export function safeAngelNumberSnapshot(value: unknown): SafeAngelNumberSnapshot | null {
  const source = record(value);
  if (clean(source.version, 64) !== ANGEL_NUMBER_SNAPSHOT_VERSION) return null;

  const number = normalizedNumber(source.number);
  const coreNumber = normalizedNumber(source.coreNumber);
  const reduced = source.reduced === true;
  const lifeArea = clean(source.lifeArea, 40).toLowerCase();
  if (!number || !coreNumber || !isAngelNumberLifeArea(lifeArea)) return null;
  if ((reduced && reducedNumber(number) !== coreNumber) || (!reduced && coreNumber !== number)) return null;

  const expectedCoreTitle = CORE_TITLES[coreNumber as keyof typeof CORE_TITLES];
  if (!expectedCoreTitle || clean(source.coreTitle, 80) !== expectedCoreTitle) return null;

  const situation = clean(source.situation, 40).toLowerCase();
  const situations = ANGEL_NUMBER_SITUATIONS[lifeArea] as Record<string, string>;
  const situationLabel = situation ? situations[situation] : null;
  if (situation && !situationLabel) return null;

  const userContext = clean(source.userContext, 400);
  const support = clean(source.support, 700);
  const caution = clean(source.caution, 700);
  const nextStep = clean(source.nextStep, 700);
  const preview = clean(source.preview, 1_000);
  if (support.length < 20 || caution.length < 20 || nextStep.length < 20 || preview.length < 50) return null;

  const additionalNumbers = Array.isArray(source.additionalNumbers)
    ? [...new Set(source.additionalNumbers.map(normalizedNumber).filter(Boolean))]
      .filter((entry) => entry !== number)
      .slice(0, 2)
    : [];
  const submittedBirthDate = clean(source.birthDate, 16);
  const birthDate = submittedBirthDate && validBirthDate(submittedBirthDate) ? submittedBirthDate : null;
  if (submittedBirthDate && !birthDate) return null;

  return {
    version: ANGEL_NUMBER_SNAPSHOT_VERSION,
    number,
    coreNumber,
    reduced,
    coreTitle: expectedCoreTitle,
    lifeArea,
    lifeAreaLabel: ANGEL_NUMBER_LIFE_AREAS[lifeArea].label,
    situation: situation || null,
    situationLabel,
    userContext,
    support,
    caution,
    nextStep,
    preview,
    additionalNumbers,
    birthDate,
  };
}

export function angelNumberEvidence(snapshot: SafeAngelNumberSnapshot) {
  const patternInputs = [snapshot.number, ...snapshot.additionalNumbers];
  const pieces = [
    `Entered number: ${snapshot.number}`,
    snapshot.reduced ? `Digit-sum core: ${snapshot.coreNumber}` : `Core theme: ${snapshot.coreTitle}`,
    `Life area: ${snapshot.lifeAreaLabel}`,
    snapshot.situationLabel ? `Situation: ${snapshot.situationLabel}` : '',
    snapshot.userContext ? `Customer context: ${snapshot.userContext}` : '',
    patternInputs.length > 1 ? `Supplied sign pattern: ${patternInputs.join(', ')}` : '',
    snapshot.birthDate ? `Optional birth date supplied for Life Path calculation: ${snapshot.birthDate}` : '',
  ].filter(Boolean);
  return pieces.join('; ');
}
