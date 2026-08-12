import {
  NUMEROLOGY_SNAPSHOT_VERSION,
  NUMEROLOGY_VARIANTS,
  NumerologyOrderError,
  calculateLifePath,
  calculateNameNumbers,
} from './numerology-compatibility-order.mjs';

const MASTER_NUMBERS = new Set([11, 22, 33]);
const REPORT_YEAR = 2026;

export const LIFE_PATH_FUNNEL_VERSION = 'life_path_blueprint_v2_20260804';

const FOCUSES = new Set([
  'Purpose & Direction',
  'Career & Money',
  'Love & Relationships',
  'Repeating Patterns',
  'Confidence & Decisions',
  'My 2026 Timing',
]);

function text(value, maximum = 400) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').slice(0, maximum);
}

function property(item, wanted) {
  const keys = new Set(wanted.map((key) => key.toLowerCase()));
  for (const entry of Array.isArray(item?.properties) ? item.properties : []) {
    if (!entry || typeof entry !== 'object') continue;
    const key = text(entry.name, 100).toLowerCase().replace(/^_/, '');
    if (keys.has(key) && entry.value != null) return text(entry.value, 400);
  }
  return '';
}

function reduceNumber(value) {
  let current = Math.abs(Number.parseInt(String(value), 10)) || 0;
  while (current > 9 && !MASTER_NUMBERS.has(current)) {
    current = String(current).split('').reduce((sum, digit) => sum + Number(digit), 0);
  }
  return current;
}

function parseBirthDate(value) {
  const raw = text(value, 20);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day || date.getTime() > Date.now()) return null;
  return { iso: raw, year, month, day };
}

function personalYear(date, year = REPORT_YEAR) {
  const universalYear = reduceNumber(String(year).split('').reduce((sum, digit) => sum + Number(digit), 0));
  return reduceNumber(reduceNumber(date.month) + reduceNumber(date.day) + universalYear);
}

function normalizeTier(value) {
  const tier = text(value, 24).toLowerCase();
  if (tier === 'essential' || tier === 'standard') return 'standard';
  if (tier === 'deeper' || tier === 'focused' || tier === 'medium') return 'medium';
  if (tier === 'indepth' || tier === 'in-depth' || tier === 'premium') return 'premium';
  return '';
}

function tierDeliverables(tier) {
  if (tier === 'premium') return [
    'Life Path, Birthday, Expression, Soul Urge, Personality and 2026 Personal Year synthesis',
    'Career and money patterns plus relationship needs',
    'Recurring patterns and interaction tensions',
    'A practical 30-day focus plan in a saveable digital report',
  ];
  if (tier === 'medium') return [
    'Life Path, Expression, Soul Urge and Personality synthesis',
    'Core strengths and growth challenge',
    'How the four core numbers reinforce or contradict one another',
    'Concrete guidance for the selected focus',
  ];
  return [
    'Life Path focus interpretation',
    'Core strengths and growth challenge',
    'The most relevant love or career pattern',
    'A practical 7-day action',
  ];
}

function focusQuestion(focus) {
  return `What does my Life Path reveal about ${focus.toLowerCase()}, and what practical step should I take next?`;
}

export function isNumerologyLifePathItem(item) {
  const type = property(item, ['reading type', 'type']).toLowerCase();
  const product = property(item, ['numerology product']).toLowerCase();
  return type === 'numerology life path' || product === 'life_path';
}

export function validateNumerologyLifePathOrder(payload, items) {
  const candidates = (Array.isArray(items) ? items : []).filter(isNumerologyLifePathItem);
  if (!candidates.length) return null;
  if (candidates.length !== 1) throw new NumerologyOrderError('LIFE_PATH_SINGLE_REPORT_REQUIRED');

  const item = candidates[0];
  const variantId = text(item.variant_id, 64);
  const variant = NUMEROLOGY_VARIANTS[variantId];
  if (!variant) throw new NumerologyOrderError('LIFE_PATH_VARIANT_NOT_ALLOWED');
  if (text(item.sku, 80).toUpperCase() !== variant.sku) throw new NumerologyOrderError('LIFE_PATH_VARIANT_SKU_MISMATCH');
  if ((Number.parseInt(String(item.quantity || 1), 10) || 1) !== 1) throw new NumerologyOrderError('LIFE_PATH_QUANTITY_INVALID');

  const claimedTier = normalizeTier(property(item, ['package tier']));
  if (!claimedTier || claimedTier !== variant.tier) throw new NumerologyOrderError('LIFE_PATH_PACKAGE_TIER_MISMATCH');

  const focus = property(item, ['focus']);
  if (!FOCUSES.has(focus)) throw new NumerologyOrderError('LIFE_PATH_FOCUS_INVALID');
  const birthDate = parseBirthDate(property(item, ['birth date']));
  if (!birthDate) throw new NumerologyOrderError('LIFE_PATH_BIRTH_DATE_INVALID');

  const lifePath = calculateLifePath(birthDate);
  const birthday = reduceNumber(birthDate.day);
  const year = Number(property(item, ['personal year calendar']));
  if (year !== REPORT_YEAR) throw new NumerologyOrderError('LIFE_PATH_REPORT_YEAR_INVALID');
  const currentPersonalYear = personalYear(birthDate, REPORT_YEAR);
  if (Number(property(item, ['life path'])) !== lifePath
    || Number(property(item, ['birthday'])) !== birthday
    || Number(property(item, ['personal year'])) !== currentPersonalYear) {
    throw new NumerologyOrderError('LIFE_PATH_CALCULATION_MISMATCH');
  }

  const fullBirthName = property(item, ['birth name']);
  const nameRequired = variant.tier !== 'standard';
  if (nameRequired && !fullBirthName) throw new NumerologyOrderError('LIFE_PATH_FULL_BIRTH_NAME_REQUIRED');
  const nameNumbers = nameRequired ? calculateNameNumbers(fullBirthName) : null;
  if (nameNumbers && (Number(property(item, ['expression'])) !== nameNumbers.expression
    || Number(property(item, ['soul urge'])) !== nameNumbers.soulUrge
    || Number(property(item, ['personality'])) !== nameNumbers.personality)) {
    throw new NumerologyOrderError('LIFE_PATH_NAME_CALCULATION_MISMATCH');
  }

  const profile = {
    birthDate: birthDate.iso,
    lifePath,
    birthday,
    personalYear: currentPersonalYear,
    reportYear: REPORT_YEAR,
    name: nameRequired ? fullBirthName : '',
    ...(nameNumbers || {}),
  };
  const question = focusQuestion(focus);
  const nameSignals = nameNumbers
    ? ` Expression ${nameNumbers.expression}. Soul Urge ${nameNumbers.soulUrge}. Personality ${nameNumbers.personality}.`
    : '';
  const premiumSignals = variant.tier === 'premium'
    ? ` Birthday ${birthday}. ${REPORT_YEAR} Personal Year ${currentPersonalYear}.`
    : '';
  const signals = text(`Life Path ${lifePath}.${nameSignals}${premiumSignals}`, 400);
  const scope = variant.tier === 'premium'
    ? `Complete Numerology Blueprint for ${focus}: connect all six verified numbers, career and money patterns, relationship needs, repeating patterns, ${REPORT_YEAR} timing and a practical 30-day plan.`
    : variant.tier === 'medium'
      ? `Core Numbers Profile for ${focus}: connect Life Path, Expression, Soul Urge and Personality, emphasizing interactions, reinforcements and contradictions.`
      : `Life Path Focus Report for ${focus}: strengths, growth challenge, relevant love or career pattern and a practical 7-day action.`;
  const confidence = nameRequired
    ? 'Birth-date and Pythagorean full-name numbers recalculated server-side; reflective numerology, not scientific prediction.'
    : 'Life Path recalculated server-side from the paid order birth date; reflective numerology, not scientific prediction.';
  const orderId = text(payload?.id, 96);

  return {
    kind: 'life_path',
    variantId,
    tier: variant.tier,
    packageLabel: variant.tier === 'premium' ? 'Complete Numerology Blueprint'
      : variant.tier === 'medium' ? 'Core Numbers Profile' : 'Life Path Focus Report',
    sku: variant.sku,
    focus,
    reportYear: REPORT_YEAR,
    profile,
    deliverables: tierDeliverables(variant.tier),
    verifiedFields: {
      question,
      curiosityQuestion: question,
      type: 'Numerology Life Path',
      context: `Selected focus: ${focus}. Verified birth date: ${birthDate.iso}. Use only the numbers supplied for this package.`,
      dob: birthDate.iso,
      name: text(fullBirthName || payload?.customer?.first_name || payload?.billing_address?.first_name, 80),
      cards: '',
      spread: variant.tier === 'premium' ? 'Complete Numerology Blueprint'
        : variant.tier === 'medium' ? 'Core Numbers Profile' : 'Life Path Focus Report',
      lang: property(item, ['language', 'lang']) || 'en',
      signals,
      scope,
      confidence,
      tool: '/pages/life-path-number-calculator · Life Path Number Calculator',
      focus,
      readingId: `life-path-${orderId || text(item.id, 64) || 'report'}`.slice(0, 80),
      funnelVersion: LIFE_PATH_FUNNEL_VERSION,
      snapshotVersion: NUMEROLOGY_SNAPSHOT_VERSION,
      snapshotFingerprint: '',
      freeToken: '',
      conversationId: '',
      tier: variant.tier,
    },
  };
}
