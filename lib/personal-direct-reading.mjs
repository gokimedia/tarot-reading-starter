import {
  SEVEN_CARD_HORSESHOE_CARD_NAMES,
  sevenCardHorseshoeCheckoutQuestionPolicy,
} from './seven-card-horseshoe-compact.mjs';

export const PERSONAL_DIRECT_PAGE = '/pages/personal-tarot-reading';
export const PERSONAL_DIRECT_TYPE = 'Personal Tarot';
export const PERSONAL_DIRECT_SPREAD = 'personal-three-card';
export const PERSONAL_DIRECT_PRESENTATION_VARIANT = 'personal-direct-v1';
export const PERSONAL_DIRECT_QUESTION_MIN_LENGTH = 12;
export const PERSONAL_DIRECT_QUESTION_MAX_LENGTH = 600;
export const PERSONAL_DIRECT_CONTEXT_MAX_LENGTH = 1_500;
export const PERSONAL_DIRECT_SCOPE = 'A paid three-card Personal Tarot reading connecting Situation, Challenge, and Advice to the exact customer question and optional context.';
export const PERSONAL_DIRECT_CONFIDENCE = 'Symbolic reflective guidance grounded in the three drawn cards; no fixed outcome or professional medical, legal, or financial advice.';
export const PERSONAL_DIRECT_POSITIONS = Object.freeze(['Situation', 'Challenge', 'Advice']);
export const PERSONAL_DIRECT_PUBLIC_ERROR_CODES = Object.freeze({
  tierUnsupported: 'PERSONAL_DIRECT_TIER_UNSUPPORTED',
  questionInvalid: 'PERSONAL_DIRECT_QUESTION_INVALID',
  requestInvalid: 'PERSONAL_DIRECT_REQUEST_INVALID',
  canonicalPageInvalid: 'PERSONAL_DIRECT_CANONICAL_PAGE_INVALID',
  productContractMismatch: 'PERSONAL_DIRECT_PRODUCT_CONTRACT_MISMATCH',
  safetyBlocked: 'PERSONAL_DIRECT_SAFETY_BLOCKED',
  evidenceMismatch: 'PERSONAL_DIRECT_EVIDENCE_MISMATCH',
  displayedQuoteInvalid: 'PERSONAL_DIRECT_DISPLAYED_QUOTE_INVALID',
  quoteChanged: 'PERSONAL_DIRECT_QUOTE_CHANGED',
});

const CARD_BY_KEY = new Map(SEVEN_CARD_HORSESHOE_CARD_NAMES.map((name) => [name.toLowerCase(), name]));

function cleanText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function failure(reason, safetyCategory = '') {
  return { ok: false, reason, safetyCategory };
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseCard(value, expectedPosition) {
  const separator = value.indexOf(':');
  if (separator < 1) return null;
  const position = cleanText(value.slice(0, separator));
  if (position.toLowerCase() !== expectedPosition.toLowerCase()) return null;
  const match = /^(.*)\s+(Upright|Reversed)$/i.exec(cleanText(value.slice(separator + 1)));
  if (!match) return null;
  const card = CARD_BY_KEY.get(match[1].trim().toLowerCase());
  if (!card) return null;
  return Object.freeze({
    position: expectedPosition,
    card,
    orientation: /^reversed$/i.test(match[2]) ? 'Reversed' : 'Upright',
  });
}

export function parsePersonalDirectCards(value) {
  const parts = cleanText(value)
    .replace(/^result signals\s*:\s*/i, '')
    .replace(/\.\s*$/, '')
    .split(/\s*;\s*/)
    .filter(Boolean);
  if (parts.length !== PERSONAL_DIRECT_POSITIONS.length) return null;
  const cards = parts.map((part, index) => parseCard(part, PERSONAL_DIRECT_POSITIONS[index]));
  if (cards.some((card) => !card)) return null;
  if (new Set(cards.map((card) => card.card.toLowerCase())).size !== cards.length) return null;
  return Object.freeze(cards);
}

export function personalDirectQuestionPolicy(questionValue, contextValue = '') {
  const question = cleanText(questionValue);
  const context = cleanText(contextValue);
  if (question.length < PERSONAL_DIRECT_QUESTION_MIN_LENGTH
    || question.length > PERSONAL_DIRECT_QUESTION_MAX_LENGTH) {
    return failure('question_length_invalid');
  }
  if (context.length > PERSONAL_DIRECT_CONTEXT_MAX_LENGTH) return failure('context_length_invalid');
  const questionPolicy = sevenCardHorseshoeCheckoutQuestionPolicy(question);
  if (!questionPolicy.ok) return failure(questionPolicy.reason, questionPolicy.safetyCategory);
  if (context) {
    const combinedPolicy = sevenCardHorseshoeCheckoutQuestionPolicy(`${question} ${context}`);
    if (!combinedPolicy.ok && combinedPolicy.safetyCategory) {
      return failure('safety_blocked', combinedPolicy.safetyCategory);
    }
  }
  return { ok: true, reason: '', safetyCategory: '' };
}

export function isPersonalDirectReading(value = {}) {
  const source = record(value);
  return cleanText(source.tool) === PERSONAL_DIRECT_PAGE
    && cleanText(source.type) === PERSONAL_DIRECT_TYPE
    && cleanText(source.presentationVariant) === PERSONAL_DIRECT_PRESENTATION_VARIANT;
}

export function paidQuestionLengthLimit(value = {}) {
  const source = record(value);
  return Number(source.personalDirect) === 1
    && cleanText(source.toolPage) === PERSONAL_DIRECT_PAGE
    && isPersonalDirectReading(source)
    ? PERSONAL_DIRECT_QUESTION_MAX_LENGTH
    : 400;
}

export function validatePersonalDirectSnapshot(input = {}) {
  const snapshot = record(input.snapshot);
  const page = cleanText(input.page || snapshot.tool);
  const type = cleanText(input.toolType || snapshot.type);
  const presentationVariant = cleanText(input.presentationVariant || snapshot.presentationVariant);
  const applies = page === PERSONAL_DIRECT_PAGE || /^personal-direct-/i.test(presentationVariant);
  if (!applies) return { applies: false, ok: true, reason: '', safetyCategory: '', cards: null };
  if (presentationVariant !== PERSONAL_DIRECT_PRESENTATION_VARIANT) {
    return { applies: true, ...failure('presentation_variant_mismatch'), cards: null };
  }
  if (page !== PERSONAL_DIRECT_PAGE
    || type !== PERSONAL_DIRECT_TYPE
    || cleanText(snapshot.type) !== PERSONAL_DIRECT_TYPE
    || cleanText(snapshot.tool) !== PERSONAL_DIRECT_PAGE) {
    return { applies: true, ...failure('page_type_mismatch'), cards: null };
  }
  if (cleanText(snapshot.spread) !== PERSONAL_DIRECT_SPREAD) {
    return { applies: true, ...failure('spread_mismatch'), cards: null };
  }
  if (cleanText(snapshot.scope) !== PERSONAL_DIRECT_SCOPE
    || cleanText(snapshot.confidence) !== PERSONAL_DIRECT_CONFIDENCE) {
    return { applies: true, ...failure('scope_confidence_mismatch'), cards: null };
  }
  const question = cleanText(snapshot.question);
  const context = cleanText(snapshot.context);
  const policy = personalDirectQuestionPolicy(question, context);
  if (!policy.ok) return { applies: true, ...policy, cards: null };
  if (cleanText(snapshot.curiosityQuestion)
    || cleanText(snapshot.focus)
    || cleanText(snapshot.freeToken)
    || cleanText(snapshot.previewToken)
    || snapshot.transportFallback === true) {
    return { applies: true, ...failure('paid_only_contract_mismatch'), cards: null };
  }
  const signals = cleanText(snapshot.signals);
  const cardsValue = cleanText(snapshot.cards);
  const cards = parsePersonalDirectCards(signals);
  const repeatedCards = parsePersonalDirectCards(cardsValue);
  if (!cards || !repeatedCards || cardsValue !== signals
    || cards.some((card, index) => card.card !== repeatedCards[index].card
      || card.position !== repeatedCards[index].position
      || card.orientation !== repeatedCards[index].orientation)) {
    return { applies: true, ...failure('personal_direct_evidence_mismatch'), cards: null };
  }
  return { applies: true, ok: true, reason: '', safetyCategory: '', cards };
}
