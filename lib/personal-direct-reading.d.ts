export type PersonalDirectCard = Readonly<{
  position: 'Situation' | 'Challenge' | 'Advice';
  card: string;
  orientation: 'Upright' | 'Reversed';
}>;

export const PERSONAL_DIRECT_PAGE: '/pages/personal-tarot-reading';
export const PERSONAL_DIRECT_TYPE: 'Personal Tarot';
export const PERSONAL_DIRECT_SPREAD: 'personal-three-card';
export const PERSONAL_DIRECT_PRESENTATION_VARIANT: 'personal-direct-v1';
export const PERSONAL_DIRECT_QUESTION_MIN_LENGTH: 12;
export const PERSONAL_DIRECT_QUESTION_MAX_LENGTH: 600;
export const PERSONAL_DIRECT_CONTEXT_MAX_LENGTH: 1500;
export const PERSONAL_DIRECT_SCOPE: string;
export const PERSONAL_DIRECT_CONFIDENCE: string;
export const PERSONAL_DIRECT_POSITIONS: readonly ['Situation', 'Challenge', 'Advice'];
export type PersonalDirectPublicErrorCode =
  | 'PERSONAL_DIRECT_TIER_UNSUPPORTED'
  | 'PERSONAL_DIRECT_QUESTION_INVALID'
  | 'PERSONAL_DIRECT_REQUEST_INVALID'
  | 'PERSONAL_DIRECT_CANONICAL_PAGE_INVALID'
  | 'PERSONAL_DIRECT_PRODUCT_CONTRACT_MISMATCH'
  | 'PERSONAL_DIRECT_SAFETY_BLOCKED'
  | 'PERSONAL_DIRECT_EVIDENCE_MISMATCH'
  | 'PERSONAL_DIRECT_DISPLAYED_QUOTE_INVALID'
  | 'PERSONAL_DIRECT_QUOTE_CHANGED';
export const PERSONAL_DIRECT_PUBLIC_ERROR_CODES: Readonly<{
  tierUnsupported: 'PERSONAL_DIRECT_TIER_UNSUPPORTED';
  questionInvalid: 'PERSONAL_DIRECT_QUESTION_INVALID';
  requestInvalid: 'PERSONAL_DIRECT_REQUEST_INVALID';
  canonicalPageInvalid: 'PERSONAL_DIRECT_CANONICAL_PAGE_INVALID';
  productContractMismatch: 'PERSONAL_DIRECT_PRODUCT_CONTRACT_MISMATCH';
  safetyBlocked: 'PERSONAL_DIRECT_SAFETY_BLOCKED';
  evidenceMismatch: 'PERSONAL_DIRECT_EVIDENCE_MISMATCH';
  displayedQuoteInvalid: 'PERSONAL_DIRECT_DISPLAYED_QUOTE_INVALID';
  quoteChanged: 'PERSONAL_DIRECT_QUOTE_CHANGED';
}>;

export function parsePersonalDirectCards(value: unknown): readonly PersonalDirectCard[] | null;
export function personalDirectQuestionPolicy(question: unknown, context?: unknown): Readonly<{
  ok: boolean;
  reason: string;
  safetyCategory: string;
}>;
export function isPersonalDirectReading(value?: Record<string, unknown>): boolean;
export function paidQuestionLengthLimit(value?: Record<string, unknown>): 400 | 600;
export function validatePersonalDirectSnapshot(input?: Record<string, unknown>): Readonly<{
  applies: boolean;
  ok: boolean;
  reason: string;
  safetyCategory: string;
  cards: readonly PersonalDirectCard[] | null;
}>;
