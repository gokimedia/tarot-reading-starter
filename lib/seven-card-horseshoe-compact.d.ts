export type SevenCardHorseshoeCard = Readonly<{
  position: string;
  card: string;
  orientation: 'Upright' | 'Reversed';
  displayName?: string;
  aliases?: readonly string[];
  meaning?: string;
}>;

export const SEVEN_CARD_HORSESHOE_PAGE: '/pages/7-card-tarot-reading';
export const SEVEN_CARD_HORSESHOE_TYPE: 'Tarot';
export const SEVEN_CARD_HORSESHOE_SPREAD: 'seven-card-horseshoe';
export const SEVEN_CARD_HORSESHOE_PRESENTATION_VARIANT: 'seven-card-compact-v1';
export const SEVEN_CARD_HORSESHOE_PROMPT_VERSION: 'seven-card-horseshoe-compact-v1';
export const SEVEN_CARD_HORSESHOE_MIN_WORDS: 55;
export const SEVEN_CARD_HORSESHOE_MAX_WORDS: 75;
export const SEVEN_CARD_HORSESHOE_VISITOR_TTL_MS: number;
export const SEVEN_CARD_HORSESHOE_SCOPE: string;
export const SEVEN_CARD_HORSESHOE_CONFIDENCE: string;
export const SEVEN_CARD_HORSESHOE_POSITIONS: readonly string[];
export const SEVEN_CARD_HORSESHOE_CARD_NAMES: readonly string[];

export function sevenCardHorseshoeVisitorAuthority(visitorId: unknown, secret: unknown): Promise<Readonly<{
  ok: boolean;
  reason: string;
  visitorName: string;
  sessionKey: string;
}>>;

export function sevenCardHorseshoeCheckoutQuestionPolicy(value: unknown): Readonly<{
  ok: boolean;
  reason: string;
  safetyCategory: string;
}>;
export function parseSevenCardHorseshoeSignals(value: unknown): readonly SevenCardHorseshoeCard[] | null;
export function validateSevenCardHorseshoeCompactSnapshot(input?: Record<string, unknown>): Readonly<{
  applies: boolean;
  ok: boolean;
  reason: string;
  cards: readonly SevenCardHorseshoeCard[] | null;
}>;
export function sevenCardHorseshoeCheckoutSnapshotFromPreview(preview: unknown, now?: number): Readonly<{
  ok: boolean;
  reason: string;
  createdAt?: number;
  snapshot: Record<string, unknown> | null;
}>;
export function sevenCardHorseshoeWordCount(value: unknown): number;
export function deterministicSevenCardHorseshoeCompactInsight(contract?: Record<string, unknown>): string;
export function sevenCardHorseshoeCompactPrompt(contract?: Record<string, unknown>): Readonly<{ system: string; user: string }>;
export function auditSevenCardHorseshoeCompactInsight(value: unknown, contract?: Record<string, unknown>): Readonly<{
  ok: boolean;
  reason: string;
  wordCount: number;
  text: string;
}>;
