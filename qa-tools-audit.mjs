// QA: real free-preview outputs for the sitewide tool rail (non-reserved paths).
// Payload shapes copied from the LIVE theme sections' DeckauraDeepReading.enable calls.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generateFreeTeaserHtml } from './lib/legacy-worker.mjs';

function loadEnvLocal() {
  const out = {};
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return out;
}
const secrets = loadEnvLocal();
if (!secrets.DEEPSEEK_DIRECT_API_KEY) { console.error('MISSING KEY'); process.exit(1); }
const env = {
  DEEPSEEK_DIRECT_API_KEY: secrets.DEEPSEEK_DIRECT_API_KEY,
  FREE_RESERVED_LLM_SHARE: '100',
  AI_BUDGETS: { claim: async () => ({ allowed: true }), settle: async () => ({ allowed: true }) },
};

const CASES = [
  ['love-tarot', {
    type: 'Love Tarot',
    question: 'Does he see a future with me or am I just convenient for him?',
    context: 'Three-card love spread, intent: Where is this going. Card 1 (Your energy): Queen of Cups upright, deep feeling and openness. Card 2 (Their energy): Knight of Pentacles reversed, stalling and routine without commitment. Card 3 (The connection): Wheel of Fortune upright, a turning point approaching. Synthesis: devotion meets hesitation while circumstances prepare to shift.',
    signals: 'Your energy: Queen of Cups Upright; Their energy: Knight of Pentacles Reversed; The connection: Wheel of Fortune Upright',
    cards: 'Queen of Cups, Knight of Pentacles, Wheel of Fortune',
    spread: 'Intent-specific 3-card love spread',
    scope: 'Intent-specific three-card love spread for Where is this going',
    confidence: 'Symbolic pattern, not proof of another person’s private thoughts',
    tool: '/pages/love-tarot-reading · Intent-specific 3-card spread',
  }],
  ['daily-tarot', {
    type: 'Daily Tarot',
    question: 'I have a big presentation at work and I am scared of freezing up.',
    context: 'Date: August 19, 2026. Shared daily card: The Magician (Upright). Visitor-selected focus: Career. Resolved question lens: work confidence. Exact visitor situation: "I have a big presentation at work and I am scared of freezing up.". Keep every conclusion symbolic, conditional, and practical; do not claim private knowledge, certainty, guaranteed outcomes, or professional advice.',
    signals: 'Date: August 19, 2026; Shared card: The Magician; Orientation: Upright; Focus: Career',
    cards: 'The Magician',
    spread: 'Daily Card',
    scope: 'One shared daily card applied to the visitor situation',
    confidence: 'Symbolic tarot direction, not a factual prediction',
    tool: '/pages/daily-tarot-card',
  }],
  ['daily-horoscope', {
    type: 'Personal Horoscope',
    question: 'Will this week finally bring some relief in my love life?',
    context: 'Personal daily transit request for Scorpio. Focus: Love. Birth-time confidence: time unknown. Birthplace: not supplied because time is unknown. The free collective forecast showed intense energy.',
    signals: 'Sun sign: Scorpio; Selected focus: Love; Forecast date: 2026-08-19; Birth-time confidence: time unknown; Birthplace: Not supplied',
    scope: 'A personal natal-planet transit reading limited by unknown birth time',
    confidence: 'Symbolic astrology reflection, not a prediction',
    tool: '/pages/daily-horoscope',
  }],
  ['angel-number', {
    type: 'Angel Number',
    question: 'I keep seeing 1111 everywhere since my breakup. What does it mean for me?',
    context: 'Angel number 1111, "New beginnings and alignment". Seen repeatedly by the seeker.',
    signals: 'Number: 1111; Core theme: New beginnings and alignment; Reduced energy: 4',
    scope: 'A symbolic reflection on the entered number, applied only to the user’s real observation and chosen life area.',
    confidence: 'Symbolic interpretation; not a prediction or proof of an external message.',
    tool: 'Angel Number Meaning',
  }],
  ['life-path', {
    type: 'Numerology Life Path',
    question: 'I feel stuck in my career. Does my life path say anything about my real direction?',
    context: 'Life Path Number 7 (The Seeker). Born 7/14/1992.',
    signals: 'Life Path: 7; Archetype: The Seeker; Month vibration: 7; Day vibration: 5; Year vibration: 3',
    scope: 'A date-based Life Path reflection applied to the user’s current situation.',
    confidence: 'Deterministic date-based numerology calculation.',
    tool: 'Life Path Number Calculator',
  }],
  ['zodiac-compat', {
    type: 'Zodiac Compatibility',
    question: 'We fight constantly but I cannot let go. Are Leo and Scorpio doomed?',
    context: 'Verified Sun-sign compatibility for Leo and Scorpio. Overall 58%. Love 72%, communication 41%, trust 55%, emotional bond 66%. Relationship stage: Dating. Customer focus: Conflict. Exact question: We fight constantly but I cannot let go. Are Leo and Scorpio doomed?.',
    signals: 'Pair: Leo and Scorpio; Overall sign match: 58%; Love and attraction: 72%; Communication: 41%; Trust: 55%',
    scope: 'Sun-sign compatibility reflection for a dating couple focused on conflict',
    confidence: 'Symbolic astrology reflection, not proof about two real people',
    tool: 'Zodiac Sign Compatibility',
  }],
  ['big-3', {
    type: 'Sun Moon Rising (Big 3)',
    question: 'Why do people always think I am cold when inside I feel everything so deeply?',
    context: 'Quick Big Three-style snapshot: Sun in Capricorn, estimated Moon in Pisces, approximate Virgo Rising. Dominant element Earth. Do not claim an exact Ascendant or complete natal chart because birthplace was not collected.',
    signals: 'Sun: Capricorn; Estimated Moon: Pisces; Approximate Rising: Virgo; Dominant element: Earth',
    scope: 'A quick Big Three-style snapshot without verified Ascendant, houses or aspects.',
    confidence: 'Sun-sign level astrology snapshot, not a full chart',
    tool: 'Sun, Moon and Rising Snapshot',
  }],
  ['random-card', {
    type: 'Random Tarot Card',
    question: 'Should I confront my roommate about the money she owes me?',
    context: 'Random one-card tarot pull. Reading focus: Decisions. Exact question: "Should I confront my roommate about the money she owes me?". Card: Justice (Upright). Element: Air. Core meaning shown: fairness, accountability, honest reckoning. Interpret only this supplied card and orientation. Apply it to the exact question, compare the strongest interpretation with one plausible alternative, identify the condition that could change the direction, and give one grounded next step. Do not add cards, claim private thoughts, or guarantee an outcome.',
    signals: 'Card: Justice Upright; Focus: Decisions',
    cards: 'Justice',
    spread: 'One card',
    scope: 'One random card applied to one focused question',
    confidence: 'Symbolic tarot direction, not a factual prediction',
    tool: 'Random One-Card Tarot Generator',
  }],
  ['rune-3', {
    type: 'Rune Reading',
    question: 'Is it time to leave my safe job for the startup offer?',
    context: 'Three-rune spread. Selected focus: Career and work. Supplied question: "Is it time to leave my safe job for the startup offer?" Exact randomized cast: Past: Fehu (upright), keywords: wealth, new resources; Present: Nauthiz (reversed), keywords: constraint, friction, needful lessons; Future: Dagaz (upright), keywords: breakthrough, daylight, transformation. Interpret only these runes.',
    signals: 'Past: Fehu Upright; Present: Nauthiz Reversed; Future: Dagaz Upright',
    cards: 'Fehu, Nauthiz, Dagaz',
    spread: 'Three-rune spread',
    scope: '3-rune cast for one focused question',
    confidence: 'Symbolic rune direction, not a factual prediction',
    tool: '/pages/rune-reading',
  }],
  ['moon-phase', {
    type: 'Moon Reading',
    question: 'I feel restless and cannot sleep lately. Does the moon have anything to do with it?',
    context: 'Moon phase today: Waning Gibbous in Pisces, illumination 82%. Visitor focus: Emotions and rest. Symbolic lunar reflection only.',
    signals: 'Phase: Waning Gibbous; Moon sign: Pisces; Illumination: 82%; Focus: Emotions and rest',
    scope: 'A symbolic reflection on the current lunar phase applied to the visitor situation',
    confidence: 'Symbolic lunar reflection, not a scientific or medical claim',
    tool: '/pages/moon-phase-today',
  }],
];

const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#0*39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();

const results = [];
let i = 0;
async function run([label, base]) {
  const fields = { ...base, lang: 'en', locale: 'en-US', requestedLocale: 'en-US', readingId: `qa_tools_${Date.now()}_${++i}`, visitorId: `qa_tools_v_${i}` };
  const t0 = performance.now();
  try {
    const html = await generateFreeTeaserHtml(fields, env);
    results.push({ label, q: base.question, src: `${fields.freePreviewServedModel}/${fields.freePreviewServedSource}`, ms: Math.round(performance.now() - t0), text: strip(html) });
    console.log('ok ', label, fields.freePreviewServedSource, Math.round(performance.now() - t0) + 'ms');
  } catch (e) {
    results.push({ label, q: base.question, error: String(e && e.message || e) });
    console.log('ERR', label, String(e && e.message || e));
  }
}
const queue = [...CASES];
await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) await run(queue.shift()); }));
const lines = ['# Tools Audit Batch', ''];
for (const r of results) {
  lines.push(`## ${r.label}`, `Soru: ${r.q}`);
  if (r.error) { lines.push(`HATA: ${r.error}`, ''); continue; }
  lines.push(`Kaynak: ${r.src} / ${r.ms}ms`, '', r.text, '');
}
writeFileSync('qa-tools-audit-results.md', lines.join('\n'), 'utf8');
console.log(`Bitti: ${results.filter(r => !r.error).length}/${results.length}`);
