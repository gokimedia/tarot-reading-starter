import {
  SHARED_TOOL_FUNNEL_VERSION,
  SHARED_TOOL_PAGE_TOOL_TYPES,
  sharedToolPaidOrderContract,
} from './generated/shared-tool-manifest.mjs';
import { validateNewSharedToolSnapshot } from './new-shared-tool-evidence.mjs';
import {
  PERSONAL_DIRECT_PAGE,
  validatePersonalDirectSnapshot,
} from './personal-direct-reading.mjs';
import {
  SEVEN_CARD_HORSESHOE_PAGE,
  validateSevenCardHorseshoeCompactSnapshot,
} from './seven-card-horseshoe-compact.mjs';

function clean(value, maximum) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function failure(reason) {
  return { ok: false, reason };
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function moneyCents(value) {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(clean(value, 40));
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function verifySharedToolPaidOrder(input = {}) {
  const row = input.row && typeof input.row === 'object' ? input.row : {};
  const snapshot = input.snapshot && typeof input.snapshot === 'object' && !Array.isArray(input.snapshot)
    ? input.snapshot
    : {};
  const line = input.line && typeof input.line === 'object' ? input.line : {};
  const page = clean(row.page, 160);
  const readingType = clean(row.readingType, 80);
  const readingId = clean(row.readingId, 80);
  const exactPersonalDirectPage = page === PERSONAL_DIRECT_PAGE;
  const question = clean(row.question, exactPersonalDirectPage ? 600 : 400);
  const persistedSnapshotHash = clean(row.snapshotHash, 64);
  const contract = sharedToolPaidOrderContract(
    page,
    readingType,
    row.tier,
    row.variantId,
    row.sku,
    row.price,
  );
  if (!contract) return failure('SHARED_PRODUCT_CONTRACT_MISMATCH');
  if (clean(row.funnelVersion, 128) !== SHARED_TOOL_FUNNEL_VERSION
    || SHARED_TOOL_PAGE_TOOL_TYPES[page] !== readingType) {
    return failure('SHARED_PAGE_TYPE_FUNNEL_MISMATCH');
  }

  const snapshotVersion = clean(snapshot.version, 40);
  const snapshotType = clean(snapshot.type, 80);
  const snapshotQuestion = clean(snapshot.question, exactPersonalDirectPage ? 600 : 400);
  const snapshotContext = clean(snapshot.context, 4_000);
  const snapshotSignals = clean(snapshot.signals, 1_500);
  const snapshotCards = clean(snapshot.cards, 1_500);
  const snapshotSpread = clean(snapshot.spread, 500);
  const snapshotScope = clean(snapshot.scope, 500);
  const snapshotConfidence = clean(snapshot.confidence, 200);
  const snapshotFocus = clean(snapshot.focus, 160);
  const snapshotTool = clean(snapshot.tool, 120);
  const presentationVariant = clean(snapshot.presentationVariant, 80);
  const curiosityQuestion = clean(snapshot.curiosityQuestion, 400);
  const sevenCardValidation = validateSevenCardHorseshoeCompactSnapshot({
    page,
    toolType: readingType,
    presentationVariant,
    snapshot: {
      ...snapshot,
      type: snapshotType,
      signals: snapshotSignals,
      cards: snapshotCards,
      spread: snapshotSpread,
      scope: snapshotScope,
      confidence: snapshotConfidence,
      tool: snapshotTool,
      presentationVariant,
    },
  });
  const exactSevenCardPage = page === SEVEN_CARD_HORSESHOE_PAGE;
  if ((exactSevenCardPage && (!sevenCardValidation.applies || !sevenCardValidation.ok))
    || (sevenCardValidation.applies && !sevenCardValidation.ok)) {
    return failure('SHARED_SEVEN_CARD_EVIDENCE_MISMATCH');
  }
  const personalDirectValidation = validatePersonalDirectSnapshot({
    page,
    toolType: readingType,
    presentationVariant,
    snapshot: {
      ...snapshot,
      type: snapshotType,
      question: snapshotQuestion,
      context: snapshotContext,
      signals: snapshotSignals,
      cards: snapshotCards,
      spread: snapshotSpread,
      scope: snapshotScope,
      confidence: snapshotConfidence,
      focus: snapshotFocus,
      tool: snapshotTool,
      curiosityQuestion,
      presentationVariant,
    },
  });
  if ((exactPersonalDirectPage && (!personalDirectValidation.applies || !personalDirectValidation.ok))
    || (personalDirectValidation.applies && !personalDirectValidation.ok)) {
    return failure('SHARED_PERSONAL_DIRECT_EVIDENCE_MISMATCH');
  }
  if (snapshotVersion !== 'reading-snapshot-v2'
    || snapshotType !== readingType
    || snapshotQuestion !== question
    || (exactSevenCardPage && snapshotQuestion.length < 8)
    || clean(snapshot.readingId, 80) !== readingId
    || (!snapshotSignals && !snapshotCards)
    || !snapshotScope
    || !snapshotConfidence
    || !snapshotTool
    || (!curiosityQuestion
      && !(sevenCardValidation.applies && sevenCardValidation.ok)
      && !(personalDirectValidation.applies && personalDirectValidation.ok))) {
    return failure('SHARED_SNAPSHOT_CONTRACT_MISMATCH');
  }
  const checkoutQuote = record(snapshot.checkoutQuote);
  if ((exactSevenCardPage || exactPersonalDirectPage) && (
    clean(checkoutQuote.intentId, 64) !== clean(row.id, 64)
    || clean(checkoutQuote.variantId, 24) !== clean(row.variantId, 24)
    || clean(checkoutQuote.sku, 80) !== clean(row.sku, 80)
    || !Number.isInteger(Number(checkoutQuote.priceCents))
    || Number(checkoutQuote.priceCents) <= 0
    || !/^[A-Z]{3}$/.test(clean(checkoutQuote.currency, 3))
    || !/^[A-Z]{2}$/.test(clean(checkoutQuote.country, 2))
    || clean(record(snapshot.localeContext).currency, 3) !== clean(checkoutQuote.currency, 3)
    || clean(record(snapshot.localeContext).country, 2) !== clean(checkoutQuote.country, 2)
    || moneyCents(line.presentmentAmount) !== Number(checkoutQuote.priceCents)
    || clean(line.presentmentCurrency, 3).toUpperCase() !== clean(checkoutQuote.currency, 3)
  )) {
    return failure(exactPersonalDirectPage
      ? 'SHARED_PERSONAL_DIRECT_QUOTE_MISMATCH'
      : 'SHARED_SEVEN_CARD_QUOTE_MISMATCH');
  }
  const typedEvidence = validateNewSharedToolSnapshot({
    page,
    toolType: readingType,
    snapshot: {
      type: snapshotType,
      context: snapshotContext,
      signals: snapshotSignals,
      scope: snapshotScope,
      confidence: snapshotConfidence,
    },
  });
  if (typedEvidence.applies && !typedEvidence.ok) {
    return failure('SHARED_TYPED_EVIDENCE_MISMATCH');
  }
  if (clean(line.intentKind, 32) !== 'shared_tool'
    || clean(line.toolPage, 160) !== page
    || clean(line.toolType, 80) !== readingType
    || clean(line.snapshotVersion, 40) !== 'reading-snapshot-v2'
    || clean(line.snapshotHash, 64) !== persistedSnapshotHash) {
    return failure('SHARED_LINE_PROPERTY_CONTRACT_MISMATCH');
  }

  return {
    ok: true,
    product: {
      productKey: 'shared_tool',
      tier: contract.paidTier,
      storefrontTier: contract.storefrontTier,
      variantId: contract.variantId,
      sku: contract.sku,
      price: contract.price,
    },
    verifiedFields: {
      type: readingType,
      readingType,
      tool: snapshotTool,
      toolPage: page,
      question: snapshotQuestion,
      freeQuestion: exactPersonalDirectPage ? '' : snapshotQuestion,
      context: snapshotContext,
      freeContext: exactPersonalDirectPage ? '' : snapshotContext,
      cards: snapshotCards,
      spread: snapshotSpread,
      signals: snapshotSignals,
      scope: snapshotScope,
      confidence: snapshotConfidence,
      focus: snapshotFocus,
      readingId,
      snapshotVersion: 'reading-snapshot-v2',
      snapshotFingerprint: '',
      freeToken: '',
      curiosityQuestion,
      presentationVariant,
      ...((exactSevenCardPage || exactPersonalDirectPage) ? {
        checkoutQuoteIntentId: clean(checkoutQuote.intentId, 64),
        checkoutQuotePriceCents: Number(checkoutQuote.priceCents),
        checkoutQuoteCurrency: clean(checkoutQuote.currency, 3),
      } : {}),
      ...(exactPersonalDirectPage ? { personalDirect: 1 } : {}),
      sharedToolFunnelVersion: SHARED_TOOL_FUNNEL_VERSION,
      packageTitle: exactPersonalDirectPage
        ? ({
            standard: 'Essential Personal Tarot reading',
            medium: 'Focused Personal Tarot reading',
            premium: 'In-Depth Personal Tarot reading',
          })[contract.paidTier]
        : `${readingType} ${contract.paidTier} reading`,
      deliveryWindowMinutes: 90,
    },
  };
}
