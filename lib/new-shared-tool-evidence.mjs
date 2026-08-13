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
});

const TYPE_PAGES = Object.freeze(Object.fromEntries(Object.entries(PAGE_TYPES).map(([page, type]) => [type, page])));
const MASTER = new Set([11, 22, 33]);
const DEBTS = new Set([13, 14, 16, 19]);
const COLORS = ['violet', 'indigo', 'blue', 'green', 'yellow', 'orange', 'red'];
const CHAKRAS = ['root', 'sacral', 'solar', 'heart', 'throat', 'third-eye', 'crown'];
const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const RASHIS = ['Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya', 'Tula', 'Vrishchika', 'Dhanu', 'Makara', 'Kumbha', 'Meena'];
const NAKSHATRAS = ['Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha', 'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati'];
const DREAM_THEMES = ['Water', 'Falling', 'Flying', 'Teeth', 'Being chased', 'Death or ending', 'Snake', 'House or room', 'Door or key', 'Baby or child', 'Fire', 'Test or school', 'Vehicle or journey', 'Bridge', 'Phone or message', 'Wedding or union', 'Unresolved scene'];
const DREAM_CONTEXT = 'Privacy-minimized result; Deckaura derived allowlisted themes, tone and a length band on its server, then sent only those signals to the interpretation model. Raw dream text was not sent to that model, retained, or attached to checkout.';
const DREAM_SCOPE = 'Reflect only on allowlisted dream themes and the selected tone; no diagnosis, recovered-memory claim, factual third-party claim or prediction.';
const DREAM_CONFIDENCE = 'Symbolic reflection generated from allowlisted themes; personal meaning may differ.';
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
  const observer = new Observer(latitude, locationLongitude, 0);
  const localSidereal = normalizeAngle(SiderealTime(moment.date) * 15 + locationLongitude);
  const contacts = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'].map((planet) => {
    const equatorial = Equator(Body[planet], moment.date, observer, true, true);
    const hourAngle = signedAngle(localSidereal - equatorial.ra * 15);
    const declination = equatorial.dec * Math.PI / 180;
    const phi = latitude * Math.PI / 180;
    const hourRadians = hourAngle * Math.PI / 180;
    const altitude = Math.asin(Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourRadians)) * 180 / Math.PI;
    const candidate = [
      { angle: 'MC', distance: Math.abs(hourAngle) },
      { angle: 'IC', distance: Math.abs(180 - Math.abs(hourAngle)) },
      { angle: hourAngle < 0 ? 'ASC' : 'DC', distance: Math.abs(altitude) },
    ].sort((a, b) => a.distance - b.distance)[0];
    return { planet, ...candidate };
  }).sort((a, b) => a.distance - b.distance);
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
  '/pages/dream-interpreter': { 'dream themes': /^[A-Za-z][A-Za-z ,'-]{0,180}$/, 'emotional tone': /^(?:curious|anxious|sad|calm|confused)$/, 'dream length band': /^(?:under 50 words|50–149 words|150\+ words)$/, 'privacy mode': /^Server-minimized · raw dream not sent to the interpretation model or checkout$/ },
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

function validateDream(map, context, snapshot) {
  const keys = ['dream themes', 'emotional tone', 'dream length band', 'privacy mode'];
  if (!exactKeys(map, keys)
    || evidenceContext(context, text(snapshot?.scope), text(snapshot?.confidence)) !== DREAM_CONTEXT
    || text(snapshot?.scope) !== DREAM_SCOPE
    || text(snapshot?.confidence) !== DREAM_CONFIDENCE
    || !/^(?:curious|anxious|sad|calm|confused)$/.test(map.get('emotional tone'))
    || !/^(?:under 50 words|50–149 words|150\+ words)$/.test(map.get('dream length band'))
    || map.get('privacy mode') !== 'Server-minimized · raw dream not sent to the interpretation model or checkout') return false;
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
  if (scope !== PAGE_SCOPES[canonicalPage]) {
    return { applies: true, ok: false, reason: 'typed_evidence_mismatch' };
  }
  const context = evidenceContext(snapshot?.context, scope, confidence);
  const expectedConfidence = canonicalPage === '/pages/chiron-sign-calculator'
    ? chironConfidence(context)
    : PAGE_CONFIDENCES[canonicalPage];
  if (confidence !== expectedConfidence) {
    return { applies: true, ok: false, reason: 'typed_evidence_mismatch' };
  }
  let ok = false;
  if (canonicalPage === '/pages/name-numerology-calculator') ok = validateNameNumerology(map, context);
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
  else if (canonicalPage === '/pages/dream-interpreter') ok = validateDream(map, context, snapshot);
  else if (canonicalPage === '/pages/i-ching-reading') ok = validateIChing(map, context)
    && scope === I_CHING_SCOPE;
  else if (canonicalPage === '/pages/pendulum-reading') ok = validatePendulum(map, context);
  else if (canonicalPage === '/pages/lenormand-reading') ok = validateLenormand(map, context);
  else if (RULES[canonicalPage]) ok = regexSignals(map, RULES[canonicalPage], OPTIONAL_RULES[canonicalPage]);
  return { applies: true, ok, reason: ok ? '' : 'typed_evidence_mismatch' };
}

export { PAGE_TYPES as NEW_SHARED_TOOL_PAGE_TYPES };
