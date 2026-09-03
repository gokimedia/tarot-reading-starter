import {
  Body,
  Ecliptic,
  EclipticGeoMoon,
  Equator,
  GeoVector,
  Observer,
  SiderealTime,
  SunPosition,
} from 'astronomy-engine';

const PAGE_TYPES = Object.freeze({
  '/pages/name-numerology-calculator': 'Numerology Blueprint',
  '/pages/personal-year-calculator': 'Personal Year Numerology',
  '/pages/karmic-debt-calculator': 'Karmic Debt Numerology',
  '/pages/destiny-matrix-calculator': 'Destiny Matrix',
  '/pages/aura-color-quiz': 'Aura Color',
  '/pages/chakra-test': 'Chakra Balance',
  '/pages/midheaven-calculator': 'Midheaven Astrology',
  '/pages/mars-sign-calculator': 'Mars Sign Astrology',
  '/pages/mercury-sign-calculator': 'Mercury Sign Astrology',
  '/pages/chiron-sign-calculator': 'Chiron Astrology',
  '/pages/transit-chart-calculator': 'Personal Transit Chart',
  '/pages/solar-return-chart-calculator': 'Solar Return Astrology',
  '/pages/astrocartography-calculator': 'Astrocartography',
  '/pages/nakshatra-calculator': 'Nakshatra',
  '/pages/sade-sati-calculator': 'Sade Sati',
  '/pages/dream-interpreter': 'Dream Interpretation',
  '/pages/i-ching-reading': 'I Ching',
  '/pages/pendulum-reading': 'Pendulum',
  '/pages/lenormand-reading': 'Lenormand',
  '/pages/attachment-style-quiz': 'Attachment Style',
});

const TYPE_PAGES = Object.freeze(Object.fromEntries(Object.entries(PAGE_TYPES).map(([page, type]) => [type, page])));
const MASTER = new Set([11, 22, 33]);
const DEBTS = new Set([13, 14, 16, 19]);
const COLORS = ['violet', 'indigo', 'blue', 'green', 'yellow', 'orange', 'red'];
const CHAKRAS = ['root', 'sacral', 'solar', 'heart', 'throat', 'third-eye', 'crown'];
const ATTACHMENT_CONTEXTS = ['current-relationship', 'recent-relationship', 'close-relationships-general'];
const ATTACHMENT_STAGES = ['early-dating', 'dating', 'exclusive', 'long-term', 'breakup', 'no-contact', 'friendship', 'other'];
const ATTACHMENT_DIMENSIONS = Object.freeze([
  Object.freeze(['connection anxiety', Object.freeze([0, 4, 6, 10, 14])]),
  Object.freeze(['distance response', Object.freeze([1, 5, 9, 11, 15])]),
  Object.freeze(['secure base', Object.freeze([2, 3, 7, 8, 12, 13])]),
]);
const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const RASHIS = ['Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya', 'Tula', 'Vrishchika', 'Dhanu', 'Makara', 'Kumbha', 'Meena'];
const NAKSHATRAS = ['Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha', 'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati'];
const DREAM_THEMES = ['Water', 'Falling', 'Flying', 'Teeth', 'Being chased', 'Death or ending', 'Snake', 'House or room', 'Door or key', 'Baby or child', 'Fire', 'Test or school', 'Vehicle or journey', 'Bridge', 'Phone or message', 'Wedding or union', 'Unresolved scene'];
const DREAM_CONTEXT = 'Privacy-minimized result; Deckaura used allowlisted themes, tone and a length band to create this reflection. Raw dream text was not retained or attached to checkout.';
const DREAM_SCOPE = 'Reflect only on allowlisted dream themes and the selected tone; no diagnosis, recovered-memory claim, factual third-party claim or prediction.';
const DREAM_CONFIDENCE = 'Symbolic reflection generated from allowlisted themes; personal meaning may differ.';
const DREAM_V2_THEMES = ['Change & Uncertainty', 'Attachment & Unfinished Feeling', 'Pressure & Control', 'Loss & Connection', 'Identity & Self-Worth'];
const DREAM_V2_EMOTIONS = ['Anxious', 'Afraid', 'Sad', 'Calm', 'Confused', 'Relieved', 'Curious', 'Other'];
const DREAM_V2_RECURRENCE = ['First time', 'Similar before', 'Recurring'];
const DREAM_V2_SYMBOLS = ['Water', 'Snake', 'Teeth falling out', 'Falling', 'Being chased', 'An ex-partner', 'Cheating', 'A house with unknown rooms', 'A baby', 'Death', 'Someone who passed away', 'Late or unprepared', 'Flying', 'Fire', 'A vehicle you cannot steer', 'A faceless stranger', 'A door that will not open', 'Losing something'];
const DREAM_V2_FOCUS = ['Love & relationships', 'Ex & closure', 'Change & transition', 'Career or decision', 'Grief & connection', 'Anxiety & boundaries', 'Symbolic or spiritual meaning'];
const DREAM_V2_APPROACHES = ['Grounded & emotional', 'Symbolic & spiritual', 'Balanced'];
const DREAM_V2_IMPORTANCE = ['Someone I love or an ex', 'It keeps repeating', 'It felt like a warning', 'I am going through a major change', 'I woke up anxious', 'Someone who passed away appeared', 'I am curious about the symbols'];
const DREAM_V2_READING_NAMES = ['What This Dream Means', 'Why This Dream, Why Now?', 'The Pattern Behind Your Dreams', 'Complete Dream & Waking-Life Map', 'Relationship Dream Reading', 'Recurring Dream Pattern Reading', 'Grounded Meaning & Reassurance', 'Transition Dream Reading', 'Emotional Trigger Dream Reading', 'Grief & Connection Dream Reflection', 'In-Depth Symbol Combination Reading'];
const DREAM_V2_CONFIDENCE = 'Grounded dream reflection, not a prediction, diagnosis, or claim about another person.';
const I_CHING_SCOPE = 'King Wen hexagram identity, primary/relating trigram structure and changing lines only; no fabricated translated oracle passage.';
const PAGE_SCOPES = Object.freeze({
  '/pages/name-numerology-calculator': 'A synthesis of the five deterministic Pythagorean numerology scores shown above, applied to the selected focus with practical reflection prompts.',
  '/pages/personal-year-calculator': 'A timing-focused numerology reflection for the selected target year, including its month sequence, priorities, cautions and practical planning prompts.',
  '/pages/karmic-debt-calculator': 'A non-punitive reflection on the explicitly checked compound-number positions and a practical habit to test in the selected focus.',
  '/pages/destiny-matrix-calculator': 'A synthesis of the seven visible Deckaura 22-energy positions, their Major Arcana archetypes and practical reflection prompts for the selected focus.',
  '/pages/aura-color-quiz': 'Apply the AQ1 color-archetype pattern only to the user-selected reflective focus. Do not present an energy-field measurement, health assessment, diagnosis, fixed identity or guaranteed outcome.',
  '/pages/chakra-test': 'Apply the CT1 symbolic themes only to the user-selected reflective focus. Do not claim a blocked chakra, energy diagnosis, medical or mental-health assessment, treatment effect, fixed identity or guaranteed outcome.',
  '/pages/midheaven-calculator': 'Tropical Midheaven sign and degree only; no houses or complete natal chart.',
  '/pages/mars-sign-calculator': 'Tropical geocentric Mars placement and motion only.',
  '/pages/mercury-sign-calculator': 'Tropical geocentric Mercury placement and motion only.',
  '/pages/chiron-sign-calculator': 'Chiron sign only; no degree, house or aspects.',
  '/pages/transit-chart-calculator': 'Major geocentric aspects from transiting Mars–Pluto to natal Sun–Saturn; 3° orb; no houses.',
  '/pages/solar-return-chart-calculator': 'Exact solar-longitude return moment only; no return houses or angles without return location.',
  '/pages/astrocartography-calculator': 'Single-city angular proximity scan; no global map, parans or local-space lines.',
  '/pages/nakshatra-calculator': 'Sidereal Moon Nakshatra and pada only; no dashas, houses or full Jyotish chart.',
  '/pages/sade-sati-calculator': 'Traditional three-sign Sade Sati status only; no dasha or event prediction.',
  '/pages/dream-interpreter': DREAM_SCOPE,
  '/pages/i-ching-reading': I_CHING_SCOPE,
  '/pages/pendulum-reading': 'Single symbolic three-way result; not factual prediction or high-stakes advice.',
  '/pages/lenormand-reading': 'Three-card Lenormand line only; no factual claim about third parties or guaranteed outcome.',
  '/pages/attachment-style-quiz': "Reflect only on the supplied AS1 answer vector, its three dimension scores and the optional conversation excerpt for the selected relationship context. No diagnosis, no fixed attachment label as identity, no claim about the other person's hidden feelings, no prediction or guaranteed outcome.",
});
const PAGE_CONFIDENCES = Object.freeze({
  '/pages/name-numerology-calculator': 'Deterministic symbolic calculation; numerology is not scientifically validated.',
  '/pages/personal-year-calculator': 'Deterministic symbolic calculation; timing themes are reflective, not predictive.',
  '/pages/karmic-debt-calculator': 'Deterministic symbolic check; karmic debt is a tradition-specific belief, not a scientific fact.',
  '/pages/destiny-matrix-calculator': 'Deterministic Deckaura symbolic matrix; not a standardized or scientifically validated system.',
  '/pages/aura-color-quiz': 'Deterministic AQ1 scoring from seven canonical answer indices; symbolic self-reflection only.',
  '/pages/chakra-test': 'Deterministic CT1 scoring from 14 canonical 0-3 answer indices; symbolic self-reflection only.',
  '/pages/midheaven-calculator': 'Astronomy-derived; exact time, UTC offset and longitude supplied.',
  '/pages/mars-sign-calculator': 'Astronomy Engine ephemeris; exact UTC birth moment.',
  '/pages/mercury-sign-calculator': 'Astronomy Engine ephemeris; exact UTC birth moment.',
  '/pages/chiron-sign-calculator': 'JPL daily sign interval; one-day boundary precision.',
  '/pages/transit-chart-calculator': 'Astronomy Engine ephemeris; natal moment exact; transit evaluated 12:00 UTC.',
  '/pages/solar-return-chart-calculator': 'Astronomy Engine numerical search; minute-level return moment.',
  '/pages/astrocartography-calculator': 'Astronomy-derived equatorial positions; exact supplied coordinates and birth moment.',
  '/pages/nakshatra-calculator': 'Astronomy Engine Moon plus date-adjusted Lahiri-style ayanamsa; boundary estimate.',
  '/pages/sade-sati-calculator': 'Astronomy Engine positions plus date-adjusted Lahiri-style ayanamsa.',
  '/pages/dream-interpreter': DREAM_CONFIDENCE,
  '/pages/i-ching-reading': 'Independent cryptographic three-coin cast.',
  '/pages/pendulum-reading': 'Balanced cryptographic random draw.',
  '/pages/lenormand-reading': 'Without-replacement cryptographic draw from canonical 36-card deck.',
  '/pages/attachment-style-quiz': 'Deterministic AS1 scoring from 16 canonical 1-5 answers; educational self-reflection, not a validated or clinical psychological assessment.',
});
const TRIGRAMS = Object.freeze({
  '111': Object.freeze(['Heaven', 0]),
  '110': Object.freeze(['Lake', 1]),
  '101': Object.freeze(['Fire', 2]),
  '100': Object.freeze(['Thunder', 3]),
  '011': Object.freeze(['Wind', 4]),
  '010': Object.freeze(['Water', 5]),
  '001': Object.freeze(['Mountain', 6]),
  '000': Object.freeze(['Earth', 7]),
});
const KING_WEN_NUMBERS = Object.freeze([
  Object.freeze([1,43,14,34,9,5,26,11]), Object.freeze([10,58,38,54,61,60,41,19]),
  Object.freeze([13,49,30,55,37,63,22,36]), Object.freeze([25,17,21,51,42,3,27,24]),
  Object.freeze([44,28,50,32,57,48,18,46]), Object.freeze([6,47,64,40,59,29,4,7]),
  Object.freeze([33,31,56,62,53,39,52,15]), Object.freeze([12,45,35,16,20,8,23,2]),
]);
const KING_WEN_NAMES = Object.freeze([
  '', 'The Creative', 'The Receptive', 'Difficulty at the Beginning', 'Youthful Folly', 'Waiting', 'Conflict', 'The Army', 'Holding Together', 'Small Taming', 'Treading', 'Peace', 'Standstill', 'Fellowship', 'Great Possession', 'Modesty', 'Enthusiasm', 'Following', 'Work on What Has Been Spoiled', 'Approach', 'Contemplation', 'Biting Through', 'Grace', 'Splitting Apart', 'Return', 'Innocence', 'Great Taming', 'Nourishment', 'Great Preponderance', 'The Abysmal', 'The Clinging', 'Influence', 'Duration', 'Retreat', 'Great Power', 'Progress', 'Darkening of the Light', 'The Family', 'Opposition', 'Obstruction', 'Deliverance', 'Decrease', 'Increase', 'Breakthrough', 'Coming to Meet', 'Gathering Together', 'Pushing Upward', 'Oppression', 'The Well', 'Revolution', 'The Cauldron', 'The Arousing', 'Keeping Still', 'Development', 'The Marrying Maiden', 'Abundance', 'The Wanderer', 'The Gentle', 'The Joyous', 'Dispersion', 'Limitation', 'Inner Truth', 'Small Preponderance', 'After Completion', 'Before Completion',
]);
const CHIRON_INGRESSES = [
  ['1900-01-01',8],['1901-01-14',9],['1901-08-09',8],['1901-10-01',9],['1904-04-23',10],['1904-05-21',9],['1905-01-14',10],['1910-03-21',11],['1910-08-30',10],['1911-01-16',11],['1918-04-01',0],['1918-10-23',11],['1919-01-29',0],['1926-05-26',1],['1926-10-21',0],['1927-03-26',1],['1933-06-08',2],['1933-12-23',1],['1934-03-24',2],['1937-08-28',3],['1937-11-24',2],['1938-05-29',3],['1940-10-01',4],['1940-12-28',3],['1941-06-17',4],['1943-07-27',5],['1944-11-19',6],['1945-03-25',5],['1945-07-23',6],['1946-11-11',7],['1948-11-29',8],['1951-02-10',9],['1951-06-19',8],['1951-11-09',9],['1955-01-28',10],['1960-03-27',11],['1960-08-20',10],['1961-01-22',11],['1968-04-02',0],['1968-10-19',11],['1969-01-31',0],['1976-05-29',1],['1976-10-14',0],['1977-03-29',1],['1983-06-22',2],['1983-11-30',1],['1984-04-12',2],['1988-06-22',3],['1991-07-22',4],['1993-09-04',5],['1995-09-10',6],['1996-12-30',7],['1997-04-05',6],['1997-09-04',7],['1999-01-08',8],['1999-06-02',7],['1999-09-23',8],['2001-12-12',9],['2005-02-22',10],['2005-08-02',9],['2005-12-07',10],['2010-04-21',11],['2010-07-21',10],['2011-02-09',11],['2018-04-18',0],['2018-09-27',11],['2019-02-19',0],['2026-06-20',1],['2026-09-19',0],['2027-04-15',1],['2033-07-20',2],['2033-10-24',1],['2034-05-06',2],['2038-07-23',3],['2039-01-09',2],['2039-04-27',3],['2041-08-29',4],['2042-02-11',3],['2042-05-17',4],['2043-10-24',5],['2044-02-11',4],['2044-07-02',5],['2045-10-25',6],['2047-10-23',7],['2049-11-10',8],['2052-01-17',9],['2052-07-29',8],['2052-10-07',9],['2055-04-04',10],['2055-06-11',9],['2056-01-06',10],['2061-02-28',11],['2061-09-30',10],['2061-12-18',11],['2068-05-04',0],['2068-09-04',11],['2069-03-05',0],['2077-04-30',1],['2077-11-23',0],['2078-02-25',1],['2084-05-26',2],['2085-01-15',1],['2085-03-01',2],['2088-08-29',3],['2088-11-19',2],['2089-05-30',3],['2092-07-01',4],['2094-08-16',5],['2096-08-21',6],['2097-12-04',7],['2098-05-18',6],['2098-08-05',7],['2099-12-17',8],
];
const LENORMAND = [
  ['Rider','news'],['Clover','opportunity'],['Ship','movement'],['House','home'],['Tree','growth'],['Clouds','uncertainty'],['Snake','complexity'],['Coffin','closure'],['Bouquet','appreciation'],['Scythe','a sudden cut'],['Whip','repetition'],['Birds','conversation'],['Child','a beginning'],['Fox','strategy'],['Bear','strength'],['Stars','guidance'],['Stork','change'],['Dog','loyalty'],['Tower','boundaries'],['Garden','community'],['Mountain','an obstacle'],['Crossroads','a choice'],['Mice','gradual erosion'],['Heart','affection'],['Ring','commitment'],['Book','hidden knowledge'],['Letter','a message'],['Man','a person'],['Woman','a person'],['Lily','maturity'],['Sun','success'],['Moon','recognition'],['Key','a solution'],['Fish','resources'],['Anchor','stability'],['Cross','responsibility'],
];

const AURA_WEIGHTS = [
  [[4,2,0,0,0,0,0],[0,0,3,3,0,0,0],[0,0,0,0,1,4,1],[0,0,0,1,1,0,4]],
  [[3,3,0,0,0,0,0],[0,1,4,1,0,0,0],[0,0,1,4,1,0,0],[0,0,0,0,1,2,3]],
  [[2,4,0,0,0,0,0],[0,1,4,0,1,0,0],[0,0,1,4,1,0,0],[0,0,0,0,1,1,4]],
  [[3,3,0,0,0,0,0],[0,0,4,2,0,0,0],[0,0,0,1,3,2,0],[0,0,0,0,0,2,4]],
  [[2,4,0,0,0,0,0],[0,0,4,2,0,0,0],[0,0,0,4,2,0,0],[0,0,0,0,0,2,4]],
  [[4,2,0,0,0,0,0],[0,1,4,1,0,0,0],[0,0,0,4,1,1,0],[0,0,0,0,2,2,2]],
  [[4,2,0,0,0,0,0],[2,4,0,0,0,0,0],[0,1,4,1,0,0,0],[0,0,1,4,1,0,0],[0,0,0,1,4,1,0],[0,0,0,0,1,4,1],[0,0,0,0,0,2,4]],
];

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function signals(value) {
  const raw = text(value).replace(/^result signals\s*:\s*/i, '').replace(/\.\s*$/, '');
  const result = new Map();
  if (!raw) return result;
  for (const part of raw.split(/\s*;\s*/)) {
    const split = part.indexOf(':');
    if (split < 1) return new Map();
    const label = text(part.slice(0, split)).toLowerCase();
    if (!label || result.has(label)) return new Map();
    result.set(label, text(part.slice(split + 1)));
  }
  return result;
}

function exactKeys(map, keys) {
  return map.size === keys.length && keys.every((key) => map.has(key));
}

function integer(value, minimum = -Infinity, maximum = Infinity) {
  if (!/^-?\d+$/.test(text(value))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function contextDate(context) {
  const match = /birth date\s+(\d{4}-\d{2}-\d{2})/i.exec(text(context));
  return match ? validDate(match[1]) : null;
}

function sumDigits(value) {
  return String(Math.abs(Number(value) || 0)).split('').reduce((sum, digit) => sum + Number(digit), 0);
}

function trace(value, preserveMaster = true) {
  let current = Math.abs(Number.parseInt(String(value), 10) || 0);
  const stages = [current];
  while (current > 9 && !(preserveMaster && MASTER.has(current))) {
    current = sumDigits(current);
    stages.push(current);
  }
  const debtCompound = stages.find((stage) => DEBTS.has(stage));
  return { value: current, compound: debtCompound || stages[0], stages };
}

function normalizeName(value) {
  let normalized = text(value);
  try { normalized = normalized.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch {}
  normalized = normalized
    .replace(/[\u0141\u0142]/g, 'L').replace(/[\u0110\u0111\u00D0\u00F0]/g, 'D')
    .replace(/[\u00DE\u00FE]/g, 'TH').replace(/[\u00C6\u00E6]/g, 'AE')
    .replace(/[\u0152\u0153]/g, 'OE').replace(/\u00DF/g, 'SS')
    .toUpperCase().replace(/[^A-Z' -]/g, ' ').replace(/['-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { display: normalized, letters: normalized.replace(/[^A-Z]/g, '') };
}

function nameNumbers(value) {
  const normalized = normalizeName(value);
  let all = 0; let vowels = 0; let consonants = 0;
  for (const letter of normalized.letters) {
    const amount = ((letter.charCodeAt(0) - 65) % 9) + 1;
    all += amount;
    if ('AEIOU'.includes(letter)) vowels += amount;
    else consonants += amount;
  }
  return { normalized, expression: trace(all), soulUrge: trace(vowels), personality: trace(consonants) };
}

function lifePath({ year, month, day }) {
  const monthValue = trace(month).value;
  const dayValue = trace(day).value;
  const yearValue = trace(year).value;
  return trace(monthValue + dayValue + yearValue);
}

function arcana(value) {
  let result = Math.abs(Number.parseInt(String(value), 10) || 0);
  while (result > 22) result = sumDigits(result);
  return result || 22;
}

function exactNumeric(map, expected) {
  return Object.entries(expected).every(([key, value]) => integer(map.get(key)) === value);
}

function validateNameNumerology(map, context) {
  const keys = ['life path', 'expression', 'soul urge', 'personality', 'birthday'];
  const date = contextDate(context);
  const nameMatch = /normalized birth name\s+<([^<>]{2,160})>/i.exec(text(context));
  if (!exactKeys(map, keys) || !date || !nameMatch) return false;
  const profile = nameNumbers(nameMatch[1]);
  if (profile.normalized.letters.length < 2 || profile.normalized.display !== text(nameMatch[1]).toUpperCase()) return false;
  const dateText = `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  if (text(context) !== `Calculation input: normalized birth name <${profile.normalized.display}>; birth date ${dateText}. Method: Pythagorean letter values; master numbers 11, 22, and 33 preserved during final reductions.`) return false;
  return exactNumeric(map, {
    'life path': lifePath(date).value,
    expression: profile.expression.value,
    'soul urge': profile.soulUrge.value,
    personality: profile.personality.value,
    birthday: trace(date.day).value,
  });
}

function validatePersonalYear(map, context) {
  const keys = ['personal year', 'target year', 'universal year', 'life path'];
  const date = contextDate(context);
  const targetMatch = /target year\s+(\d{4})/i.exec(text(context));
  if (!exactKeys(map, keys) || !date || !targetMatch) return false;
  const target = integer(targetMatch[1], 1900, 2100);
  if (target === null || target < date.year) return false;
  const dateText = `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  if (text(context) !== `Calculation input: birth date ${dateText}; target year ${target}. Method: reduced birth month + reduced birth day + reduced universal year; master numbers 11, 22, and 33 preserved.`) return false;
  const universal = trace(target).value;
  const personal = trace(trace(date.month).value + trace(date.day).value + universal).value;
  return exactNumeric(map, { 'personal year': personal, 'target year': target, 'universal year': universal, 'life path': lifePath(date).value });
}

function validateKarmic(map, context) {
  const keys = ['karmic debt numbers', 'birth day compound', 'life path compound', 'life path', 'expression compound'];
  const date = contextDate(context);
  if (!exactKeys(map, keys) || !date) return false;
  const path = lifePath(date);
  const nameMatch = /normalized birth name\s+<([^<>]{2,160})>/i.exec(text(context));
  const profile = nameMatch ? nameNumbers(nameMatch[1]) : null;
  if (profile && (profile.normalized.letters.length < 2 || profile.normalized.display !== text(nameMatch[1]).toUpperCase())) return false;
  const dateText = `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  const input = profile
    ? `normalized birth name <${profile.normalized.display}>; birth date ${dateText}`
    : `birth date ${dateText}; normalized birth name not provided`;
  if (text(context) !== `Calculation input: ${input}. Method: Birth Day, Life Path compound, and optional Pythagorean Expression compound checked for 13, 14, 16, and 19.`) return false;
  const found = [];
  if (DEBTS.has(date.day)) found.push(date.day);
  for (const number of path.stages) if (DEBTS.has(number) && !found.includes(number)) found.push(number);
  if (profile) for (const number of profile.expression.stages) if (DEBTS.has(number) && !found.includes(number)) found.push(number);
  const expectedDebt = found.length ? found.join(', ') : 'No marker in checked positions';
  return map.get('karmic debt numbers') === expectedDebt
    && integer(map.get('birth day compound')) === date.day
    && integer(map.get('life path compound')) === path.compound
    && integer(map.get('life path')) === path.value
    && map.get('expression compound') === (profile ? String(profile.expression.compound) : 'Not provided');
}

function validateDestiny(map, context) {
  const keys = ['day energy', 'month energy', 'year energy', 'core energy', 'love line', 'money line', 'karmic tail'];
  const date = contextDate(context);
  if (!exactKeys(map, keys) || !date) return false;
  const dateText = `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  if (text(context) !== `Calculation input: birth date ${dateText}. Method: Deckaura 22-energy matrix; values above 22 are reduced by digit sum until 1–22.`) return false;
  const day = arcana(date.day); const month = arcana(date.month); const year = arcana(sumDigits(date.year));
  const core = arcana(day + month + year); const love = arcana(day + core); const money = arcana(month + core);
  const tailA = arcana(day + month); const tailB = arcana(month + year); const tailC = arcana(tailA + tailB);
  return exactNumeric(map, { 'day energy': day, 'month energy': month, 'year energy': year, 'core energy': core, 'love line': love, 'money line': money })
    && map.get('karmic tail') === `${tailA}-${tailB}-${tailC}`;
}

function parseVector(value, prefix, length, limits) {
  const match = new RegExp(`^${prefix}:([0-9](?:-[0-9]){${length - 1}})$`, 'i').exec(text(value));
  if (!match) return null;
  const result = match[1].split('-').map(Number);
  return result.every((number, index) => number >= 0 && number <= limits[index]) ? result : null;
}

function parseScoreVector(value, labels, maximum) {
  const parts = text(value).split('|');
  if (parts.length !== labels.length) return null;
  const scores = [];
  for (let index = 0; index < labels.length; index += 1) {
    const match = /^([^:]+):(\d+)$/.exec(parts[index]);
    if (!match || match[1] !== labels[index]) return null;
    const score = integer(match[2], 0, maximum);
    if (score === null) return null;
    scores.push(score);
  }
  return scores;
}

function validateAura(map, context) {
  const keys = ['aura quiz version', 'answer vector', 'primary aura', 'secondary aura', 'score vector', 'questions answered'];
  if (!exactKeys(map, keys) || map.get('aura quiz version') !== 'AQ1' || map.get('questions answered') !== '7/7') return false;
  const answers = parseVector(map.get('answer vector'), 'AQ1', 7, [3,3,3,3,3,3,6]);
  const supplied = parseScoreVector(map.get('score vector'), COLORS, 42);
  if (!answers || !supplied) return false;
  const scores = Array(7).fill(0);
  answers.forEach((answer, question) => AURA_WEIGHTS[question][answer].forEach((weight, color) => { scores[color] += weight; }));
  if (!scores.every((score, index) => score === supplied[index])) return false;
  const ranked = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score || a.index - b.index);
  const primary = `${COLORS[ranked[0].index]}|${ranked[0].score}`;
  const secondary = `${COLORS[ranked[1].index]}|${ranked[1].score}`;
  const expectedContext = `AQ1 deterministic reflective quiz. Answer vector ${map.get('answer vector')}. Primary ${primary.replace('|', ' ')}. Secondary ${secondary.replace('|', ' ')}. Score vector ${map.get('score vector')}.`;
  return map.get('primary aura') === primary
    && map.get('secondary aura') === secondary
    && text(context) === expectedContext;
}

function validateChakra(map, context) {
  const keys = ['chakra test version', 'answer vector', 'reflection focus', 'strongest signal', 'score vector', 'questions answered'];
  if (!exactKeys(map, keys) || map.get('chakra test version') !== 'CT1' || map.get('questions answered') !== '14/14') return false;
  const answers = parseVector(map.get('answer vector'), 'CT1', 14, Array(14).fill(3));
  const supplied = parseScoreVector(map.get('score vector'), CHAKRAS, 6);
  if (!answers || !supplied) return false;
  const scores = CHAKRAS.map((_, index) => answers[index * 2] + answers[index * 2 + 1]);
  if (!scores.every((score, index) => score === supplied[index])) return false;
  const low = scores.map((score, index) => ({ score, index })).sort((a, b) => a.score - b.score || a.index - b.index)[0];
  const high = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score || a.index - b.index)[0];
  const format = (item) => `${CHAKRAS[item.index]}|${item.score}/6|${Math.round(item.score / 6 * 100)}%`;
  const focus = format(low);
  const strongest = format(high);
  const expectedContext = `CT1 deterministic reflective test. Answer vector ${map.get('answer vector')}. Reflection focus ${focus.split('|').slice(0, 2).join(' ')}. Strongest ${strongest.split('|').slice(0, 2).join(' ')}. Score vector ${map.get('score vector')}.`;
  return map.get('reflection focus') === focus
    && map.get('strongest signal') === strongest
    && text(context) === expectedContext;
}

function validateAttachment(map, context) {
  const keys = ['attachment quiz version', 'answer vector', 'relationship context', 'relationship stage', 'score vector', 'questions answered'];
  if (!exactKeys(map, keys) || map.get('attachment quiz version') !== 'AS1' || map.get('questions answered') !== '16/16') return false;
  if (!ATTACHMENT_CONTEXTS.includes(map.get('relationship context'))) return false;
  if (!ATTACHMENT_STAGES.includes(map.get('relationship stage'))) return false;
  const answers = parseVector(map.get('answer vector'), 'AS1', 16, Array(16).fill(5));
  const supplied = parseScoreVector(map.get('score vector'), ATTACHMENT_DIMENSIONS.map((dimension) => dimension[0]), 30);
  if (!answers || !supplied || answers.some((value) => value < 1)) return false;
  const scores = ATTACHMENT_DIMENSIONS.map(([, questions]) => questions.reduce((sum, index) => sum + answers[index], 0));
  if (!scores.every((score, index) => score === supplied[index])) return false;
  const prefix = `AS1 deterministic reflective quiz. Answer vector ${map.get('answer vector')}. Relationship context ${map.get('relationship context')}. Relationship stage ${map.get('relationship stage')}. Score vector ${map.get('score vector')}.`;
  const body = text(context);
  if (body === prefix) return true;
  const marker = ' Conversation excerpt: ';
  if (!body.startsWith(`${prefix}${marker}`)) return false;
  const excerpt = body.slice(prefix.length + marker.length);
  return excerpt.length >= 20 && excerpt.length <= 1200;
}

function normalizeAngle(value) {
  const result = Number(value) % 360;
  return result < 0 ? result + 360 : result;
}

function signedAngle(value) {
  const result = normalizeAngle(value);
  return result > 180 ? result - 360 : result;
}

function signIndex(value) {
  return Math.floor(normalizeAngle(value) / 30) % 12;
}

function signDegree(value) {
  return normalizeAngle(value) % 30;
}

function longitude(body, date) {
  if (body === 'Sun') return normalizeAngle(SunPosition(date).elon);
  if (body === 'Moon') return normalizeAngle(EclipticGeoMoon(date).lon);
  return normalizeAngle(Ecliptic(GeoVector(Body[body], date, true)).elon);
}

function retrograde(body, date) {
  const before = longitude(body, new Date(date.getTime() - 21_600_000));
  const after = longitude(body, new Date(date.getTime() + 21_600_000));
  return signedAngle(after - before) < 0;
}

function isoMinute(date) {
  return date.toISOString().replace(/:\d\d\.\d{3}Z$/, 'Z');
}

function degree(value, digits = 2) {
  return `${Number(value).toFixed(digits)}°`;
}

function placement(value, digits = 2, labels = SIGNS) {
  return `${degree(signDegree(value), digits)} ${labels[signIndex(value)]}`;
}

function birthMoment(context) {
  const match = /birth=(\d{4}-\d{2}-\d{2}); localTime=(\d{2}:\d{2}); utcOffset=([+-]?\d{1,2}(?:\.\d+)?)/i.exec(text(context));
  if (!match) return null;
  const birth = validDate(match[1]);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(match[2]);
  const offset = Number(match[3]);
  const hour = timeMatch ? Number(timeMatch[1]) : NaN;
  const minute = timeMatch ? Number(timeMatch[2]) : NaN;
  if (!birth || birth.year < 1900 || birth.year > 2099 || !timeMatch || hour > 23 || minute > 59
    || !Number.isFinite(offset) || offset < -14 || offset > 14 || !Number.isInteger(offset * 4)) return null;
  const date = new Date(Date.UTC(birth.year, birth.month - 1, birth.day, hour, minute) - offset * 3_600_000);
  return Number.isFinite(date.getTime()) ? { ...birth, date, offset, hour, minute } : null;
}

function exactMomentContext(context, suffix = '') {
  const source = '^Canonical inputs — birth=\\d{4}-\\d{2}-\\d{2}; localTime=\\d{2}:\\d{2}; utcOffset=[+-]\\d{1,2}(?:\\.(?:25|5|75))?'
    + suffix + '\\.$';
  return new RegExp(source).test(text(context));
}

function exactSignals(map, expected) {
  const entries = Object.entries(expected);
  return map.size === entries.length && entries.every(([key, value]) => map.get(key) === value);
}

function evidenceContext(context, scope = '', confidence = '') {
  const suffix = `${scope ? ` Reading scope: ${scope}.` : ''}${confidence ? ` Calculation confidence: ${confidence}.` : ''}`;
  const value = text(context);
  const withoutContract = suffix && value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
  const backgroundMarker = ' Customer background: ';
  const backgroundIndex = withoutContract.indexOf(backgroundMarker);
  if (backgroundIndex < 0) return withoutContract;
  const background = withoutContract.slice(backgroundIndex + backgroundMarker.length);
  return background.length >= 2 && background.length <= 401 && background.endsWith('.')
    ? withoutContract.slice(0, backgroundIndex)
    : withoutContract;
}

function midheaven(date, longitudeValue) {
  const julian = date.getTime() / 86_400_000 + 2_440_587.5;
  const t = (julian - 2_451_545) / 36_525;
  const gmst = normalizeAngle(280.46061837 + 360.98564736629 * (julian - 2_451_545) + 0.000387933 * t * t);
  const ramc = normalizeAngle(gmst + longitudeValue) * Math.PI / 180;
  const obliquity = (23.4392911 - 0.0130042 * t) * Math.PI / 180;
  return normalizeAngle(Math.atan2(Math.sin(ramc), Math.cos(ramc) * Math.cos(obliquity)) * 180 / Math.PI);
}

function lahiri(date) {
  const years = (date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545) / 365.2425;
  return 23.853055 + years * (50.290966 / 3600);
}

function sidereal(value, date) {
  return normalizeAngle(value - lahiri(date));
}

function aspect(gap) {
  return [['conjunct', 0], ['sextile', 60], ['square', 90], ['trine', 120], ['opposite', 180]]
    .map(([name, angle]) => ({ name, orb: Math.abs(gap - angle) }))
    .sort((a, b) => a.orb - b.orb)[0];
}

function validateMidheaven(map, context) {
  const moment = birthMoment(context);
  const longitudeMatch = /longitude=([+-]?\d{1,3}\.\d{4})/i.exec(text(context));
  if (!moment || !longitudeMatch || !exactMomentContext(context, '; longitude=[+-]\\d{1,3}\\.\\d{4}')) return false;
  const locationLongitude = Number(longitudeMatch[1]);
  if (!Number.isFinite(locationLongitude) || locationLongitude < -180 || locationLongitude > 180) return false;
  const value = midheaven(moment.date, locationLongitude);
  return exactSignals(map, {
    midheaven: placement(value),
    'utc birth moment': isoMinute(moment.date),
    'birth longitude': `${locationLongitude >= 0 ? '+' : ''}${locationLongitude.toFixed(4)}°`,
  });
}

function validatePlanet(map, context, planet) {
  const moment = birthMoment(context);
  if (!moment || !exactMomentContext(context)) return false;
  const value = longitude(planet, moment.date);
  return exactSignals(map, {
    [`${planet.toLowerCase()} placement`]: placement(value),
    [`${planet.toLowerCase()} motion`]: retrograde(planet, moment.date) ? 'Retrograde' : 'Direct',
    'utc birth moment': isoMinute(moment.date),
  });
}

function validateChiron(map, context) {
  const match = /birthDate=(\d{4}-\d{2}-\d{2})/i.exec(text(context));
  const birth = match ? validDate(match[1]) : null;
  if (!birth || birth.year < 1900 || birth.year > 2099
    || text(context) !== `Canonical input — birthDate=${match[1]}.`) return false;
  let ingress = CHIRON_INGRESSES[0];
  for (const candidate of CHIRON_INGRESSES) {
    if (candidate[0] <= match[1]) ingress = candidate;
    else break;
  }
  return exactSignals(map, {
    'chiron sign': SIGNS[ingress[1]],
    'ephemeris date': match[1],
    'data source': 'NASA/JPL Horizons · daily geocentric ecliptic-of-date',
  });
}

function chironConfidence(context) {
  const match = /birthDate=(\d{4}-\d{2}-\d{2})/i.exec(text(context));
  const birth = match ? validDate(match[1]) : null;
  if (!birth || birth.year < 1900 || birth.year > 2099) return PAGE_CONFIDENCES['/pages/chiron-sign-calculator'];
  let ingress = CHIRON_INGRESSES[0];
  for (const candidate of CHIRON_INGRESSES) {
    if (candidate[0] <= match[1]) ingress = candidate;
    else break;
  }
  const nearBoundary = Math.abs(Date.parse(`${match[1]}T00:00:00Z`) - Date.parse(`${ingress[0]}T00:00:00Z`)) <= 86_400_000;
  return `${PAGE_CONFIDENCES['/pages/chiron-sign-calculator']}${nearBoundary ? ' Timed confirmation recommended.' : ''}`;
}

function validateTransit(map, context) {
  const moment = birthMoment(context);
  const targetMatch = /transitDate=(\d{4}-\d{2}-\d{2})T12:00:00Z/i.exec(text(context));
  const target = targetMatch ? validDate(targetMatch[1]) : null;
  if (!moment || !target || !exactMomentContext(context, '; transitDate=\\d{4}-\\d{2}-\\d{2}T12:00:00Z')) return false;
  const transitDate = new Date(Date.UTC(target.year, target.month - 1, target.day, 12));
  const natalBodies = ['Sun', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
  const transitBodies = ['Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
  const natal = Object.fromEntries(natalBodies.map((body) => [body, longitude(body, moment.date)]));
  const hits = [];
  for (const transitBody of transitBodies) {
    const transitLongitude = longitude(transitBody, transitDate);
    for (const natalBody of natalBodies) {
      const candidate = aspect(Math.abs(signedAngle(transitLongitude - natal[natalBody])));
      if (candidate.orb <= 3) hits.push({ transitBody, natalBody, ...candidate });
    }
  }
  hits.sort((a, b) => a.orb - b.orb);
  const expected = {
    'natal sun': placement(natal.Sun),
    'transit timestamp': isoMinute(transitDate),
  };
  if (!hits.length) expected['strongest transit'] = 'No major aspect within 3.00°';
  else hits.slice(0, 3).forEach((hit, index) => {
    expected[index === 0 ? 'strongest transit' : index === 1 ? 'second transit' : 'third transit'] = `${hit.transitBody} ${hit.name} natal ${hit.natalBody} · orb ${degree(hit.orb)}`;
  });
  return exactSignals(map, expected);
}

function validateSolarReturn(map, context) {
  const moment = birthMoment(context);
  const yearMatch = /returnYear=(\d{4})/i.exec(text(context));
  const returnYear = yearMatch ? Number(yearMatch[1]) : NaN;
  if (!moment || !Number.isInteger(returnYear) || returnYear <= moment.year || returnYear > 2099
    || !exactMomentContext(context, '; returnYear=\\d{4}')) return false;
  const natal = longitude('Sun', moment.date);
  const approximate = new Date(Date.UTC(
    returnYear,
    moment.month - 1,
    moment.day,
    moment.hour,
    moment.minute,
  ) - moment.offset * 3_600_000);
  let low = approximate.getTime() - 7 * 86_400_000;
  let high = approximate.getTime() + 7 * 86_400_000;
  const deltaAt = (milliseconds) => signedAngle(longitude('Sun', new Date(milliseconds)) - natal);
  if (!(deltaAt(low) <= 0 && deltaAt(high) >= 0)) return false;
  for (let index = 0; index < 48; index += 1) {
    const middle = (low + high) / 2;
    if (deltaAt(middle) < 0) low = middle;
    else high = middle;
  }
  const exact = new Date((low + high) / 2);
  return exactSignals(map, {
    'natal sun': placement(natal, 3),
    'solar return utc': isoMinute(exact),
    'return year': String(returnYear),
    'longitude delta': degree(Math.abs(signedAngle(longitude('Sun', exact) - natal)), 4),
  });
}

function validateAstrocartography(map, context) {
  const moment = birthMoment(context);
  const locationMatch = /latitude=([+-]?\d{1,2}\.\d{4}); longitude=([+-]?\d{1,3}\.\d{4})/i.exec(text(context));
  if (!moment || !locationMatch
    || !exactMomentContext(context, '; latitude=[+-]\\d{1,2}\\.\\d{4}; longitude=[+-]\\d{1,3}\\.\\d{4}')) return false;
  const latitude = Number(locationMatch[1]);
  const locationLongitude = Number(locationMatch[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(locationLongitude) || latitude < -90 || latitude > 90 || locationLongitude < -180 || locationLongitude > 180) return false;
  const contacts = angularContacts(moment.date, latitude, locationLongitude, ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'], 'DC');
  const format = (contact) => `${contact.planet} near ${contact.angle} · ${degree(contact.distance)}`;
  return exactSignals(map, {
    'city coordinates': `${latitude >= 0 ? '+' : ''}${latitude.toFixed(4)}, ${locationLongitude >= 0 ? '+' : ''}${locationLongitude.toFixed(4)}`,
    'birth utc': isoMinute(moment.date),
    'closest angle': format(contacts[0]),
    'second angle': format(contacts[1]),
  });
}

function validateNakshatra(map, context) {
  const moment = birthMoment(context);
  if (!moment || !exactMomentContext(context)) return false;
  const ayanamsa = lahiri(moment.date);
  const moon = sidereal(longitude('Moon', moment.date), moment.date);
  const segment = 360 / 27;
  const index = Math.floor(moon / segment);
  const pada = Math.floor((moon - index * segment) / (segment / 4)) + 1;
  return exactSignals(map, {
    'janma nakshatra': `${NAKSHATRAS[index]} · Pada ${pada}`,
    'sidereal moon': placement(moon, 2, RASHIS),
    'ayanamsa model': `Lahiri-style · ${degree(ayanamsa)}`,
    'birth utc': isoMinute(moment.date),
  });
}

function validateSadeSati(map, context) {
  const moment = birthMoment(context);
  const dateMatch = /evaluationDate=(\d{4}-\d{2}-\d{2})/i.exec(text(context));
  const evaluation = dateMatch ? validDate(dateMatch[1]) : null;
  if (!moment || !evaluation || !exactMomentContext(context, '; evaluationDate=\\d{4}-\\d{2}-\\d{2}')) return false;
  const evaluationDate = new Date(Date.UTC(evaluation.year, evaluation.month - 1, evaluation.day, 12));
  const natalIndex = signIndex(sidereal(longitude('Moon', moment.date), moment.date));
  const saturnIndex = signIndex(sidereal(longitude('Saturn', evaluationDate), evaluationDate));
  const distance = (saturnIndex - natalIndex + 12) % 12;
  const status = distance === 11 ? 'Phase 1 · Saturn 12th from Moon'
    : distance === 0 ? 'Phase 2 · Saturn over Moon sign'
      : distance === 1 ? 'Phase 3 · Saturn 2nd from Moon' : 'Not active';
  return exactSignals(map, {
    'natal moon sign': RASHIS[natalIndex],
    'transit saturn sign': RASHIS[saturnIndex],
    'sade sati status': status,
    'evaluation date': dateMatch[1],
  });
}

function regexSignals(map, rules, optional = {}) {
  const required = Object.keys(rules);
  const allowed = new Set([...required, ...Object.keys(optional)]);
  return required.every((key) => map.has(key))
    && [...map.keys()].every((key) => allowed.has(key))
    && Object.entries(rules).every(([key, pattern]) => pattern.test(map.get(key)))
    && Object.entries(optional).every(([key, pattern]) => !map.has(key) || pattern.test(map.get(key)));
}

const RULES = Object.freeze({
  '/pages/midheaven-calculator': {
    midheaven: /^\d{1,3}\.\d{2}° (?:Aries|Taurus|Gemini|Cancer|Leo|Virgo|Libra|Scorpio|Sagittarius|Capricorn|Aquarius|Pisces)$/,
    'utc birth moment': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/,
    'birth longitude': /^[+-]?\d{1,3}\.\d{4}°$/,
  },
  '/pages/mars-sign-calculator': {
    'mars placement': /^\d{1,3}\.\d{2}° (?:Aries|Taurus|Gemini|Cancer|Leo|Virgo|Libra|Scorpio|Sagittarius|Capricorn|Aquarius|Pisces)$/,
    'mars motion': /^(?:Direct|Retrograde)$/,
    'utc birth moment': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/,
  },
  '/pages/mercury-sign-calculator': {
    'mercury placement': /^\d{1,3}\.\d{2}° (?:Aries|Taurus|Gemini|Cancer|Leo|Virgo|Libra|Scorpio|Sagittarius|Capricorn|Aquarius|Pisces)$/,
    'mercury motion': /^(?:Direct|Retrograde)$/,
    'utc birth moment': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/,
  },
  '/pages/chiron-sign-calculator': { 'chiron sign': /^(?:Aries|Taurus|Gemini|Cancer|Leo|Virgo|Libra|Scorpio|Sagittarius|Capricorn|Aquarius|Pisces)$/, 'ephemeris date': /^\d{4}-\d{2}-\d{2}$/, 'data source': /^NASA\/JPL Horizons · daily geocentric ecliptic-of-date$/ },
  '/pages/transit-chart-calculator': { 'natal sun': /^\d{1,3}\.\d{2}° [A-Z][a-z]+$/, 'transit timestamp': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/, 'strongest transit': /^(?:No major aspect within 3\.00°|[A-Z][a-z]+ (?:conjunct|opposite|trine|square|sextile) natal [A-Z][a-z]+ · orb \d\.\d{2}°)$/ },
  '/pages/solar-return-chart-calculator': { 'natal sun': /^\d{1,3}\.\d{3}° [A-Z][a-z]+$/, 'solar return utc': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/, 'return year': /^\d{4}$/, 'longitude delta': /^\d{1,3}\.\d{4}°$/ },
  '/pages/astrocartography-calculator': { 'city coordinates': /^[+-]?\d{1,2}\.\d{4}, [+-]?\d{1,3}\.\d{4}$/, 'birth utc': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/, 'closest angle': /^[A-Z][a-z]+ near (?:MC|IC|ASC|DC) · \d{1,3}\.\d{2}°$/ },
  '/pages/nakshatra-calculator': { 'janma nakshatra': /^.+ · Pada [1-4]$/, 'sidereal moon': /^\d{1,3}\.\d{2}° [A-Z][a-z]+$/, 'ayanamsa model': /^Lahiri-style · \d{1,3}\.\d{2}°$/, 'birth utc': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/ },
  '/pages/sade-sati-calculator': { 'natal moon sign': /^[A-Z][a-z]+$/, 'transit saturn sign': /^[A-Z][a-z]+$/, 'sade sati status': /^(?:Phase 1 · Saturn 12th from Moon|Phase 2 · Saturn over Moon sign|Phase 3 · Saturn 2nd from Moon|Not active)$/, 'evaluation date': /^\d{4}-\d{2}-\d{2}$/ },
  '/pages/dream-interpreter': { 'dream themes': /^[A-Za-z][A-Za-z ,'-]{0,180}$/, 'emotional tone': /^(?:curious|anxious|sad|calm|confused)$/, 'dream length band': /^(?:under 50 words|50–149 words|150\+ words)$/, 'privacy mode': /^Temporary processing · raw dream excluded from storage, analytics and checkout$/ },
  '/pages/pendulum-reading': { 'pendulum answer': /^(?:Yes|No|Unclear)$/, 'draw clarity': /^(?:Clear|Open)$/, method: /^Web Crypto · balanced three-way draw$/, 'question privacy': /^Local-only · raw question excluded$/ },
  '/pages/lenormand-reading': { 'situation card': /^[A-Za-z][A-Za-z '-]{1,40}$/, 'influence card': /^[A-Za-z][A-Za-z '-]{1,40}$/, 'direction card': /^[A-Za-z][A-Za-z '-]{1,40}$/, 'line theme': /^[A-Za-z][A-Za-z '-]{0,40} · [A-Za-z][A-Za-z '-]{0,40} · [A-Za-z][A-Za-z '-]{0,40}$/, 'question privacy': /^Local-only · raw question excluded$/ },
});

const OPTIONAL_RULES = Object.freeze({
  '/pages/transit-chart-calculator': {
    'second transit': /^[A-Z][a-z]+ (?:conjunct|opposite|trine|square|sextile) natal [A-Z][a-z]+ · orb \d\.\d{2}°$/,
    'third transit': /^[A-Z][a-z]+ (?:conjunct|opposite|trine|square|sextile) natal [A-Z][a-z]+ · orb \d\.\d{2}°$/,
  },
  '/pages/astrocartography-calculator': {
    'second angle': /^[A-Z][a-z]+ near (?:MC|IC|ASC|DC) · \d{1,3}\.\d{2}°$/,
  },
});

function validateIChing(map, context) {
  const keys = ['primary hexagram', 'changing lines', 'relating hexagram', 'cast method'];
  if (!exactKeys(map, keys) || map.get('cast method') !== 'Three coins · Web Crypto') return false;
  const valuesMatch = /^Six line values bottom-to-top=([6789](?:,[6789]){5}); focus=(?:general|love|career|choice|self)\.$/i.exec(text(context));
  if (!valuesMatch) return false;
  const values = valuesMatch[1].split(',').map(Number);
  const primary = values.map((value) => value === 7 || value === 9 ? 1 : 0);
  const relating = values.map((value) => value === 6 ? 1 : value === 9 ? 0 : value === 7 ? 1 : 0);
  const hexagram = (bits) => {
    const lower = TRIGRAMS[bits.slice(0, 3).join('')];
    const upper = TRIGRAMS[bits.slice(3).join('')];
    const number = KING_WEN_NUMBERS[lower[1]][upper[1]];
    return `${number} | ${KING_WEN_NAMES[number]} | ${upper[0]} over ${lower[0]}`;
  };
  const changing = values.map((value, index) => value === 6 || value === 9 ? index + 1 : null).filter(Boolean);
  return map.get('primary hexagram') === hexagram(primary)
    && map.get('relating hexagram') === hexagram(relating)
    && map.get('changing lines') === (changing.length ? changing.join(', ') : 'None');
}

function dreamV2Scope(scope) {
  const match = text(scope).match(/^(.+) dream reading focused on (.+) with a (.+) approach\.$/);
  if (!match) return null;
  return DREAM_V2_READING_NAMES.includes(match[1])
    && DREAM_V2_FOCUS.some((focus) => focus.toLowerCase() === match[2])
    && DREAM_V2_APPROACHES.some((approach) => approach.toLowerCase() === match[3])
    ? { readingName: match[1], focus: match[2], approach: match[3] }
    : null;
}

function validateDreamV2(map, context, snapshot) {
  const scopeParts = dreamV2Scope(snapshot?.scope);
  if (!scopeParts) return false;
  const required = ['dominant theme', 'emotion on waking', 'recurrence', 'detected symbols', 'reading focus', 'approach', 'dream length'];
  if (!required.every((key) => map.has(key))) return false;
  const extras = [...map.keys()].filter((key) => !required.includes(key));
  if (extras.length > 1 || (extras.length === 1 && extras[0] !== 'why it matters')) return false;
  if (!DREAM_V2_THEMES.includes(map.get('dominant theme'))
    || !DREAM_V2_EMOTIONS.includes(map.get('emotion on waking'))
    || !DREAM_V2_RECURRENCE.includes(map.get('recurrence'))
    || !DREAM_V2_FOCUS.includes(map.get('reading focus'))
    || !DREAM_V2_APPROACHES.includes(map.get('approach'))
    || (map.has('why it matters') && !DREAM_V2_IMPORTANCE.includes(map.get('why it matters')))
    || !/^[1-9]\d{0,2} words$/.test(map.get('dream length'))
    || map.get('reading focus').toLowerCase() !== scopeParts.focus
    || map.get('approach').toLowerCase() !== scopeParts.approach) return false;
  const symbolsValue = map.get('detected symbols');
  if (symbolsValue !== 'No single dominant symbol') {
    const names = symbolsValue.split(', ');
    if (names.length < 1 || names.length > 3
      || new Set(names).size !== names.length
      || !names.every((name) => DREAM_V2_SYMBOLS.includes(name))) return false;
  }
  const rawSignals = text(snapshot?.signals).replace(/^result signals\s*:\s*/i, '').replace(/\.\s*$/, '');
  const prefix = `Dream Interpreter V2. ${rawSignals}. Free snapshot: `;
  if (!context.startsWith(prefix)) return false;
  const tail = context.slice(prefix.length);
  const noDreamClause = ' Customer chose not to include the raw dream text; interpret from the structured signals above.';
  const fullMarker = ' Full dream text (customer chose to include it): "';
  const detailsMarker = ' Customer supplied only selected details: "';
  const wakingMarker = ' Recent waking-life context: "';
  let meaning = '';
  if (tail.endsWith(noDreamClause)) {
    meaning = tail.slice(0, -noDreamClause.length);
    if (meaning.includes(fullMarker) || meaning.includes(detailsMarker)) return false;
  } else {
    const fullIndex = tail.indexOf(fullMarker);
    const detailsIndex = tail.indexOf(detailsMarker);
    if ((fullIndex >= 0) === (detailsIndex >= 0) || !tail.endsWith('"')) return false;
    const markerIndex = fullIndex >= 0 ? fullIndex : detailsIndex;
    const marker = fullIndex >= 0 ? fullMarker : detailsMarker;
    meaning = tail.slice(0, markerIndex);
    if (tail.slice(markerIndex + marker.length, -1).length < 8) return false;
    if (detailsIndex >= 0 && tail.includes(wakingMarker)) return false;
  }
  return meaning.length >= 24 && meaning.length <= 900;
}

function validateDream(map, context, snapshot) {
  const keys = ['dream themes', 'emotional tone', 'dream length band', 'privacy mode'];
  if (!exactKeys(map, keys)
    || evidenceContext(context, text(snapshot?.scope), text(snapshot?.confidence)) !== DREAM_CONTEXT
    || text(snapshot?.scope) !== DREAM_SCOPE
    || text(snapshot?.confidence) !== DREAM_CONFIDENCE
    || !/^(?:curious|anxious|sad|calm|confused)$/.test(map.get('emotional tone'))
    || !/^(?:under 50 words|50–149 words|150\+ words)$/.test(map.get('dream length band'))
    || map.get('privacy mode') !== 'Temporary processing · raw dream excluded from storage, analytics and checkout') return false;
  const themes = map.get('dream themes').split(', ').map(text);
  return themes.length >= 1 && themes.length <= 4
    && new Set(themes).size === themes.length
    && themes.every((theme) => DREAM_THEMES.includes(theme));
}

function validatePendulum(map, context) {
  const keys = ['pendulum answer', 'draw clarity', 'method', 'question privacy'];
  if (!exactKeys(map, keys)
    || context !== 'Privacy-minimized symbolic draw; raw free question not retained or transmitted.'
    || map.get('method') !== 'Web Crypto · balanced three-way draw'
    || map.get('question privacy') !== 'Local-only · raw question excluded') return false;
  const answer = map.get('pendulum answer');
  return ['Yes', 'No', 'Unclear'].includes(answer)
    && map.get('draw clarity') === (answer === 'Unclear' ? 'Open' : 'Clear');
}

function validateLenormand(map, context) {
  const keys = ['situation card', 'influence card', 'direction card', 'line theme', 'question privacy'];
  if (!exactKeys(map, keys) || map.get('question privacy') !== 'Local-only · raw question excluded') return false;
  const match = /^Three unique card indexes=(\d{1,2}),(\d{1,2}),(\d{1,2}); focus=(?:general|love|career|choice|self); raw question excluded\.$/i.exec(text(context));
  if (!match) return false;
  const indexes = match.slice(1).map((value) => Number(value) - 1);
  if (new Set(indexes).size !== 3 || indexes.some((index) => index < 0 || index >= LENORMAND.length)) return false;
  const cards = indexes.map((index) => LENORMAND[index]);
  return map.get('situation card') === cards[0][0]
    && map.get('influence card') === cards[1][0]
    && map.get('direction card') === cards[2][0]
    && map.get('line theme') === cards.map((card) => card[1]).join(' · ');
}

/* ------------------------------------------------------------------------ */
/* Storefront enterprise contracts (theme rebuild 2026-08-30).               */
/* The Mars v1, Mercury v2 and Astrocartography v2 pages ship date-only or   */
/* range-based evidence that the exact-moment validators above cannot        */
/* reproduce. Each variant below recomputes the browser result with the same */
/* astronomy-engine sampling the theme uses and rejects anything else.       */
/* ------------------------------------------------------------------------ */

export const STOREFRONT_TYPED_EVIDENCE_CONTRACTS = Object.freeze(['mars-v1', 'mercury-v2', 'astrocartography-v2']);

const MARS_V1 = Object.freeze({
  exactScope: 'Tropical geocentric Mars sign, degree and apparent motion only; no houses, aspects or complete natal chart.',
  exactConfidence: 'Astronomy Engine ephemeris; historical IANA time zone and exact local birth time supplied.',
  dateScope: 'Tropical Mars sign and date-based midpoint degree estimate; no houses, aspects or exact birth-time claims.',
  dateConfidence: 'Astronomy Engine ephemeris; one Mars sign verified across the full possible UTC window for the local birth date.',
});

const MERCURY_V2 = Object.freeze({
  exactScope: 'Tropical geocentric Mercury placement and motion from the exact UTC moment.',
  exactConfidence: 'Astronomy Engine ephemeris; exact UTC birth moment.',
  rangeScope: 'Tropical geocentric Mercury sign and bounded degree range only; no exact-degree claim.',
  rangeConfidence: 'Astronomy Engine ephemeris; Mercury sign stable across the full verified time range.',
});

const ASTROCARTOGRAPHY_V2 = Object.freeze({
  scope: 'Interpret this single-city angular proximity scan as reflective relocation guidance. Do not guarantee events or replace visa, safety, work, healthcare, housing or financial research.',
  exactConfidence: 'Astronomy Engine positions with resolved historical time zone and exact supplied birth time.',
  approximateConfidence: 'Approximate birth time; direction-level location reflection only.',
  bodies: Object.freeze(['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']),
  goals: Object.freeze(['Career & Visibility', 'Love & Relationships', 'Home & Belonging', 'Money & Opportunity', 'Creativity & Reinvention', 'Travel & Personal Growth']),
  modes: Object.freeze(['Moving there', 'Living there now', 'Working or studying', 'Visiting', 'Just exploring']),
});

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const SIGN_NAMES = 'Aries|Taurus|Gemini|Cancer|Leo|Virgo|Libra|Scorpio|Sagittarius|Capricorn|Aquarius|Pisces';
const MARS_V1_EXACT_CONTEXT = /^Canonical inputs — birth=(\d{4}-\d{2}-\d{2}); localTime=(\d{2}):(\d{2}); timeZone=([A-Za-z0-9_+\-/]{1,64}); utcOffset=([+-]?\d{1,2}(?:\.\d{1,2})?)\.$/;
const MARS_V1_DATE_CONTEXT = new RegExp(`^Date-only sign verification — birth=(\\d{4}-\\d{2}-\\d{2}); Mars sign remained (${SIGN_NAMES}) across the complete global UTC window for this local date; midpoint degree is an estimate\\.$`);
const MERCURY_V2_APPROXIMATE_CONTEXT = new RegExp(`^Verified approximate inputs — birth=(\\d{4}-\\d{2}-\\d{2}); localTime=(\\d{2}):(\\d{2}) ±30m; utcOffset=([+-]?\\d{1,2}(?:\\.\\d{1,2})?); Mercury sign stable=(${SIGN_NAMES})\\.$`);
const MERCURY_V2_DATE_CONTEXT = new RegExp(`^Verified date-only inputs — birth=(\\d{4}-\\d{2}-\\d{2}); every possible UTC moment for this calendar date checked; Mercury sign stable=(${SIGN_NAMES}); degree remains a range\\.$`);
const COORDINATE_SIGNAL = /^([+-]?\d{1,2}\.\d{4}), ([+-]?\d{1,3}\.\d{4})$/;
const UTC_MOMENT_SIGNAL = /^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const CONTACT_LABEL = /^[1-6]\. ([a-z]+) near (mc|ic|asc|dsc)$/;
const CONTACT_VALUE = /^(\d{1,3}\.\d{2})° · (Active contact|Nearby contact|Low activation)$/;

function storefrontContract(page, scope, confidence) {
  if (page === '/pages/mars-sign-calculator') {
    if (scope === MARS_V1.exactScope && confidence === MARS_V1.exactConfidence) return 'mars-v1-exact';
    if (scope === MARS_V1.dateScope && confidence === MARS_V1.dateConfidence) return 'mars-v1-date';
    return '';
  }
  if (page === '/pages/mercury-sign-calculator') {
    if (scope === MERCURY_V2.exactScope && confidence === MERCURY_V2.exactConfidence) return 'mercury-v2-exact';
    if (scope === MERCURY_V2.rangeScope && confidence === MERCURY_V2.rangeConfidence) return 'mercury-v2-range';
    return '';
  }
  if (page === '/pages/astrocartography-calculator') {
    return scope === ASTROCARTOGRAPHY_V2.scope
      && (confidence === ASTROCARTOGRAPHY_V2.exactConfidence || confidence === ASTROCARTOGRAPHY_V2.approximateConfidence)
      ? 'astrocartography-v2'
      : '';
  }
  return '';
}

function quarterHourOffset(value) {
  const offset = Number(value);
  return Number.isFinite(offset) && offset >= -14 && offset <= 14 && Number.isInteger(offset * 4) ? offset : null;
}

function localMoment(birth, hour, minute, offset) {
  if (!birth || birth.year < 1900 || birth.year > 2099 || hour > 23 || minute > 59) return null;
  const date = new Date(Date.UTC(birth.year, birth.month - 1, birth.day, hour, minute) - offset * HOUR_MS);
  return Number.isFinite(date.getTime()) ? date : null;
}

function baseUtc(birth) {
  return Date.UTC(birth.year, birth.month - 1, birth.day);
}

/* Mirrors the theme scan: every step from start to end, always including end. */
function sampleLongitudes(body, startMs, endMs, stepMs) {
  const samples = [];
  let cursor = startMs;
  for (; cursor <= endMs; cursor += stepMs) samples.push(longitude(body, new Date(cursor)));
  if (cursor - stepMs !== endMs) samples.push(longitude(body, new Date(endMs)));
  return samples;
}

function stableSign(samples) {
  const seen = new Set(samples.map((value) => signIndex(value)));
  return seen.size === 1 ? [...seen][0] : -1;
}

function motionLabel(body, date) {
  return retrograde(body, date) ? 'Retrograde' : 'Direct';
}

function degreeParts(value) {
  let index = signIndex(value);
  const within = signDegree(value);
  let degrees = Math.floor(within);
  let minutes = Math.round((within - degrees) * 60);
  if (minutes === 60) {
    minutes = 0;
    degrees += 1;
  }
  if (degrees === 30) {
    degrees = 0;
    index = (index + 1) % 12;
  }
  return { index, label: `${degrees}°${String(minutes).padStart(2, '0')}′` };
}

function rangeLabel(start, end) {
  let first = degreeParts(start);
  let last = degreeParts(end);
  if (first.index === last.index) {
    if (signDegree(start) > signDegree(end)) [first, last] = [last, first];
    return `${first.label}–${last.label} ${SIGNS[first.index]}`;
  }
  return `${first.label} ${SIGNS[first.index]} – ${last.label} ${SIGNS[last.index]}`;
}

function validateMarsV1(map, context, mode) {
  const value = text(context);
  if (mode === 'exact') {
    const match = value.match(MARS_V1_EXACT_CONTEXT);
    if (!match) return false;
    const offset = quarterHourOffset(match[5]);
    const date = offset === null ? null : localMoment(validDate(match[1]), Number(match[2]), Number(match[3]), offset);
    if (!date) return false;
    return exactSignals(map, {
      'mars placement': placement(longitude('Mars', date)),
      'mars motion': motionLabel('Mars', date),
      'calculation precision': 'Exact birth moment',
    });
  }
  const match = value.match(MARS_V1_DATE_CONTEXT);
  const birth = match ? validDate(match[1]) : null;
  if (!birth || birth.year < 1900 || birth.year > 2099) return false;
  const base = baseUtc(birth);
  const sign = stableSign(sampleLongitudes('Mars', base - 14 * HOUR_MS, base + 38 * HOUR_MS, 2 * HOUR_MS));
  if (sign < 0 || SIGNS[sign] !== match[2]) return false;
  const center = new Date(base + 12 * HOUR_MS);
  if (signIndex(longitude('Mars', center)) !== sign) return false;
  return exactSignals(map, {
    'mars placement': `Approx. ${placement(longitude('Mars', center))}`,
    'mars motion': motionLabel('Mars', center),
    'calculation precision': 'Date-only sign verified',
  });
}

function validateMercuryV2(map, context, mode) {
  const value = text(context);
  if (mode === 'exact') {
    const moment = birthMoment(context);
    if (!moment || !exactMomentContext(context)) return false;
    return exactSignals(map, {
      'mercury placement': placement(longitude('Mercury', moment.date)),
      'mercury motion': motionLabel('Mercury', moment.date),
      'time evidence': `Exact local time ${String(moment.hour).padStart(2, '0')}:${String(moment.minute).padStart(2, '0')}`,
    });
  }
  const approximate = value.match(MERCURY_V2_APPROXIMATE_CONTEXT);
  const dateOnly = value.match(MERCURY_V2_DATE_CONTEXT);
  let start = 0;
  let end = 0;
  let center = 0;
  let step = 0;
  let evidence = '';
  let signName = '';
  if (approximate) {
    const offset = quarterHourOffset(approximate[4]);
    const moment = offset === null ? null : localMoment(validDate(approximate[1]), Number(approximate[2]), Number(approximate[3]), offset);
    if (!moment) return false;
    center = moment.getTime();
    start = center - 30 * MINUTE_MS;
    end = center + 30 * MINUTE_MS;
    step = 5 * MINUTE_MS;
    evidence = `Approximate local time ${approximate[2]}:${approximate[3]} · verified ±30 minutes`;
    signName = approximate[5];
  } else if (dateOnly) {
    const birth = validDate(dateOnly[1]);
    if (!birth || birth.year < 1900 || birth.year > 2099) return false;
    const base = baseUtc(birth);
    start = base - 14 * HOUR_MS;
    end = base + 36 * HOUR_MS;
    center = Math.round((start + end) / 2);
    step = HOUR_MS;
    evidence = 'Birth date only · all UTC offsets checked';
    signName = dateOnly[2];
  } else {
    return false;
  }
  const samples = sampleLongitudes('Mercury', start, end, step);
  const sign = stableSign(samples);
  if (sign < 0 || SIGNS[sign] !== signName) return false;
  return exactSignals(map, {
    'mercury placement': rangeLabel(samples[0], samples[samples.length - 1]),
    'mercury motion': motionLabel('Mercury', new Date(center)),
    'time evidence': evidence,
  });
}

function contactBand(distance) {
  return distance <= 5 ? 'Active contact' : distance <= 10 ? 'Nearby contact' : 'Low activation';
}

function angularContacts(date, latitude, locationLongitude, bodies, descendant) {
  const observer = new Observer(latitude, locationLongitude, 0);
  const localSidereal = normalizeAngle(SiderealTime(date) * 15 + locationLongitude);
  return bodies.map((planet) => {
    const equatorial = Equator(Body[planet], date, observer, true, true);
    const hourAngle = signedAngle(localSidereal - equatorial.ra * 15);
    const declination = equatorial.dec * Math.PI / 180;
    const phi = latitude * Math.PI / 180;
    const hourRadians = hourAngle * Math.PI / 180;
    const altitude = Math.asin(Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourRadians)) * 180 / Math.PI;
    const candidate = [
      { angle: 'MC', distance: Math.abs(hourAngle) },
      { angle: 'IC', distance: Math.abs(180 - Math.abs(hourAngle)) },
      { angle: hourAngle < 0 ? 'ASC' : descendant, distance: Math.abs(altitude) },
    ].sort((a, b) => a.distance - b.distance)[0];
    return { planet, ...candidate };
  }).sort((a, b) => a.distance - b.distance);
}

/* Theme v2 ships the six strongest contacts across ten bodies plus the city
 * coordinates and the UTC birth moment; the contacts are recomputed here. */
function validateAstrocartographyV2(map, context) {
  const coordinates = (map.get('city coordinates') || '').match(COORDINATE_SIGNAL);
  const moment = (map.get('birth moment utc') || '').match(UTC_MOMENT_SIGNAL);
  if (!coordinates || !moment) return false;
  const date = new Date(moment[0]);
  const year = Number(moment[1]);
  if (!Number.isFinite(date.getTime()) || year < 1900 || year > 2099) return false;
  const latitude = Number(coordinates[1]);
  const locationLongitude = Number(coordinates[2]);
  if (latitude < -90 || latitude > 90 || locationLongitude < -180 || locationLongitude > 180) return false;
  if (!map.get('target city')
    || !ASTROCARTOGRAPHY_V2.goals.includes(map.get('location goal') || '')
    || !ASTROCARTOGRAPHY_V2.modes.includes(map.get('how the city is being considered') || '')) return false;
  const contactKeys = [...map.keys()].filter((key) => /^[1-6]\. /.test(key));
  const allowed = new Set(['city coordinates', 'birth moment utc', 'target city', 'location goal', 'how the city is being considered', ...contactKeys]);
  if (contactKeys.length !== 6 || map.size !== allowed.size || ![...map.keys()].every((key) => allowed.has(key))) return false;
  const expected = angularContacts(date, latitude, locationLongitude, ASTROCARTOGRAPHY_V2.bodies, 'DSC');
  const strongest = new Map(expected.slice(0, 7).map((contact) => [contact.planet.toLowerCase(), contact]));
  let previous = -1;
  for (let rank = 1; rank <= 6; rank += 1) {
    const key = contactKeys.find((candidate) => candidate.startsWith(`${rank}. `));
    const label = key ? key.match(CONTACT_LABEL) : null;
    const detail = key ? (map.get(key) || '').match(CONTACT_VALUE) : null;
    if (!label || !detail) return false;
    const contact = strongest.get(label[1]);
    const distance = Number(detail[1]);
    if (!contact || contact.angle.toLowerCase() !== label[2] || Math.abs(contact.distance - distance) > 0.05
      || contactBand(distance) !== detail[2] || distance < previous) return false;
    previous = distance;
  }
  return text(context).includes(`Birth moment UTC: ${moment[0]}`);
}

function validateStorefrontContract(contract, map, context) {
  if (contract === 'mars-v1-exact') return validateMarsV1(map, context, 'exact');
  if (contract === 'mars-v1-date') return validateMarsV1(map, context, 'date');
  if (contract === 'mercury-v2-exact') return validateMercuryV2(map, context, 'exact');
  if (contract === 'mercury-v2-range') return validateMercuryV2(map, context, 'range');
  if (contract === 'astrocartography-v2') return validateAstrocartographyV2(map, context);
  return false;
}

export function newSharedToolPageForType(type) {
  return TYPE_PAGES[text(type)] || '';
}

export function isNewSharedToolPage(page) {
  return Object.hasOwn(PAGE_TYPES, text(page));
}

export function validateNewSharedToolSnapshot({ page, toolType, snapshot }) {
  const canonicalPage = text(page) || newSharedToolPageForType(toolType || snapshot?.type);
  const expectedType = PAGE_TYPES[canonicalPage];
  if (!expectedType) return { applies: false, ok: true, reason: '' };
  if (text(toolType || snapshot?.type) !== expectedType || text(snapshot?.type) !== expectedType) {
    return { applies: true, ok: false, reason: 'type_mismatch' };
  }
  const map = signals(snapshot?.signals);
  const scope = text(snapshot?.scope);
  const confidence = text(snapshot?.confidence);
  const dreamV2 = canonicalPage === '/pages/dream-interpreter' && scope !== DREAM_SCOPE;
  const storefront = storefrontContract(canonicalPage, scope, confidence);
  if (!storefront && (dreamV2 ? !dreamV2Scope(scope) : scope !== PAGE_SCOPES[canonicalPage])) {
    return { applies: true, ok: false, reason: 'typed_evidence_mismatch' };
  }
  const context = evidenceContext(snapshot?.context, scope, confidence);
  const expectedConfidence = dreamV2
    ? DREAM_V2_CONFIDENCE
    : canonicalPage === '/pages/chiron-sign-calculator'
      ? chironConfidence(context)
      : PAGE_CONFIDENCES[canonicalPage];
  if (!storefront && confidence !== expectedConfidence) {
    return { applies: true, ok: false, reason: 'typed_evidence_mismatch' };
  }
  let ok = false;
  if (storefront) ok = validateStorefrontContract(storefront, map, context);
  else if (canonicalPage === '/pages/name-numerology-calculator') ok = validateNameNumerology(map, context);
  else if (canonicalPage === '/pages/personal-year-calculator') ok = validatePersonalYear(map, context);
  else if (canonicalPage === '/pages/karmic-debt-calculator') ok = validateKarmic(map, context);
  else if (canonicalPage === '/pages/destiny-matrix-calculator') ok = validateDestiny(map, context);
  else if (canonicalPage === '/pages/aura-color-quiz') ok = validateAura(map, context);
  else if (canonicalPage === '/pages/chakra-test') ok = validateChakra(map, context);
  else if (canonicalPage === '/pages/midheaven-calculator') ok = validateMidheaven(map, context);
  else if (canonicalPage === '/pages/mars-sign-calculator') ok = validatePlanet(map, context, 'Mars');
  else if (canonicalPage === '/pages/mercury-sign-calculator') ok = validatePlanet(map, context, 'Mercury');
  else if (canonicalPage === '/pages/chiron-sign-calculator') ok = validateChiron(map, context);
  else if (canonicalPage === '/pages/transit-chart-calculator') ok = validateTransit(map, context);
  else if (canonicalPage === '/pages/solar-return-chart-calculator') ok = validateSolarReturn(map, context);
  else if (canonicalPage === '/pages/astrocartography-calculator') ok = validateAstrocartography(map, context);
  else if (canonicalPage === '/pages/nakshatra-calculator') ok = validateNakshatra(map, context);
  else if (canonicalPage === '/pages/sade-sati-calculator') ok = validateSadeSati(map, context);
  else if (canonicalPage === '/pages/dream-interpreter') {
    ok = dreamV2 ? validateDreamV2(map, context, snapshot) : validateDream(map, context, snapshot);
  }
  else if (canonicalPage === '/pages/i-ching-reading') ok = validateIChing(map, context)
    && scope === I_CHING_SCOPE;
  else if (canonicalPage === '/pages/pendulum-reading') ok = validatePendulum(map, context);
  else if (canonicalPage === '/pages/lenormand-reading') ok = validateLenormand(map, context);
  else if (canonicalPage === '/pages/attachment-style-quiz') ok = validateAttachment(map, context);
  else if (RULES[canonicalPage]) ok = regexSignals(map, RULES[canonicalPage], OPTIONAL_RULES[canonicalPage]);
  return { applies: true, ok, reason: ok ? '' : 'typed_evidence_mismatch' };
}

export { PAGE_TYPES as NEW_SHARED_TOOL_PAGE_TYPES };
