export const RUNE_V2_PAGE = '/pages/rune-reading';
export const RUNE_V2_TYPE = 'Rune Reading';
export const RUNE_V2_PRESENTATION_VARIANT = 'rune-v2-direct-v1';
export const RUNE_V2_CONTRACT_VERSION = 'rune-checkout-v2';

const RUNE_NAMES = Object.freeze([
  'Fehu', 'Uruz', 'Thurisaz', 'Ansuz', 'Raidho', 'Kenaz',
  'Gebo', 'Wunjo', 'Hagalaz', 'Nauthiz', 'Isa', 'Jera',
  'Eihwaz', 'Perthro', 'Algiz', 'Sowilo', 'Tiwaz', 'Berkano',
  'Ehwaz', 'Mannaz', 'Laguz', 'Ingwaz', 'Dagaz', 'Othala',
]);

const NON_REVERSIBLE_RUNE_INDEXES = new Set([6, 8, 9, 10, 11, 12, 15, 21, 22]);
const FOCUS_IDS = new Set(['love', 'decision', 'career', 'pattern', 'change', 'self', 'other']);
const TIMEFRAME_IDS = new Set(['this_week', 'next_30_days', 'next_3_months', 'no_fixed_timeframe']);
const ANSWER_CONTRACTS = Object.freeze({
  focused: Object.freeze({ answerKind: 'focused', spread: 'focused spread', positions: Object.freeze(['anchor', 'gate', 'direction']) }),
  compare: Object.freeze({ answerKind: 'crossroads', spread: 'crossroads spread', positions: Object.freeze(['anchor', 'path_a', 'path_b', 'gate', 'move']) }),
  hidden: Object.freeze({ answerKind: 'pattern', spread: 'pattern spread', positions: Object.freeze(['root', 'now', 'obstacle', 'support', 'direction']) }),
  compass: Object.freeze({ answerKind: 'compass', spread: 'compass spread', positions: Object.freeze(['now', 'gate', 'move', 'watch', 'direction']) }),
});
const POSITION_LABELS = Object.freeze({
  anchor: 'Anchor', gate: 'Gate', direction: 'Direction', path_a: 'Path A', path_b: 'Path B',
  move: 'Move', root: 'Root', now: 'Now', obstacle: 'Obstacle', support: 'Support', watch: 'Watch',
});

function clean(value, maximum = 1_800) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function failure(reason, missing = []) {
  return { applies: true, ok: false, reason, missing: [...new Set(missing)] };
}

function displayContext(snapshot) {
  const context = clean(snapshot.context, 4_000);
  const match = /^Focus: (.{1,160}); Answer type: (.{1,160}); Timeframe: (.{1,160}); Exact cast: (.{1,1500})$/u.exec(context);
  if (!match) return null;
  return {
    focus: clean(match[1], 160),
    answerType: clean(match[2], 160),
    timeframe: clean(match[3], 160),
    signals: clean(match[4], 1_500),
  };
}

function displayCastNames(value) {
  const raw = clean(value, 1_500);
  if (!raw) return null;
  const segments = raw.split(/\s*;\s*/).filter(Boolean);
  const names = [];
  for (const segment of segments) {
    // Position and orientation are localized display labels. Only the stable
    // Elder Futhark name is read here; authority comes from snapshot.cast.
    const match = /^[^:]{1,160}:\s*([A-Za-z]+)\s*\([^()]{1,80}\)$/u.exec(segment);
    if (!match) return null;
    names.push(match[1]);
  }
  return names;
}

export function canonicalRuneV2Cast(cast) {
  if (!Array.isArray(cast)) return '';
  return cast.map((entry) => {
    const value = record(entry);
    return `${clean(value.positionId, 24)}:${Number(value.runeIndex)}:${clean(value.name, 24)}:${clean(value.orientation, 12)}`;
  }).join(';');
}

function deliveryRuneV2Cast(cast) {
  return cast.map((entry) => `${POSITION_LABELS[entry.positionId]}: ${entry.name} (${entry.orientation})`).join('; ');
}

export function validateRuneV2Snapshot(input = {}) {
  const page = clean(input.page, 160);
  const toolType = clean(input.toolType, 80);
  const presentationVariant = clean(input.presentationVariant, 80);
  const snapshot = record(input.snapshot);
  const applies = page === RUNE_V2_PAGE
    || toolType === RUNE_V2_TYPE && presentationVariant === RUNE_V2_PRESENTATION_VARIANT;
  if (!applies) return { applies: false, ok: true };

  const missing = [];
  const focusId = clean(snapshot.focusId, 24).toLowerCase();
  const answerId = clean(snapshot.answerId, 24).toLowerCase();
  const answerKind = clean(snapshot.answerKind, 24).toLowerCase();
  const timeframeId = clean(snapshot.timeframeId, 32).toLowerCase();
  const spread = clean(snapshot.spread, 80).toLowerCase();
  const answer = ANSWER_CONTRACTS[answerId];
  const castInput = Array.isArray(snapshot.cast) ? snapshot.cast : [];
  const cast = [];

  if (page !== RUNE_V2_PAGE) missing.push('page');
  if (toolType !== RUNE_V2_TYPE || clean(snapshot.type, 80) !== RUNE_V2_TYPE) missing.push('readingType');
  if (clean(snapshot.question, 400).length < 8) missing.push('question');
  if (presentationVariant !== RUNE_V2_PRESENTATION_VARIANT
    || clean(snapshot.presentationVariant, 80) !== RUNE_V2_PRESENTATION_VARIANT) missing.push('presentationVariant');
  if (!FOCUS_IDS.has(focusId)) missing.push('focusId');
  if (!answer || answer.answerKind !== answerKind || answer.spread !== spread) missing.push('answerContract');
  if (!TIMEFRAME_IDS.has(timeframeId)) missing.push('timeframeId');

  if (!answer || castInput.length !== answer.positions.length) {
    missing.push('runeCount');
  } else {
    for (let index = 0; index < castInput.length; index += 1) {
      const raw = record(castInput[index]);
      const positionId = clean(raw.positionId, 24).toLowerCase();
      const runeIndex = raw.runeIndex;
      const name = clean(raw.name, 24);
      const orientation = clean(raw.orientation, 12).toLowerCase();
      if (typeof raw.positionId !== 'string' || positionId !== answer.positions[index]) missing.push('runePositions');
      if (typeof raw.name !== 'string'
        || !Number.isInteger(runeIndex) || runeIndex < 0 || runeIndex >= RUNE_NAMES.length
        || RUNE_NAMES[runeIndex] !== name) missing.push('runeIdentity');
      if (typeof raw.orientation !== 'string'
        || orientation !== 'upright' && orientation !== 'reversed') missing.push('runeOrientation');
      if (orientation === 'reversed' && NON_REVERSIBLE_RUNE_INDEXES.has(runeIndex)) missing.push('nonReversibleRune');
      cast.push({ positionId, runeIndex, name, orientation });
    }
    if (new Set(cast.map((entry) => entry.runeIndex)).size !== cast.length) missing.push('uniqueRunes');
  }

  const display = displayContext(snapshot);
  const signalNames = displayCastNames(snapshot.signals);
  if (!display
    || display.focus !== clean(snapshot.focus, 160)
    || display.signals !== clean(snapshot.signals, 1_500)) missing.push('displayContext');
  if (!signalNames || signalNames.length !== cast.length
    || signalNames.some((name, index) => name !== cast[index]?.name)) missing.push('displaySignals');
  if (missing.length) return failure('RUNE_CHECKOUT_V2_SNAPSHOT_INVALID', missing);

  const canonicalCast = canonicalRuneV2Cast(cast);
  const deliveryCast = deliveryRuneV2Cast(cast);
  return {
    applies: true,
    ok: true,
    canonicalSnapshot: { focusId, answerId, answerKind, timeframeId, cast },
    canonicalCast,
    display,
    verifiedFields: {
      intentKind: 'rune',
      type: RUNE_V2_TYPE,
      readingType: RUNE_V2_TYPE,
      cards: deliveryCast,
      signals: deliveryCast,
      spread,
      focus: clean(snapshot.focus, 160),
      runeFocusId: focusId,
      runeAnswerId: answerId,
      runeAnswerKind: answerKind,
      runeTimeframeId: timeframeId,
      runeCast: cast,
      context: `Focus ID: ${focusId}. Answer: ${answerId}/${answerKind}. Timeframe: ${timeframeId}. Exact rune positions: ${answer.positions.map((id) => POSITION_LABELS[id]).join(', ')}.`,
      scope: 'Interpret only the exact signed Elder Futhark runes in their canonical positions and orientations. Preserve both paths in a crossroads spread and do not invent symbols, facts or outcomes.',
      confidence: 'Server-validated signed rune cast; reflective guidance, not factual prediction or medical advice.',
      runeContractVersion: RUNE_V2_CONTRACT_VERSION,
    },
  };
}

export function verifyRuneV2PaidLine(input = {}) {
  const snapshotValidation = validateRuneV2Snapshot(input);
  if (!snapshotValidation.applies) return snapshotValidation;
  if (!snapshotValidation.ok) return snapshotValidation;
  const snapshot = record(input.snapshot);
  const line = record(input.line);
  const display = snapshotValidation.display;
  const mismatches = [];
  const exact = (lineKey, snapshotValue, maximum) => {
    if (clean(line[lineKey], maximum) !== clean(snapshotValue, maximum)) mismatches.push(lineKey);
  };

  if (clean(line.contractVersion, 40) !== RUNE_V2_CONTRACT_VERSION) mismatches.push('contractVersion');
  exact('readingType', RUNE_V2_TYPE, 80);
  exact('question', snapshot.question, 400);
  exact('readingFocus', display.focus, 160);
  exact('focus', display.focus, 160);
  exact('answerType', display.answerType, 160);
  exact('timeframe', display.timeframe, 160);
  exact('runeCast', snapshot.signals, 1_500);
  exact('resultSignals', snapshot.signals, 1_500);
  exact('spread', snapshot.spread, 80);
  exact('context', snapshot.context, 4_000);
  exact('readingScope', snapshot.scope, 500);
  exact('calculationConfidence', snapshot.confidence, 200);
  exact('tool', `https://deckaura.com${RUNE_V2_PAGE}`, 160);
  exact('source', RUNE_V2_PAGE, 160);
  exact('readingId', snapshot.readingId, 80);
  exact('presentationVariant', RUNE_V2_PRESENTATION_VARIANT, 80);
  exact('runeFocusId', snapshotValidation.canonicalSnapshot.focusId, 24);
  exact('runeAnswerId', snapshotValidation.canonicalSnapshot.answerId, 24);
  exact('runeAnswerKind', snapshotValidation.canonicalSnapshot.answerKind, 24);
  exact('runeTimeframeId', snapshotValidation.canonicalSnapshot.timeframeId, 32);
  exact('runeCanonicalCast', snapshotValidation.canonicalCast, 500);
  if (mismatches.length) return failure('RUNE_CHECKOUT_V2_LINE_MISMATCH', mismatches);
  return snapshotValidation;
}
