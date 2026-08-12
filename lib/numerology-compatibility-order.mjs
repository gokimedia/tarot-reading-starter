const MASTER_NUMBERS = new Set([11, 22, 33]);

export const NUMEROLOGY_FUNNEL_VERSION = 'numerology-compatibility-v4-20260805';
export const NUMEROLOGY_SNAPSHOT_VERSION = 'reading-snapshot-v2';
export const NUMEROLOGY_DELIVERY_DELAY_MINUTES = 2;

export const NUMEROLOGY_VARIANTS = Object.freeze({
  '53782498214161': Object.freeze({ tier: 'standard', label: 'Essential', sku: 'READING-DEEP', price: 5.99 }),
  '53782498246929': Object.freeze({ tier: 'medium', label: 'Deeper', sku: 'READING-MEDIUM', price: 9.99 }),
  '53782498279697': Object.freeze({ tier: 'premium', label: 'In-Depth', sku: 'READING-PREMIUM', price: 16.99 }),
});

const CONNECTIONS = Object.freeze({
  romantic_partner: 'Romantic partner',
  new_connection: 'Crush or someone new',
  ex_unresolved: 'Ex or unresolved connection',
  friend: 'Friend',
  family: 'Family',
  business_partner: 'Business partner',
});

const FOCUSES = Object.freeze({
  attraction: 'Attraction and chemistry',
  communication: 'Communication style',
  emotional_needs: 'Emotional needs',
  long_term_potential: 'Long-term potential',
  recurring_conflict: 'Recurring conflict',
  best_next_step: 'Best next step',
  date_pair: 'Date-based pair only',
});

const PREMIUM_FOCUSES = Object.freeze({
  emotional_needs: 'What each person needs emotionally',
  conflict_pattern: 'Why the same conflict keeps returning',
  long_term_direction: 'What supports long-term potential',
  timing_2026: 'How the 2026 timing cycle affects the connection',
  next_12_months: 'How the next 12 months affect the connection',
  best_next_step: 'The most useful next step now',
});

const SCORE_TABLE = Object.freeze({
  '1-1': 65, '1-2': 70, '1-3': 90, '1-4': 55, '1-5': 88, '1-6': 60, '1-7': 75, '1-8': 62, '1-9': 72, '1-11': 70, '1-22': 65, '1-33': 60,
  '2-2': 80, '2-3': 65, '2-4': 88, '2-5': 50, '2-6': 85, '2-7': 60, '2-8': 87, '2-9': 72, '2-11': 82, '2-22': 78, '2-33': 80,
  '3-3': 75, '3-4': 50, '3-5': 85, '3-6': 78, '3-7': 55, '3-8': 58, '3-9': 82, '3-11': 72, '3-22': 60, '3-33': 75,
  '4-4': 70, '4-5': 45, '4-6': 82, '4-7': 78, '4-8': 88, '4-9': 52, '4-11': 62, '4-22': 90, '4-33': 65,
  '5-5': 72, '5-6': 52, '5-7': 78, '5-8': 55, '5-9': 75, '5-11': 62, '5-22': 55, '5-33': 58,
  '6-6': 78, '6-7': 55, '6-8': 68, '6-9': 88, '6-11': 82, '6-22': 78, '6-33': 92,
  '7-7': 82, '7-8': 52, '7-9': 75, '7-11': 80, '7-22': 68, '7-33': 70,
  '8-8': 72, '8-9': 55, '8-11': 60, '8-22': 85, '8-33': 58,
  '9-9': 75, '9-11': 78, '9-22': 72, '9-33': 85,
  '11-11': 78, '11-22': 82, '11-33': 85,
  '22-22': 75, '22-33': 88,
  '33-33': 80,
});

export class NumerologyOrderError extends Error {
  constructor(code) {
    super(code);
    this.name = 'NumerologyOrderError';
    this.code = code;
  }
}

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

function reduceNumber(value, preserveMasters = true) {
  let current = Math.abs(Number.parseInt(String(value), 10)) || 0;
  while (current > 9 && !(preserveMasters && MASTER_NUMBERS.has(current))) {
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
  const now = new Date();
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day || date.getTime() > now.getTime()) return null;
  return { iso: raw, year, month, day };
}

export function calculateLifePath(value) {
  const birthDate = typeof value === 'string' ? parseBirthDate(value) : value;
  if (!birthDate) throw new NumerologyOrderError('NUMEROLOGY_BIRTH_DATE_INVALID');
  const month = reduceNumber(birthDate.month);
  const day = reduceNumber(birthDate.day);
  const year = reduceNumber(String(birthDate.year).split('').reduce((sum, digit) => sum + Number(digit), 0));
  return reduceNumber(month + day + year);
}

export function calculateCompatibilityScore(firstLifePath, secondLifePath) {
  const values = [Number(firstLifePath), Number(secondLifePath)].sort((a, b) => a - b);
  const score = SCORE_TABLE[`${values[0]}-${values[1]}`];
  if (!score) throw new NumerologyOrderError('NUMEROLOGY_PAIR_UNSUPPORTED');
  return score;
}

function clampScore(value) {
  return Math.max(28, Math.min(96, Math.round(value)));
}

export function calculatePatternDimensions(firstLifePath, secondLifePath, baseScore) {
  const a = Number(firstLifePath);
  const b = Number(secondLifePath);
  const base = Number(baseScore);
  return {
    attraction: clampScore(base + (a + b) % 9 - 4),
    communication: clampScore(base + Math.abs(a - b) % 7 - 3),
    emotionalRhythm: clampScore(base + (a * b) % 11 - 5),
    commitmentPace: clampScore(base + (a + b * 2) % 13 - 6),
    growthPotential: clampScore(base + (a * b + a + b) % 9 - 4),
  };
}

function normalizeBirthName(value) {
  const cleaned = text(value, 120).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const letters = cleaned.replace(/[^A-Z]/g, '');
  return { display: text(value, 120), letters };
}

function letterValue(letter) {
  return (letter.charCodeAt(0) - 65) % 9 + 1;
}

export function calculateNameNumbers(value) {
  const name = normalizeBirthName(value);
  if (name.letters.length < 2) throw new NumerologyOrderError('NUMEROLOGY_FULL_BIRTH_NAME_REQUIRED');
  let expression = 0;
  let soulUrge = 0;
  let personality = 0;
  for (const letter of name.letters) {
    const number = letterValue(letter);
    expression += number;
    if ('AEIOU'.includes(letter)) soulUrge += number;
    else personality += number;
  }
  return {
    expression: reduceNumber(expression),
    soulUrge: reduceNumber(soulUrge),
    personality: reduceNumber(personality),
  };
}

function personalYear(date, year) {
  const yearSum = String(year).split('').reduce((sum, digit) => sum + Number(digit), 0);
  return reduceNumber(reduceNumber(date.month) + reduceNumber(date.day) + reduceNumber(yearSum));
}

function birthdayNumber(date) {
  return reduceNumber(date.day);
}

function archetype(score) {
  if (score >= 85) return 'Harmonious Builders';
  if (score >= 75) return 'Complementary Growth Pair';
  if (score >= 60) return 'Dynamic Balance';
  return 'Growth-Edge Pair';
}

function defaultQuestion(connectionLabel, focusLabel, premiumFocusLabel) {
  return `What should I understand about ${premiumFocusLabel.toLowerCase()} in this ${connectionLabel.toLowerCase()} connection, especially around ${focusLabel.toLowerCase()}?`;
}

function tierDeliverables(tier) {
  if (tier === 'premium') return [
    'Life Path, Expression, Soul Urge, Personality and Birthday synthesis',
    'Rolling 12-month Personal Year timing for both people',
    'Long-term dynamics, conflict loop and both perspectives',
    'A practical 30-day relationship plan',
  ];
  if (tier === 'medium') return [
    'Life Path, Expression and Soul Urge synthesis',
    'Communication style and emotional needs',
    'The recurring conflict loop from both perspectives',
    'Concrete repair and next-step guidance',
  ];
  return [
    'Life Path pair deep dive',
    'Attraction and communication pattern',
    'One core strength and one friction point',
    'A practical 7-day relationship experiment',
  ];
}

export function isNumerologyCompatibilityItem(item) {
  const type = property(item, ['reading type', 'type']).toLowerCase();
  const product = property(item, ['numerology product']).toLowerCase();
  return type === 'numerology compatibility' || product === 'compatibility';
}

export function validateNumerologyCompatibilityOrder(payload, items) {
  const candidates = (Array.isArray(items) ? items : []).filter(isNumerologyCompatibilityItem);
  if (!candidates.length) return null;
  if (candidates.length !== 1) throw new NumerologyOrderError('NUMEROLOGY_SINGLE_REPORT_REQUIRED');
  const item = candidates[0];
  const variantId = text(item.variant_id, 64);
  const variant = NUMEROLOGY_VARIANTS[variantId];
  if (!variant) throw new NumerologyOrderError('NUMEROLOGY_VARIANT_NOT_ALLOWED');
  if (text(item.sku, 80).toUpperCase() !== variant.sku) throw new NumerologyOrderError('NUMEROLOGY_VARIANT_SKU_MISMATCH');
  if ((Number.parseInt(String(item.quantity || 1), 10) || 1) !== 1) throw new NumerologyOrderError('NUMEROLOGY_QUANTITY_INVALID');

  const claimedTier = property(item, ['package tier']).toLowerCase();
  if (claimedTier && claimedTier !== variant.tier) throw new NumerologyOrderError('NUMEROLOGY_PACKAGE_TIER_MISMATCH');

  const connectionKey = property(item, ['connection type']);
  const compatibilityFocusKey = property(item, ['compatibility focus']);
  const premiumFocusKey = property(item, ['premium focus']);
  const connectionLabel = CONNECTIONS[connectionKey];
  const compatibilityFocusLabel = FOCUSES[compatibilityFocusKey];
  const premiumFocusLabel = PREMIUM_FOCUSES[premiumFocusKey];
  if (!connectionLabel) throw new NumerologyOrderError('NUMEROLOGY_CONNECTION_TYPE_INVALID');
  if (!compatibilityFocusLabel) throw new NumerologyOrderError('NUMEROLOGY_COMPATIBILITY_FOCUS_INVALID');
  if (!premiumFocusLabel) throw new NumerologyOrderError('NUMEROLOGY_PREMIUM_FOCUS_INVALID');

  const firstDate = parseBirthDate(property(item, ['person a birth date']));
  const secondDate = parseBirthDate(property(item, ['person b birth date']));
  if (!firstDate || !secondDate) throw new NumerologyOrderError('NUMEROLOGY_BIRTH_DATE_INVALID');
  const firstLifePath = calculateLifePath(firstDate);
  const secondLifePath = calculateLifePath(secondDate);
  const score = calculateCompatibilityScore(firstLifePath, secondLifePath);
  if (Number(property(item, ['person a life path'])) !== firstLifePath
    || Number(property(item, ['person b life path'])) !== secondLifePath
    || Number(property(item, ['pattern score'])) !== score) {
    throw new NumerologyOrderError('NUMEROLOGY_CALCULATION_MISMATCH');
  }

  const firstName = property(item, ['person a name']);
  const secondName = property(item, ['person b name']);
  const namesRequired = variant.tier !== 'standard';
  if (namesRequired && (!firstName || !secondName)) throw new NumerologyOrderError('NUMEROLOGY_FULL_BIRTH_NAME_REQUIRED');
  const firstNameNumbers = namesRequired ? calculateNameNumbers(firstName) : null;
  const secondNameNumbers = namesRequired ? calculateNameNumbers(secondName) : null;
  const dimensions = calculatePatternDimensions(firstLifePath, secondLifePath, score);
  const paidAt = new Date(String(payload?.created_at || ''));
  const reportYear = Number.isFinite(paidAt.getTime()) ? paidAt.getUTCFullYear() : new Date().getUTCFullYear();
  const first = {
    birthDate: firstDate.iso,
    lifePath: firstLifePath,
    birthday: birthdayNumber(firstDate),
    personalYear: personalYear(firstDate, reportYear),
    nextPersonalYear: personalYear(firstDate, reportYear + 1),
    name: firstName || '',
    ...(firstNameNumbers || {}),
  };
  const second = {
    birthDate: secondDate.iso,
    lifePath: secondLifePath,
    birthday: birthdayNumber(secondDate),
    personalYear: personalYear(secondDate, reportYear),
    nextPersonalYear: personalYear(secondDate, reportYear + 1),
    name: secondName || '',
    ...(secondNameNumbers || {}),
  };

  const submittedQuestion = property(item, ['question', 'your question']);
  const question = text(submittedQuestion || defaultQuestion(connectionLabel, compatibilityFocusLabel, premiumFocusLabel), 400);
  const nameEvidence = namesRequired
    ? ` Person A name numbers: Expression ${first.expression}, Soul Urge ${first.soulUrge}${variant.tier === 'premium' ? `, Personality ${first.personality}` : ''}. Person B name numbers: Expression ${second.expression}, Soul Urge ${second.soulUrge}${variant.tier === 'premium' ? `, Personality ${second.personality}` : ''}.`
    : '';
  const timingEvidence = variant.tier === 'premium'
    ? ` Rolling timing: Person A Personal Year ${first.personalYear} in ${reportYear} and ${first.nextPersonalYear} in ${reportYear + 1}; Person B Personal Year ${second.personalYear} in ${reportYear} and ${second.nextPersonalYear} in ${reportYear + 1}. Birthday numbers: ${first.birthday} and ${second.birthday}.`
    : '';
  const signals = text(`Person A: Life Path ${firstLifePath}. Person B: Life Path ${secondLifePath}. Compatibility score: ${score}/100. Archetype: ${archetype(score)}.${nameEvidence}${timingEvidence}`, 400);
  const context = text(`Connection: ${connectionLabel}. Free-result focus: ${compatibilityFocusLabel}. Paid-report focus: ${premiumFocusLabel}. Birth dates: ${firstDate.iso} and ${secondDate.iso}. Five pattern dimensions: attraction ${dimensions.attraction}, communication ${dimensions.communication}, emotional rhythm ${dimensions.emotionalRhythm}, commitment pace ${dimensions.commitmentPace}, growth ${dimensions.growthPotential}.`, 400);
  const scope = variant.tier === 'premium'
    ? 'Complete relationship blueprint using the supplied date and Pythagorean full-name numbers, rolling 12-month timing, both perspectives, long-term dynamics and a 30-day plan.'
    : variant.tier === 'medium'
      ? 'Full-name compatibility using Life Path, Expression and Soul Urge numbers, emotional needs, communication and the recurring conflict loop.'
      : 'Date-based Life Path pair deep dive covering attraction, communication, one strength, one friction point and a practical 7-day step.';
  const confidence = namesRequired
    ? 'Dates and Pythagorean name numbers recalculated server-side; reflective numerology, not scientific prediction.'
    : 'Both Life Path numbers and the pair score recalculated server-side; reflective numerology, not scientific prediction.';
  const orderId = text(payload?.id, 96);
  const readingId = `numerology-${orderId || text(item.id, 64) || 'report'}`.slice(0, 80);

  return {
    kind: 'compatibility',
    deliveryDelayMinutes: NUMEROLOGY_DELIVERY_DELAY_MINUTES,
    variantId,
    tier: variant.tier,
    packageLabel: variant.label,
    sku: variant.sku,
    question,
    first,
    second,
    score,
    dimensions,
    archetype: archetype(score),
    connectionKey,
    connectionLabel,
    compatibilityFocusKey,
    compatibilityFocusLabel,
    premiumFocusKey,
    premiumFocusLabel,
    deliverables: tierDeliverables(variant.tier),
    verifiedFields: {
      question,
      curiosityQuestion: question,
      type: 'Numerology Compatibility',
      context,
      dob: `Person A ${firstDate.iso}; Person B ${secondDate.iso}`,
      name: text(firstName || payload?.customer?.first_name || payload?.billing_address?.first_name, 40),
      cards: '',
      spread: 'Two-person numerology compatibility blueprint',
      lang: property(item, ['language', 'lang']) || 'en',
      signals,
      scope,
      confidence,
      tool: '/pages/numerology-calculator · Numerology Compatibility Calculator',
      focus: `${compatibilityFocusLabel}; ${premiumFocusLabel}`,
      readingId,
      funnelVersion: NUMEROLOGY_FUNNEL_VERSION,
      snapshotVersion: NUMEROLOGY_SNAPSHOT_VERSION,
      snapshotFingerprint: '',
      freeToken: '',
      conversationId: '',
      tier: variant.tier,
    },
  };
}
