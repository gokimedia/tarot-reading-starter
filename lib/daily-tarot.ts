import { createHmac } from 'node:crypto';
import type { ReadingTier } from '@/lib/reading-products';

export const DAILY_TAROT_PAGE = '/pages/daily-tarot-card';
export const DAILY_TAROT_FUNNEL_VERSION = 'daily-context-funnel-2026-08-v1';

export type DailyTarotFocus =
  | 'love_relationships'
  | 'work_money'
  | 'decision'
  | 'emotional_wellbeing'
  | 'general_direction';

export const DAILY_TAROT_FOCUSES = Object.freeze({
  love_relationships: Object.freeze({ label: 'Love & relationships', category: 'love' }),
  work_money: Object.freeze({ label: 'Work & money', category: 'career' }),
  decision: Object.freeze({ label: 'A decision', category: 'personal' }),
  emotional_wellbeing: Object.freeze({ label: 'Emotional wellbeing', category: 'personal' }),
  general_direction: Object.freeze({ label: 'General direction', category: 'general' }),
} as const);

export const DAILY_TAROT_PACKAGE_SCOPE = Object.freeze({
  standard: Object.freeze({
    title: "Today's 3-Card Clarity",
    days: 1,
    positions: Object.freeze([
      'Why this is showing up today',
      'What can change the situation',
      'Clearest next step before today ends',
    ]),
  }),
  medium: Object.freeze({
    title: '7-Day Tarot Outlook',
    days: 7,
    positions: Object.freeze([
      'The theme opening this week',
      'What is influencing the situation',
      'What to release',
      'What to strengthen',
      'Love and connection',
      'Work and practical life',
      'Best move for the next 7 days',
    ]),
  }),
  premium: Object.freeze({
    title: '30-Day Direction Map',
    days: 30,
    positions: Object.freeze([
      'Your current direction',
      'The hidden pattern',
      'Week 1: what opens',
      'Week 2: what needs attention',
      'Week 3: the decision point',
      'Week 4: what consolidates',
      'What to protect',
      'What to change',
      'Likely 30-day direction if you act',
    ]),
  }),
} as const);

export const DAILY_TAROT_CARD_NAMES = Object.freeze([
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

export function isDailyTarotFocus(value: unknown): value is DailyTarotFocus {
  return Object.hasOwn(DAILY_TAROT_FOCUSES, String(value || '').trim().toLowerCase());
}

function dateHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededRandom(seed: number) {
  const value = Math.sin(seed) * 10_000;
  return value - Math.floor(value);
}

export function normalizeDailyDateKey(value: unknown) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return { key: `${year}-${month}-${day}`, timestamp };
}

export function dailyDateIsCurrent(value: unknown, now = Date.now()) {
  const parsed = normalizeDailyDateKey(value);
  if (!parsed) return false;
  const utcToday = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  return Math.abs(parsed.timestamp - utcToday) <= 24 * 60 * 60 * 1000;
}

export function dailyCardForDateKey(value: unknown) {
  const parsed = normalizeDailyDateKey(value);
  if (!parsed) return null;
  const seed = dateHash(parsed.key);
  const index = Math.floor(seededRandom(seed) * DAILY_TAROT_CARD_NAMES.length);
  return {
    id: index + 1,
    name: DAILY_TAROT_CARD_NAMES[index],
    orientation: seededRandom(seed + 1) < 0.3 ? 'Reversed' as const : 'Upright' as const,
  };
}

export type DailyTarotCard = {
  id: number;
  name: string;
  orientation: 'Upright' | 'Reversed';
  position: string;
};

export function dailyTarotCards(input: {
  dateKey: string;
  tier: ReadingTier;
  readingId: string;
  intentId: string;
  situation: string;
  secret: string;
}) {
  const shared = dailyCardForDateKey(input.dateKey);
  if (!shared) return null;
  const scope = DAILY_TAROT_PACKAGE_SCOPE[input.tier];
  const cards: DailyTarotCard[] = [{ ...shared, position: scope.positions[0] }];
  const used = new Set([shared.id]);
  let counter = 0;
  while (cards.length < scope.positions.length && counter < 512) {
    const digest = createHmac('sha256', input.secret)
      .update(`${input.intentId}\u001f${input.readingId}\u001f${input.dateKey}\u001f${input.tier}\u001f${input.situation}\u001f${counter}`, 'utf8')
      .digest();
    const id = (digest.readUInt16BE(0) % DAILY_TAROT_CARD_NAMES.length) + 1;
    counter += 1;
    if (used.has(id)) continue;
    used.add(id);
    cards.push({
      id,
      name: DAILY_TAROT_CARD_NAMES[id - 1],
      orientation: digest[2] < 77 ? 'Reversed' : 'Upright',
      position: scope.positions[cards.length],
    });
  }
  return cards.length === scope.positions.length ? cards : null;
}
