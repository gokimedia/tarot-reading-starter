const RUNE_PAGE = '/pages/rune-reading';
const RUNE_TOOL = `https://deckaura.com${RUNE_PAGE}`;

export const RUNE_CHECKOUT_CONTRACT_VERSION = 'rune-checkout-v1';
export const RUNE_FUNNEL_VERSION = 'rune-v2-enterprise-v2';

export const ELDER_FUTHARK_RUNES = Object.freeze([
  'Fehu', 'Uruz', 'Thurisaz', 'Ansuz', 'Raidho', 'Kenaz',
  'Gebo', 'Wunjo', 'Hagalaz', 'Nauthiz', 'Isa', 'Jera',
  'Eihwaz', 'Perthro', 'Algiz', 'Sowilo', 'Tiwaz', 'Berkano',
  'Ehwaz', 'Mannaz', 'Laguz', 'Ingwaz', 'Dagaz', 'Othala',
]);

const SPREAD_POSITIONS = Object.freeze({
  'focused spread': Object.freeze(['Anchor', 'Gate', 'Direction']),
  'crossroads spread': Object.freeze(['Anchor', 'Path A', 'Path B', 'Gate', 'Move']),
  'pattern spread': Object.freeze(['Root', 'Now', 'Obstacle', 'Support', 'Direction']),
  'compass spread': Object.freeze(['Now', 'Gate', 'Move', 'Watch', 'Direction']),
});

const ANSWER_TYPE_BY_SPREAD = Object.freeze({
  'focused spread': 'A focused answer',
  'crossroads spread': 'Compare two paths',
  'pattern spread': 'Understand the hidden pattern',
  'compass spread': 'Get a 30-day direction',
});

const TIMEFRAMES = new Set(['This week', 'Next 30 days', 'Next 3 months', 'No fixed timeframe']);
const RUNE_NAMES = new Map(ELDER_FUTHARK_RUNES.map((name) => [name.toLowerCase(), name]));

type JsonObject = Record<string, unknown>;

export type RuneCastEntry = {
  position: string;
  name: string;
  orientation: 'upright' | 'reversed';
};

export type RuneCheckoutContract = {
  active: boolean;
  ok: boolean;
  code: string;
  missing: string[];
  spread: string;
  cast: RuneCastEntry[];
  verifiedFields: JsonObject;
};

function clean(value: unknown, max = 1_800) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizedKey(value: unknown) {
  return clean(value, 120).toLowerCase().replace(/^_/, '').replace(/\s+/g, ' ');
}

function propertiesFor(lineItem: JsonObject) {
  const values = new Map<string, string>();
  const properties = Array.isArray(lineItem.properties) ? lineItem.properties : [];
  for (const raw of properties) {
    const property = raw && typeof raw === 'object' ? raw as JsonObject : {};
    const key = normalizedKey(property.name);
    const value = clean(property.value);
    if (key && value && !values.has(key)) values.set(key, value);
  }
  return values;
}

function firstProperty(properties: Map<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = properties.get(key);
    if (value) return value;
  }
  return '';
}

function normalizedSourcePath(value: string) {
  const source = clean(value, 240);
  if (!source) return '';
  try {
    const parsed = new URL(source, 'https://deckaura.com');
    return parsed.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return source.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  }
}

export function parseRuneCast(value: unknown): RuneCastEntry[] {
  const raw = clean(value);
  if (!raw) return [];
  return raw.split(/\s*;\s*/).map((segment) => {
    const match = segment.match(/^([^:]{1,64}):\s*([A-Za-z]+)\s*\((upright|reversed)\)$/i);
    if (!match) return null;
    const canonicalRune = RUNE_NAMES.get(match[2].toLowerCase());
    if (!canonicalRune) return null;
    return {
      position: clean(match[1], 64),
      name: canonicalRune,
      orientation: match[3].toLowerCase() as 'upright' | 'reversed',
    };
  }).filter((entry): entry is RuneCastEntry => Boolean(entry));
}

export function canonicalRuneCast(cast: RuneCastEntry[]) {
  return cast.map((entry) => `${entry.position}: ${entry.name} (${entry.orientation})`).join('; ');
}

export function runeCheckoutContract(lineItem: JsonObject): RuneCheckoutContract {
  const properties = propertiesFor(lineItem);
  const funnelVersion = firstProperty(properties, ['funnel version']);
  const contractVersion = firstProperty(properties, ['contract version']);
  const source = firstProperty(properties, ['source', 'tool']);
  const readingType = firstProperty(properties, ['reading type', 'type']);
  const answerType = firstProperty(properties, ['answer type']);
  const rawSpread = firstProperty(properties, ['spread']).toLowerCase();
  const active = /^rune-v2-/i.test(funnelVersion)
    || contractVersion === RUNE_CHECKOUT_CONTRACT_VERSION
    || normalizedSourcePath(source) === RUNE_PAGE
    || /rune reading/i.test(readingType);

  if (!active) {
    return { active: false, ok: true, code: 'NOT_RUNE_CHECKOUT', missing: [], spread: '', cast: [], verifiedFields: {} };
  }

  const question = firstProperty(properties, ['your question', 'question']);
  const focus = firstProperty(properties, ['reading focus', 'focus']);
  const timeframe = firstProperty(properties, ['timeframe']);
  const rawCast = firstProperty(properties, ['rune cast', 'cards', 'result signals']);
  const cast = parseRuneCast(rawCast);
  const expectedPositions = SPREAD_POSITIONS[rawSpread as keyof typeof SPREAD_POSITIONS];
  const expectedAnswerType = ANSWER_TYPE_BY_SPREAD[rawSpread as keyof typeof ANSWER_TYPE_BY_SPREAD];
  const missing: string[] = [];

  if (contractVersion && contractVersion !== RUNE_CHECKOUT_CONTRACT_VERSION) missing.push('contractVersion');
  if (question.length < 8) missing.push('question');
  if (!focus) missing.push('readingFocus');
  if (!expectedPositions) missing.push('spread');
  if (!answerType || expectedAnswerType && answerType !== expectedAnswerType) missing.push('answerType');
  if (!TIMEFRAMES.has(timeframe)) missing.push('timeframe');
  if (normalizedSourcePath(source) !== RUNE_PAGE) missing.push('source');
  if (contractVersion === RUNE_CHECKOUT_CONTRACT_VERSION && readingType !== 'Rune Reading') missing.push('readingType');
  if (!rawCast) missing.push('runeCast');

  if (expectedPositions) {
    if (cast.length !== expectedPositions.length) {
      missing.push('runeCount');
    } else {
      const suppliedPositions = cast.map((entry) => entry.position);
      if (suppliedPositions.some((position, index) => position !== expectedPositions[index])) missing.push('runePositions');
      if (new Set(cast.map((entry) => entry.name)).size !== cast.length) missing.push('uniqueRunes');
    }
  }

  if (rawCast && cast.length !== rawCast.split(/\s*;\s*/).filter(Boolean).length) missing.push('runeSyntax');

  const uniqueMissing = [...new Set(missing)];
  if (uniqueMissing.length) {
    return {
      active: true,
      ok: false,
      code: rawSpread === 'crossroads spread' ? 'RUNE_CROSSROADS_CONTRACT_INVALID' : 'RUNE_CHECKOUT_CONTRACT_INVALID',
      missing: uniqueMissing,
      spread: rawSpread,
      cast,
      verifiedFields: {},
    };
  }

  const canonicalCast = canonicalRuneCast(cast);
  const positionList = expectedPositions.join(', ');
  return {
    active: true,
    ok: true,
    code: 'OK',
    missing: [],
    spread: rawSpread,
    cast,
    verifiedFields: {
      intentKind: 'rune',
      type: 'Rune Reading',
      question,
      cards: canonicalCast,
      signals: canonicalCast,
      spread: rawSpread,
      focus,
      answerType,
      timeframe,
      tool: RUNE_TOOL,
      context: `Reading focus: ${focus}. Answer type: ${answerType}. Timeframe: ${timeframe}. Exact rune positions: ${positionList}.`,
      scope: 'Interpret only the exact supplied Elder Futhark runes in their named positions and orientations. Preserve both paths in a crossroads spread and do not invent symbols, facts or outcomes.',
      confidence: 'Checkout-preserved symbolic rune cast. Structurally validated against the selected spread; reflective guidance, not factual prediction or medical advice.',
      funnelVersion: funnelVersion || RUNE_FUNNEL_VERSION,
      runeContractVersion: contractVersion || 'legacy-rune-v2-compatible',
    },
  };
}

export function runeCheckoutContractForItems(items: JsonObject[]) {
  const contracts = items.map(runeCheckoutContract).filter((contract) => contract.active);
  if (!contracts.length) return null;
  if (contracts.length !== 1) {
    return {
      active: true,
      ok: false,
      code: 'RUNE_READING_PACKAGE_COUNT_INVALID',
      missing: ['readingPackageCount'],
      spread: '',
      cast: [],
      verifiedFields: {},
    } satisfies RuneCheckoutContract;
  }
  return contracts[0];
}

