// Dedicated Tarot Timing funnel for the Timing V2 page (/api/tarot-timing/*).
//
// Architecture contract: this module stays small (well under 2000 lines) and
// imports the shared kernel (DeepSeek client, entitlement budgets, CORS/JSON
// helpers, logging) from legacy-worker exports instead of duplicating it.
// The page draws three cards deterministically client-side; the server only
// validates card identities against the canonical 78-card deck and the fixed
// timing positions, then writes an audited conditional-window insight. The
// paid deliverables (scenario paths, milestones, checkpoints, horizon plan)
// must never leak into this free layer.
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

export const TT_FUNNEL_VERSION = 'tarot-timing-v2-2026-08';
export const TT_PROMPT_VERSION = 'tt-insight-v1';
const TT_MODEL = 'deepseek-v4-flash';

const MAJORS = [
  'The Fool', 'The Magician', 'The High Priestess', 'The Empress', 'The Emperor',
  'The Hierophant', 'The Lovers', 'The Chariot', 'Strength', 'The Hermit',
  'Wheel of Fortune', 'Justice', 'The Hanged Man', 'Death', 'Temperance',
  'The Devil', 'The Tower', 'The Star', 'The Moon', 'The Sun', 'Judgement', 'The World',
];
const RANKS = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Page', 'Knight', 'Queen', 'King'];
const SUITS = ['Wands', 'Cups', 'Swords', 'Pentacles'];
export const TT_DECK = Object.freeze([
  ...MAJORS,
  ...SUITS.flatMap((suit) => RANKS.map((rank) => `${rank} of ${suit}`)),
]);
const DECK_SET = new Set(TT_DECK);

export const TT_ROLES = Object.freeze(['Current Momentum', 'Timing Signal', 'Pace Changer']);

export const TT_FOCI = Object.freeze({
  contact: 'Contact',
  reconciliation: 'Reconciliation',
  newlove: 'New Love',
  career: 'Career',
  decision: 'Decision',
  other: 'Other',
});

export const TT_HORIZONS = Object.freeze({
  '14d': Object.freeze({ long: '7 to 14 days', end: 'Day 14' }),
  '30d': Object.freeze({ long: '30 days', end: 'Day 30' }),
  '3m': Object.freeze({ long: '3 months', end: 'Month 3' }),
  '6m': Object.freeze({ long: '6 months', end: 'Month 6' }),
  '12m': Object.freeze({ long: '12 months', end: 'Month 12' }),
});

// Suit pace phrasing for the deterministic fallback (design method: suits set
// the tempo, Majors mark structural turns).
const SUIT_PACE = Object.freeze({
  Wands: 'in quick bursts, with movement measured in days and weeks rather than seasons',
  Swords: 'through decisions, so the pace jumps once a choice actually lands',
  Cups: 'at a feeling-led pace that builds across weeks rather than overnight',
  Pentacles: 'slowly and structurally, the way practical processes move across months',
  Major: 'through a structural turning point rather than a steady schedule',
});

function suitOf(name) {
  for (const suit of SUITS) {
    if (name.endsWith(` of ${suit}`)) return suit;
  }
  return 'Major';
}

function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function parseInsightPayload(body) {
  const focus = clean(body && body.focus, 24).toLowerCase();
  if (!Object.hasOwn(TT_FOCI, focus)) return { ok: false, reason: 'focus must be one of contact, reconciliation, newlove, career, decision, other' };
  const horizon = clean(body && body.horizon, 8).toLowerCase();
  if (!Object.hasOwn(TT_HORIZONS, horizon)) return { ok: false, reason: 'horizon must be one of 14d, 30d, 3m, 6m, 12m' };
  const question = clean(body && body.question, 360);
  if (question.length < 8) return { ok: false, reason: 'question must be at least 8 characters' };
  const context = clean(body && body.context, 400);
  const eventDef = clean(body && body.eventDef, 200);
  const rawCards = Array.isArray(body && body.cards) ? body.cards : [];
  if (rawCards.length !== TT_ROLES.length) return { ok: false, reason: 'cards must contain exactly three entries' };
  const cards = [];
  for (let index = 0; index < TT_ROLES.length; index += 1) {
    const entry = rawCards[index] || {};
    const name = clean(entry.name, 40);
    const orientation = clean(entry.orientation, 12);
    const role = clean(entry.role, 24);
    if (!DECK_SET.has(name)) return { ok: false, reason: `cards[${index}].name is not a canonical tarot card` };
    if (orientation !== 'Upright' && orientation !== 'Reversed') return { ok: false, reason: `cards[${index}].orientation must be Upright or Reversed` };
    if (role !== TT_ROLES[index]) return { ok: false, reason: `cards[${index}].role must be ${TT_ROLES[index]}` };
    cards.push({ name, orientation, role });
  }
  if (new Set(cards.map((card) => card.name)).size !== cards.length) {
    return { ok: false, reason: 'cards must be three different cards' };
  }
  const visitorId = clean(body && body.visitorId, 80);
  const readingId = clean(body && body.readingId, 80) || `tt2-${Date.now().toString(36)}`;
  return {
    ok: true,
    focus,
    focusLabel: TT_FOCI[focus],
    horizon,
    hz: TT_HORIZONS[horizon],
    question,
    context,
    eventDef,
    cards,
    visitorId,
    readingId,
  };
}

// ---------------------------------------------------------------------------
// Deterministic fallback — composed from the suit tempo method the page also
// documents, so a degraded response reads native. Never an error box.
// ---------------------------------------------------------------------------
export function deterministicInsight(payload) {
  const [momentum, , pace] = payload.cards;
  const tempo = SUIT_PACE[suitOf(momentum.name)];
  const held = momentum.orientation === 'Reversed'
    ? 'with some of that movement currently held back'
    : 'and that movement is already live';
  return {
    lensNote: `Across the ${payload.hz.long} horizon you chose, ${momentum.name} suggests this situation moves ${tempo}, ${held}. ${pace.name} marks what can genuinely shift the pace, so read the window as conditional: it opens when that changes, not on a calendar date.`,
    watchFor: `Watch for one small, visible step connected to ${pace.name.toLowerCase().startsWith('the ') ? 'that turning point' : 'that pace changer'} early in your window, before you re-ask the question.`,
  };
}

// ---------------------------------------------------------------------------
// LLM path
// ---------------------------------------------------------------------------
function insightFacts(payload) {
  const lines = payload.cards.map((card) => `${card.role}: ${card.name} (${card.orientation})`);
  lines.push(`Timing focus: ${payload.focusLabel}`);
  lines.push(`Chosen horizon: ${payload.hz.long} (ends around ${payload.hz.end})`);
  lines.push(`Customer question: "${payload.question}"`);
  if (payload.eventDef) lines.push(`What would count as the event happening: "${payload.eventDef}"`);
  if (payload.context) lines.push(`Optional context: "${payload.context}"`);
  return lines.join('\n');
}

function systemPrompt() {
  return 'You are the reader behind Deckaura\'s tarot timing page: grounded, plain-spoken and decision-focused, never mystical theatre. ' +
    'You write a FREE timing insight from three cards in fixed positions (Current Momentum, Timing Signal, Pace Changer). Use only the supplied cards, orientations, focus, horizon and customer words; never invent cards or events. ' +
    'Timing is always a conditional window inside the chosen horizon: never a calendar date, never a countdown like "within 10 days", never a guarantee, and never another person\'s private thoughts or feelings. ' +
    'The scenario timelines, milestones, checkpoints and the horizon-matched action plan are paid deliverables, so do not state or imply them. ' +
    'Return ONLY strict JSON with keys lensNote and watchFor. No markdown, no code fences, no extra keys, no em or en dashes anywhere.';
}

function userPrompt(payload) {
  return `${insightFacts(payload)}\n\n` +
    'Write two fields:\n' +
    '1. lensNote: 38 to 75 words, 2 or 3 complete sentences in second person, present tense. Name at least two of the three cards and the chosen horizon in plain words, say where inside that horizon the signal leans (early, middle or later) as a conditional reading, and tie it to the specifics of the question without quoting it back verbatim. End in observation, not advice.\n' +
    '2. watchFor: one sentence of 10 to 26 words naming ONE concrete, observable sign that real movement has begun. It must be visible behaviour, not a feeling, and must end with a period.\n' +
    'Every field is plain text. JSON only.';
}

const FORBIDDEN_FREE = /\b(?:will definitely|will certainly|guarantee[ds]?|i promise|destined|meant to be|(?:he|she|they) (?:secretly |still )?(?:feels?|thinks?|wants?|misses|loves?)\b)/i;
const DATE_CLAIM = /\b(?:january|february|march|april|may\s+\d|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|(?:in|within|after|by) (?:the )?(?:next )?\d+ ?(?:day|week|month|hour)s?\b|by (?:day|month) \d+)/i;
const PAID_LEAK = /\b(?:scenario timeline|milestone|checkpoint|reassessment threshold|action plan|timeline map)\b/i;
const COMMERCE = /\$|price|checkout|tier|purchase|package/i;
const DASHES = /[–—]/;

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function auditInsight(result, payload) {
  if (!result || typeof result !== 'object') return 'no result object';
  const { lensNote, watchFor } = result;
  for (const [key, value] of Object.entries({ lensNote, watchFor })) {
    if (typeof value !== 'string' || !value.trim()) return `${key} missing`;
    if (DASHES.test(value)) return `${key} used an em or en dash`;
    if (FORBIDDEN_FREE.test(value)) return `${key} leaked a guarantee or private-state claim`;
    if (DATE_CLAIM.test(value)) return `${key} made a calendar or countdown claim`;
    if (PAID_LEAK.test(value)) return `${key} leaked a paid-tier deliverable`;
    if (COMMERCE.test(value)) return `${key} mentioned commerce`;
  }
  const lw = wordCount(lensNote);
  if (lw < 30 || lw > 85) return `lensNote word count ${lw} outside 30-85`;
  if (!payload.cards.some((card) => lensNote.includes(card.name))) return 'lensNote did not name any supplied card';
  if (!/(day|week|month|horizon|window|stretch|phase|pace)/i.test(lensNote)) return 'lensNote did not anchor to the horizon';
  const ww = wordCount(watchFor);
  if (ww < 8 || ww > 30) return `watchFor word count ${ww} outside 8-30`;
  if (!watchFor.trim().endsWith('.')) return 'watchFor must end with a period';
  if (watchFor.includes('?')) return 'watchFor must be a statement, not a question';
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
    requestId: (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) || `tt_${Date.now()}`,
    feature: 'tt-insight',
    route: '/tarot-timing/insight',
    readingId: payload.readingId,
    promptVersion: TT_PROMPT_VERSION,
  };
  const request = {
    model: TT_MODEL,
    thinking: { type: 'disabled' },
    temperature: 0.6,
    max_tokens: 320,
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
    const completion = await completeDeepSeek(body, env, attempt === 0 ? 'tt-insight' : 'tt-insight-retry', usage);
    const parsed = extractJson(completion.text);
    const candidate = parsed && {
      lensNote: clean(parsed.lensNote, 700),
      watchFor: clean(parsed.watchFor, 260),
    };
    const reason = auditInsight(candidate, payload);
    if (!reason) {
      return { ...candidate, servedModel: TT_MODEL, servedSource: attempt === 0 ? 'model_initial' : 'model_retry' };
    }
    lastReason = reason;
    structuredLog('info', { event: 'tt_insight_rejected', attempt, reason, readingId: payload.readingId });
  }
  const error = new Error(lastReason || 'model unavailable');
  error.code = 'TT_MODEL_REJECTED';
  throw error;
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------
async function handleInsight(request, env) {
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
        event: 'tt_insight_fallback',
        readingId: payload.readingId,
        reason: clean(error && (error.code || error.message), 120) || 'model_error',
      });
    }
  } else {
    degraded = true;
  }
  if (!result) {
    result = { ...deterministicInsight(payload), servedModel: 'deterministic', servedSource: 'design_engine' };
  }

  try {
    await settleFreePreview(env, claim, 'commit-preview');
  } catch (_) {
    // A settle failure must never block the served insight.
  }

  structuredLog('info', {
    event: 'tt_insight_served',
    readingId: payload.readingId,
    focus: payload.focus,
    horizon: payload.horizon,
    cards: payload.cards.map((card) => `${card.name}/${card.orientation[0]}`).join('|'),
    servedSource: result.servedSource,
    degraded,
  });

  return cors(json({
    readingId: payload.readingId,
    funnelVersion: TT_FUNNEL_VERSION,
    promptVersion: TT_PROMPT_VERSION,
    focus: payload.focus,
    horizon: payload.horizon,
    lensNote: result.lensNote,
    watchFor: result.watchFor,
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
    if (path === '/insight' && request.method === 'POST') return handleInsight(request, env);
    if (path === '/health' && request.method === 'GET') {
      return cors(json({ ok: true, funnel: TT_FUNNEL_VERSION }), request);
    }
    return cors(json({ error: 'not_found' }, 404), request);
  },
};
