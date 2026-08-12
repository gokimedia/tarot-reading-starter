import {
  SHARED_TOOL_FUNNEL_VERSION,
  SHARED_TOOL_PAGE_TOOL_TYPES,
  sharedToolPaidOrderContract,
} from './generated/shared-tool-manifest.mjs';
import { validateNewSharedToolSnapshot } from './new-shared-tool-evidence.mjs';

function clean(value, maximum) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function failure(reason) {
  return { ok: false, reason };
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
  const question = clean(row.question, 400);
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
  const snapshotQuestion = clean(snapshot.question, 400);
  const snapshotContext = clean(snapshot.context, 4_000);
  const snapshotSignals = clean(snapshot.signals, 1_500);
  const snapshotCards = clean(snapshot.cards, 1_500);
  const snapshotSpread = clean(snapshot.spread, 500);
  const snapshotScope = clean(snapshot.scope, 500);
  const snapshotConfidence = clean(snapshot.confidence, 200);
  const snapshotFocus = clean(snapshot.focus, 160);
  const snapshotTool = clean(snapshot.tool, 120);
  const curiosityQuestion = clean(snapshot.curiosityQuestion, 400);
  if (snapshotVersion !== 'reading-snapshot-v2'
    || snapshotType !== readingType
    || snapshotQuestion !== question
    || clean(snapshot.readingId, 80) !== readingId
    || (!snapshotSignals && !snapshotCards)
    || !snapshotScope
    || !snapshotConfidence
    || !snapshotTool
    || !curiosityQuestion) {
    return failure('SHARED_SNAPSHOT_CONTRACT_MISMATCH');
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
      freeQuestion: snapshotQuestion,
      context: snapshotContext,
      freeContext: snapshotContext,
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
      sharedToolFunnelVersion: SHARED_TOOL_FUNNEL_VERSION,
      packageTitle: `${readingType} ${contract.paidTier} reading`,
      deliveryWindowMinutes: 90,
    },
  };
}
