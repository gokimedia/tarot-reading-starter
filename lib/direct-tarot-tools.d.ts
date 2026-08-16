export type DirectTarotCard = Readonly<{
  position: string;
  card: string;
  orientation?: 'Upright' | 'Reversed';
  number?: number;
  displayName?: string;
  aliases?: readonly string[];
}>;

export const DIRECT_TAROT_VISITOR_TTL_MS: number;
export const DIRECT_TAROT_SNAPSHOT_TTL_SECONDS: number;

export const YES_NO_DIRECT_PAGE: '/pages/yes-or-no-tarot';
export const YES_NO_DIRECT_TYPE: 'Yes or No Tarot';
export const YES_NO_DIRECT_SPREAD: 'one-card-yes-no';
export const YES_NO_DIRECT_PRESENTATION_VARIANT: 'yes-no-direct-v1';
export const YES_NO_DIRECT_DECK_VERSION: 'deckaura-rws-78-yesno-v1';
export const YES_NO_DIRECT_PROMPT_VERSION: 'yes-no-direct-compact-v1';
export const YES_NO_DIRECT_SCOPE: string;
export const YES_NO_DIRECT_CONFIDENCE: string;
export const YES_NO_CARD_NAMES: readonly string[];

export const LOVE_DIRECT_PAGE: '/pages/love-tarot-reading';
export const LOVE_DIRECT_TYPE: 'Love Tarot';
export const LOVE_DIRECT_SPREAD: 'love-three-card';
export const LOVE_DIRECT_PRESENTATION_VARIANT: 'love-three-card-compact-v1';
export const LOVE_DIRECT_PROMPT_VERSION: 'love-three-card-compact-v1';
export const LOVE_DIRECT_POSITIONS: readonly string[];
export const LOVE_DIRECT_SCOPE: string;
export const LOVE_DIRECT_CONFIDENCE: string;

export const CAREER_DIRECT_PAGE: '/pages/career-tarot-reading';
export const CAREER_DIRECT_TYPE: 'Career Tarot';
export const CAREER_DIRECT_SPREAD: 'career-three-card';
export const CAREER_DIRECT_PRESENTATION_VARIANT: 'career-three-card-compact-v1';
export const CAREER_DIRECT_PROMPT_VERSION: 'career-three-card-compact-v1';
export const CAREER_DIRECT_POSITIONS: readonly string[];
export const CAREER_DIRECT_SCOPE: string;
export const CAREER_DIRECT_CONFIDENCE: string;

export const BIRTH_CARD_DIRECT_PAGE: '/pages/tarot-birth-card-calculator';
export const BIRTH_CARD_DIRECT_TYPE: 'Tarot Birth Card';
export const BIRTH_CARD_DIRECT_SPREAD: 'tarot-school-birth-cards';
export const BIRTH_CARD_DIRECT_PRESENTATION_VARIANT: 'birth-card-direct-v1';
export const BIRTH_CARD_CALCULATION_METHOD: 'tarot-school-birth-cards-v1';
export const BIRTH_CARD_DIRECT_SCOPE: string;
export const BIRTH_CARD_DIRECT_CONFIDENCE: string;

export function yesNoDirectionalLeanForCard(cardName: unknown): '' | 'YES' | 'NO' | 'NOT YET' | 'IT DEPENDS';
export function canonicalYesNoDirectEvidence(card: unknown): Readonly<Record<string, unknown>> | null;
export function calculateTarotSchoolBirthCards(birthDate: unknown, now?: number): Readonly<Record<string, unknown>> | null;
export function directTarotToolKind(value?: Record<string, unknown>): '' | 'yes_no' | 'love' | 'career' | 'birth';
export function isDirectTarotCompactPreview(value?: Record<string, unknown>): boolean;
export function directTarotSafetyCategory(value: unknown): '' | 'crisis' | 'missing' | 'medical' | 'death' | 'danger';
export function directTarotQuestionPolicy(page: unknown, question: unknown, context?: unknown): Readonly<{
  ok: boolean;
  reason: string;
  safetyCategory: string;
}>;
export function validateDirectTarotToolSnapshot(input?: Record<string, unknown>): Readonly<{
  applies: boolean;
  ok: boolean;
  reason: string;
  safetyCategory: string;
  kind: '' | 'yes_no' | 'love' | 'career' | 'birth';
  cards: readonly DirectTarotCard[] | null;
  evidence: Readonly<Record<string, unknown>> | null;
  canonicalSignals: string;
}>;
export function canonicalizeDirectTarotSnapshot(input?: Record<string, unknown>): Readonly<Record<string, unknown>> | null;
export function directTarotCheckoutSnapshotFromPreview(preview: unknown, now?: number): Readonly<{
  ok: boolean;
  reason: string;
  createdAt?: number;
  snapshot: Readonly<Record<string, unknown>> | null;
  localeContext?: Readonly<Record<string, unknown>>;
}>;
export function deterministicDirectTarotCompactInsight(contract?: Record<string, unknown>): string;
export function directTarotCompactPrompt(contract?: Record<string, unknown>): Readonly<{ system: string; user: string }>;
export function auditDirectTarotCompactInsight(value: unknown, contract?: Record<string, unknown>): Readonly<{
  ok: boolean;
  reason: string;
  wordCount: number;
  text: string;
}>;
export function directTarotPromptVersion(kind: unknown): string;
