import { createHmac } from 'node:crypto';
import type { ReadingTier, YesNoCategory } from '@/lib/reading-products';

export const ANGEL_NUMBER_PAGE = '/pages/angel-number-meaning';
export const ANGEL_NUMBER_FUNNEL_VERSION = 'angel-situational-funnel-2026-08-v1';
export const ANGEL_NUMBER_SNAPSHOT_VERSION = 'angel-number-snapshot-v1';
export const PERSONAL_777_FUNNEL_VERSION = '777-personal-answer-2026-08-v1';
export const PERSONAL_777_SOURCE_PAGE = '/blogs/guide/777-meaning';
export const PERSONAL_777_READING_MODE = 'personal_777';

export const PERSONAL_777_TOPICS = Object.freeze({
  love: 'love_relationships',
  twin: 'specific_person',
  career: 'career_money',
  spiritual: 'spiritual_growth',
  decision: 'change_decision',
} as const);

export type Personal777Topic = keyof typeof PERSONAL_777_TOPICS;

export const PERSONAL_777_PACKAGE_SCOPE = Object.freeze({
  medium: Object.freeze({
    title: 'Personal 777 Answer',
    instruction: 'Directly answer the exact question, explain why 777 may be catching attention now, interpret it only within the selected topic, name what needs attention, and finish with exactly three practical next steps.',
  }),
  premium: Object.freeze({
    title: 'Deep 777 Reading',
    instruction: 'Include the complete Personal 777 Answer, then analyze the deeper pattern and hidden block, state the most supported direction without claiming certainty, interpret all three server-selected supportive cards in their exact positions and orientations, and finish with a practical 7-day guidance plan. The purchase includes one follow-up question.',
  }),
});

export const PERSONAL_777_CARD_POSITIONS = Object.freeze([
  'What 777 is highlighting now',
  'The hidden pattern or block',
  'The most supportive next direction',
] as const);

const PERSONAL_777_CARD_NAMES = Object.freeze([
  'The Fool', 'The Magician', 'The High Priestess', 'The Empress', 'The Emperor',
  'The Hierophant', 'The Lovers', 'The Chariot', 'Strength', 'The Hermit',
  'Wheel of Fortune', 'Justice', 'The Hanged Man', 'Death', 'Temperance', 'The Devil',
  'The Tower', 'The Star', 'The Moon', 'The Sun', 'Judgement', 'The World',
  'Ace of Cups', 'Two of Cups', 'Three of Cups', 'Four of Cups', 'Five of Cups',
  'Six of Cups', 'Seven of Cups', 'Eight of Cups', 'Nine of Cups', 'Ten of Cups',
  'Page of Cups', 'Knight of Cups', 'Queen of Cups', 'King of Cups',
  'Ace of Pentacles', 'Two of Pentacles', 'Three of Pentacles', 'Four of Pentacles',
  'Five of Pentacles', 'Six of Pentacles', 'Seven of Pentacles', 'Eight of Pentacles',
  'Nine of Pentacles', 'Ten of Pentacles', 'Page of Pentacles', 'Knight of Pentacles',
  'Queen of Pentacles', 'King of Pentacles',
  'Ace of Swords', 'Two of Swords', 'Three of Swords', 'Four of Swords', 'Five of Swords',
  'Six of Swords', 'Seven of Swords', 'Eight of Swords', 'Nine of Swords', 'Ten of Swords',
  'Page of Swords', 'Knight of Swords', 'Queen of Swords', 'King of Swords',
  'Ace of Wands', 'Two of Wands', 'Three of Wands', 'Four of Wands', 'Five of Wands',
  'Six of Wands', 'Seven of Wands', 'Eight of Wands', 'Nine of Wands', 'Ten of Wands',
  'Page of Wands', 'Knight of Wands', 'Queen of Wands', 'King of Wands',
] as const);

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
  sourcePage: string | null;
  readingMode: typeof PERSONAL_777_READING_MODE | null;
  articleTopic: Personal777Topic | null;
  supportiveCards: Personal777Card[];
};

export type Personal777Card = {
  id: number;
  name: string;
  orientation: 'Upright' | 'Reversed';
  position: typeof PERSONAL_777_CARD_POSITIONS[number];
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

export function isPersonal777Snapshot(snapshot: Pick<SafeAngelNumberSnapshot, 'number' | 'coreNumber' | 'reduced' | 'sourcePage' | 'readingMode' | 'articleTopic' | 'lifeArea'>) {
  return snapshot.number === '777'
    && snapshot.coreNumber === '777'
    && snapshot.reduced === false
    && snapshot.sourcePage === PERSONAL_777_SOURCE_PAGE
    && snapshot.readingMode === PERSONAL_777_READING_MODE
    && Boolean(snapshot.articleTopic)
    && PERSONAL_777_TOPICS[snapshot.articleTopic as Personal777Topic] === snapshot.lifeArea;
}

function safePersonal777Cards(value: unknown) {
  if (!Array.isArray(value)) return [];
  const cards = value.slice(0, PERSONAL_777_CARD_POSITIONS.length).map((entry, index) => {
    const card = record(entry);
    const id = Number.parseInt(String(card.id || ''), 10);
    const name = clean(card.name, 80);
    const orientation = clean(card.orientation, 16);
    const position = clean(card.position, 80);
    return { id, name, orientation, position, index };
  });
  if (cards.length !== PERSONAL_777_CARD_POSITIONS.length
    || new Set(cards.map((card) => card.id)).size !== cards.length
    || cards.some((card) => card.id < 1
      || card.id > PERSONAL_777_CARD_NAMES.length
      || PERSONAL_777_CARD_NAMES[card.id - 1] !== card.name
      || (card.orientation !== 'Upright' && card.orientation !== 'Reversed')
      || PERSONAL_777_CARD_POSITIONS[card.index] !== card.position)) return [];
  return cards.map(({ id, name, orientation, position }) => ({
    id,
    name,
    orientation: orientation as Personal777Card['orientation'],
    position: position as Personal777Card['position'],
  }));
}

export function personal777SupportiveCards(input: {
  intentId: string;
  readingId: string;
  question: string;
  secret: string;
}) {
  const cards: Personal777Card[] = [];
  const used = new Set<number>();
  let counter = 0;
  while (cards.length < PERSONAL_777_CARD_POSITIONS.length && counter < 256) {
    const digest = createHmac('sha256', input.secret)
      .update(`${input.intentId}\u001f${input.readingId}\u001f${input.question}\u001f777\u001f${counter}`, 'utf8')
      .digest();
    const id = (digest.readUInt16BE(0) % PERSONAL_777_CARD_NAMES.length) + 1;
    counter += 1;
    if (used.has(id)) continue;
    used.add(id);
    cards.push({
      id,
      name: PERSONAL_777_CARD_NAMES[id - 1],
      orientation: digest[2] < 77 ? 'Reversed' : 'Upright',
      position: PERSONAL_777_CARD_POSITIONS[cards.length],
    });
  }
  return cards.length === PERSONAL_777_CARD_POSITIONS.length ? cards : null;
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

  const sourcePage = clean(source.sourcePage, 160) || null;
  const readingModeValue = clean(source.readingMode, 40).toLowerCase();
  const readingMode = readingModeValue === PERSONAL_777_READING_MODE ? PERSONAL_777_READING_MODE : null;
  if (readingModeValue && !readingMode) return null;
  const articleTopicValue = clean(source.articleTopic, 40).toLowerCase();
  const articleTopic = Object.hasOwn(PERSONAL_777_TOPICS, articleTopicValue)
    ? articleTopicValue as Personal777Topic
    : null;
  if (articleTopicValue && !articleTopic) return null;
  if ((sourcePage || readingMode || articleTopic)
    && (number !== '777'
      || coreNumber !== '777'
      || reduced
      || sourcePage !== PERSONAL_777_SOURCE_PAGE
      || readingMode !== PERSONAL_777_READING_MODE
      || !articleTopic
      || PERSONAL_777_TOPICS[articleTopic] !== lifeArea
      || additionalNumbers.length
      || birthDate)) return null;
  const supportiveCards = safePersonal777Cards(source.supportiveCards);
  if (Array.isArray(source.supportiveCards) && source.supportiveCards.length && !supportiveCards.length) return null;

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
    sourcePage,
    readingMode,
    articleTopic,
    supportiveCards,
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
    snapshot.articleTopic ? `777 article topic: ${snapshot.articleTopic}` : '',
  ].filter(Boolean);
  return pieces.join('; ');
}
