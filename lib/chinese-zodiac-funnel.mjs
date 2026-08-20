// Dedicated Chinese Zodiac funnel for the Zodiac V2 page (/api/chinese-zodiac/*).
//
// Architecture contract: this module stays small (well under 2000 lines) and
// imports the shared kernel (DeepSeek client, entitlement budgets, CORS/JSON
// helpers, logging) from legacy-worker exports instead of duplicating it.
// Everything zodiac-page-specific (year-pillar math, prompt, audits,
// deterministic fallback copy) lives here so the page can evolve without
// touching the monolith. The zodiac math mirrors the page design exactly and
// is recomputed server-side; the client result is never trusted.
import {
  allowedStorefrontOrigin,
  claimFreePreview,
  completeDeepSeek,
  cors,
  json,
  modelCredential,
  readJsonBody,
  settleFreePreview,
  structuredLog,
} from './legacy-worker.mjs';

export const CZ_FUNNEL_VERSION = 'chinese-zodiac-v2-2026-08';
export const CZ_PROMPT_VERSION = 'cz-free-insight-v1';
const CZ_MODEL = 'deepseek-v4-flash';

// ---------------------------------------------------------------------------
// Year-pillar data (from the approved Zodiac V2 page design). The page renders
// the same tables client-side; the server copy is the fallback + validation
// truth. CNY holds the Chinese New Year start (MMDD) for 1920..2031.
// ---------------------------------------------------------------------------
const CNY = ('0220,0208,0128,0216,0205,0124,0213,0202,0123,0210,' +
  '0130,0217,0206,0126,0214,0204,0124,0211,0131,0219,' +
  '0208,0127,0215,0205,0125,0213,0202,0122,0210,0129,' +
  '0217,0206,0127,0214,0203,0124,0212,0131,0218,0208,' +
  '0128,0215,0205,0125,0213,0202,0121,0209,0130,0217,' +
  '0206,0127,0215,0203,0123,0211,0131,0218,0207,0128,' +
  '0216,0205,0125,0213,0202,0220,0209,0129,0217,0206,' +
  '0127,0215,0204,0123,0210,0131,0219,0207,0128,0216,' +
  '0205,0124,0212,0201,0122,0209,0129,0218,0207,0126,' +
  '0214,0203,0123,0210,0131,0219,0208,0128,0216,0205,' +
  '0125,0212,0201,0122,0210,0129,0217,0206,0126,0213,' +
  '0203,0123').split(',');

export const ZODIAC_ANIMALS = [
  { n: 'Rat', gift: 'timing and quick reassessment', fr: 'keeps a private calculation running' },
  { n: 'Ox', gift: 'steadiness and follow-through', fr: 'refuses to reopen a settled decision' },
  { n: 'Tiger', gift: 'momentum and courage', fr: 'moves before the other person is ready' },
  { n: 'Rabbit', gift: 'tact and emotional reading', fr: 'manages distance instead of naming the problem' },
  { n: 'Dragon', gift: 'ambition and a raised standard', fr: 'takes over the moment the pace drops' },
  { n: 'Snake', gift: 'depth and pattern recognition', fr: 'withholds the conclusion until it is final' },
  { n: 'Horse', gift: 'energy and open direction', fr: 'needs space the moment it feels held' },
  { n: 'Goat', gift: 'care and atmosphere', fr: 'stays past its own boundary, then withdraws' },
  { n: 'Monkey', gift: 'invention and second routes', fr: 'changes the plan without announcing it' },
  { n: 'Rooster', gift: 'precision and honesty', fr: 'corrects when reassurance was needed' },
  { n: 'Dog', gift: 'loyalty and fairness', fr: 'tests trust long after it was earned' },
  { n: 'Pig', gift: 'generosity and plain dealing', fr: 'gives first and counts the cost later' },
];
const ELEMENTS = ['Metal', 'Water', 'Wood', 'Fire', 'Earth'];
export const CZ_INTENTS = new Set(['self', 'love', 'career', 'year']);

export function zodiacSign(y, m, d) {
  const start = CNY[y - 1920] || '0205';
  const cm = Number(start.slice(0, 2));
  const cd = Number(start.slice(2));
  const before = (m < cm) || (m === cm && d < cd);
  const zy = before ? y - 1 : y;
  const animal = ZODIAC_ANIMALS[(((zy - 1900) % 12) + 12) % 12];
  const element = ELEMENTS[Math.floor(((((zy - 1900) % 10) + 10) % 10) / 2)];
  const polarity = zy % 2 === 0 ? 'Yang' : 'Yin';
  return { animal, element, polarity, zy, before, full: `${polarity} ${element} ${animal.n}` };
}

export function pairRhythm(nameA, nameB) {
  const i = ZODIAC_ANIMALS.findIndex((a) => a.n === nameA);
  const j = ZODIAC_ANIMALS.findIndex((a) => a.n === nameB);
  if (i < 0 || j < 0) return 'Mixed';
  const dd = (((i - j) % 12) + 12) % 12;
  if ((i + j) % 12 === 1) return 'Strong';
  if (dd === 4 || dd === 8) return 'Strong';
  if (dd === 6) return 'Challenging';
  if (dd === 3 || dd === 9) return 'Challenging';
  return 'Mixed';
}

export function currentZodiac(nowValue) {
  const now = nowValue instanceof Date ? nowValue : new Date();
  const y = Math.min(2031, Math.max(1920, now.getFullYear()));
  return zodiacSign(y, now.getMonth() + 1, now.getDate());
}

const WESTERN = [['Capricorn', 119], ['Aquarius', 218], ['Pisces', 320], ['Aries', 419], ['Taurus', 520], ['Gemini', 620], ['Cancer', 722], ['Leo', 822], ['Virgo', 922], ['Libra', 1022], ['Scorpio', 1121], ['Sagittarius', 1221], ['Capricorn', 1231]];
export function westernSunSign(m, d) {
  const key = m * 100 + d;
  for (const [name, limit] of WESTERN) {
    if (key <= limit) return name;
  }
  return 'Capricorn';
}

// ---------------------------------------------------------------------------
// Input parsing and validation
// ---------------------------------------------------------------------------
function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseDob(raw) {
  const y = Number(raw && raw.y);
  const m = Number(raw && raw.m);
  const d = Number(raw && raw.d);
  if (!Number.isInteger(y) || y < 1920 || y > 2026) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (!Number.isInteger(d) || d < 1 || d > 31) return null;
  const daysInMonth = new Date(y, m, 0).getDate();
  if (d > daysInMonth) return null;
  return { y, m, d };
}

export function parseInsightPayload(body) {
  const dob = parseDob(body && body.dob);
  if (!dob) return { ok: false, reason: 'dob must be a real calendar date between 1920 and 2026' };
  const intent = CZ_INTENTS.has(body && body.intent) ? body.intent : null;
  if (!intent) return { ok: false, reason: 'intent must be one of self, love, career, year' };
  const chip = clean(body && body.chip, 64);
  let partner = null;
  if (body && body.partner != null) {
    partner = parseDob(body.partner);
    if (!partner) return { ok: false, reason: 'partner must be a real calendar date between 1920 and 2026 when supplied' };
  }
  const visitorId = clean(body && body.visitorId, 80);
  const readingId = clean(body && body.readingId, 80) || `zc-${Date.now().toString(36)}`;
  const sign = zodiacSign(dob.y, dob.m, dob.d);
  const partnerSign = partner ? zodiacSign(partner.y, partner.m, partner.d) : null;
  return {
    ok: true,
    dob,
    intent,
    chip,
    partner,
    sign,
    partnerSign,
    western: westernSunSign(dob.m, dob.d),
    current: currentZodiac(),
    visitorId,
    readingId,
  };
}

// ---------------------------------------------------------------------------
// Deterministic fallback (design tables) — never an error box. The page ships
// the identical templates client-side, so a degraded response is invisible.
// ---------------------------------------------------------------------------
export function deterministicInsight(payload) {
  const { sign, intent, current } = payload;
  const el = sign.element;
  const an = sign.animal;
  if (intent === 'self') return {
    insight: `Your ${el} ${an.n} pattern ${an.fr}. It is rarely the first decision that costs you, it is the one made after holding the situation too long.`,
    next: 'Your full reading traces where that pattern comes from and what actually interrupts it.',
  };
  if (intent === 'love') return {
    insight: `Your ${el} ${an.n} pattern ${an.fr}. To the other person this can look sudden, even when it has been building quietly for some time.`,
    next: 'Your full compatibility reading identifies where this pattern meets the other person’s zodiac combination.',
  };
  if (intent === 'career') return {
    insight: `Your ${el} ${an.n} pattern ${an.fr}. At work this usually shows up as a decision you have already made privately but have not said out loud.`,
    next: 'Your full reading shows how that plays against authority, risk and money.',
  };
  return {
    insight: `Your ${el} ${an.n} combination meets a ${current.element} ${current.animal.n} year: fast, visible and rewarding to early movement, punishing to drift.`,
    next: 'Your full map shows which months open for you and which ones ask you to wait.',
  };
}

// ---------------------------------------------------------------------------
// LLM path
// ---------------------------------------------------------------------------
function zodiacFacts(payload) {
  // The Western sun sign is deliberately withheld here: the Chinese-Western
  // synthesis is a paid-tier deliverable and must not leak into the free
  // insight. The sign still travels with the checkout signals for the report.
  const { sign, partnerSign, intent, chip, current } = payload;
  const lines = [
    `Customer combination: ${sign.full} (zodiac year ${sign.zy}); animal gift: ${sign.animal.gift}; friction habit: ${sign.animal.fr}`,
    `Focus: ${intent}${chip ? `; customer's own words: "${chip}"` : ''}`,
    `Current zodiac year: ${current.full} ${current.zy}`,
  ];
  if (partnerSign) {
    lines.push(`Partner combination: ${partnerSign.full} (zodiac year ${partnerSign.zy}); partner gift: ${partnerSign.animal.gift}; partner friction habit: ${partnerSign.animal.fr}`);
    lines.push(`Pair rhythm: ${pairRhythm(sign.animal.n, partnerSign.animal.n)}`);
  }
  return lines.join('\n');
}

function systemPrompt() {
  return 'You are the reader behind Deckaura\'s Chinese zodiac page: grounded, plain-spoken and pattern-focused, never mystical theatre. ' +
    'You write a FREE personalized insight from a year-pillar result (animal, element, yin or yang polarity). Use only the supplied zodiac facts; never invent placements, events, dates or certainty. ' +
    'Never promise a fixed future, never claim access to another person\'s private thoughts or feelings, and never diagnose. ' +
    'The free insight names one behavioural pattern only. The synthesis with the Western sign, timing windows, compatibility mechanics and any plan stay reserved for the written reading, so do not state or imply them. ' +
    'Return ONLY strict JSON with keys insight and next. No markdown, no code fences, no extra keys, no em or en dashes anywhere.';
}

function userPrompt(payload) {
  return `${zodiacFacts(payload)}\n\n` +
    'Write two fields:\n' +
    '1. insight: 26 to 55 words, 2 complete sentences in second person, present tense. Name the customer\'s animal exactly as supplied and weave in the element or polarity word. Describe one concrete behavioural pattern this combination produces in the chosen focus area' +
    (payload.chip ? ', angled toward what the customer said' : '') +
    (payload.partnerSign ? ', and let the second sentence acknowledge how the partner\'s animal meets that pattern without judging the pair' : '') +
    '. End in observation, not advice.\n' +
    '2. next: 10 to 24 words, one sentence starting with "Your full", naming what the written reading will resolve for this exact focus. No prices, no product names.\n' +
    'Every field is plain text. JSON only.';
}

const FORBIDDEN_FREE = /\b(?:will definitely|guarantee[ds]?|i promise|soul ?mate|meant to be|destined|(?:he|she|they) (?:feels?|thinks?|wants?|misses|loves?) )/i;
const DASHES = /[–—]/;

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function auditInsight(result, payload) {
  if (!result || typeof result !== 'object') return 'no result object';
  const { insight, next } = result;
  for (const [key, value] of Object.entries({ insight, next })) {
    if (typeof value !== 'string' || !value.trim()) return `${key} missing`;
    if (DASHES.test(value)) return `${key} used an em or en dash`;
    if (FORBIDDEN_FREE.test(value)) return `${key} leaked a guarantee or private-state claim`;
  }
  const iw = wordCount(insight);
  if (iw < 18 || iw > 62) return `insight word count ${iw} outside 18-62`;
  if (!insight.includes(payload.sign.animal.n)) return 'insight omitted the customer animal name';
  const anchor = new RegExp(`\\b(?:${payload.sign.element}|${payload.sign.polarity})\\b`, 'i');
  if (!anchor.test(insight)) return 'insight omitted both the element and the polarity';
  if (payload.partnerSign && !insight.includes(payload.partnerSign.animal.n)) return 'insight omitted the partner animal name';
  const nw = wordCount(next);
  if (nw < 8 || nw > 28) return `next word count ${nw} outside 8-28`;
  if (!/^your full/i.test(next.trim())) return 'next must start with "Your full"';
  if (/\$|price|checkout|tier|purchase/i.test(next)) return 'next mentioned commerce';
  return '';
}

function extractJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

async function generateInsight(payload, env) {
  const usage = {
    requestId: (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) || `cz_${Date.now()}`,
    feature: 'cz-free-insight',
    route: '/chinese-zodiac/free-insight',
    readingId: payload.readingId,
    promptVersion: CZ_PROMPT_VERSION,
  };
  const request = {
    model: CZ_MODEL,
    thinking: { type: 'disabled' },
    temperature: 0.65,
    max_tokens: 300,
    messages: [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: userPrompt(payload) },
    ],
  };
  let lastReason = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const body = attempt === 0
      ? request
      : {
          ...request,
          messages: [
            request.messages[0],
            { role: 'user', content: `PREVIOUS DRAFT WAS REJECTED: ${lastReason}. Fix exactly that while keeping every other rule.\n\n${userPrompt(payload)}` },
          ],
        };
    const completion = await completeDeepSeek(body, env, attempt === 0 ? 'cz-free-insight' : 'cz-free-insight-retry', usage);
    const parsed = extractJson(completion.text);
    const candidate = parsed && {
      insight: clean(parsed.insight, 520),
      next: clean(parsed.next, 240),
    };
    const reason = auditInsight(candidate, payload);
    if (!reason) {
      return { ...candidate, servedModel: CZ_MODEL, servedSource: attempt === 0 ? 'model_initial' : 'model_retry' };
    }
    lastReason = reason;
    structuredLog('info', { event: 'cz_free_insight_rejected', attempt, reason, readingId: payload.readingId });
  }
  const error = new Error(lastReason || 'model unavailable');
  error.code = 'CZ_MODEL_REJECTED';
  throw error;
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------
async function handleFreeInsight(request, env) {
  let body;
  try {
    body = await readJsonBody(request, 16 * 1024);
  } catch (_) {
    return cors(json({ error: 'invalid_json' }, 400), request);
  }
  const payload = parseInsightPayload(body);
  if (!payload.ok) return cors(json({ error: 'invalid_insight_request', reason: payload.reason }, 422), request);

  let claim = null;
  try {
    claim = await claimFreePreview(request, body, env);
  } catch (error) {
    const status = Number(error && error.status) || 503;
    return cors(json({ error: 'entitlement_unavailable' }, status), request);
  }
  if (!claim || claim.allowed !== true) {
    return cors(json({
      error: 'free_limit_reached',
      reason: (claim && claim.reason) || 'preview_unavailable',
      nextAt: claim && claim.nextAt,
    }, 429), request);
  }

  let result;
  let degraded = false;
  const modelAvailable = Boolean(modelCredential(env, 'DEEPSEEK_DIRECT_API_KEY') || modelCredential(env, 'AI_GATEWAY_API_KEY') || modelCredential(env, 'VERCEL_OIDC_TOKEN') || modelCredential(env, 'VERCEL'));
  if (modelAvailable) {
    try {
      result = await generateInsight(payload, env);
    } catch (error) {
      degraded = true;
      structuredLog('warn', {
        event: 'cz_free_insight_fallback',
        readingId: payload.readingId,
        reason: clean(error && (error.code || error.message), 120) || 'model_error',
      });
    }
  } else {
    degraded = true;
  }
  if (!result) {
    result = { ...deterministicInsight(payload), servedModel: 'deterministic', servedSource: 'deterministic_design_tables' };
  }

  try {
    await settleFreePreview(env, claim, 'commit-preview');
  } catch (_) {
    // A settle failure must never block the served insight.
  }

  structuredLog('info', {
    event: 'cz_free_insight_served',
    readingId: payload.readingId,
    intent: payload.intent,
    sign: payload.sign.full,
    partner: Boolean(payload.partnerSign),
    servedSource: result.servedSource,
    degraded,
  });

  return cors(json({
    readingId: payload.readingId,
    funnelVersion: CZ_FUNNEL_VERSION,
    promptVersion: CZ_PROMPT_VERSION,
    intent: payload.intent,
    sign: payload.sign.full,
    zodiacYear: payload.sign.zy,
    insight: result.insight,
    next: result.next,
    servedModel: result.servedModel,
    servedSource: result.servedSource,
    freeReadings: {
      used: Math.max(0, Number(claim.used) || 0),
      cap: Math.max(0, Number(claim.cap) || 0),
      remaining: Math.max(0, Number(claim.remaining) || 0),
      nextAt: claim.nextAt,
    },
  }), request);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request);
    if (!allowedStorefrontOrigin(request)) {
      return cors(json({ error: 'origin_not_allowed' }, 403), request);
    }
    if (path === '/free-insight' && request.method === 'POST') return handleFreeInsight(request, env);
    if (path === '/health' && request.method === 'GET') {
      return cors(json({ ok: true, funnel: CZ_FUNNEL_VERSION }), request);
    }
    return cors(json({ error: 'not_found' }, 404), request);
  },
};
