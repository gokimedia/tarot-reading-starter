// Dedicated rune funnel for the Rune V2 page (/api/rune/*).
//
// Architecture contract: this module stays small (well under 2000 lines) and
// imports the shared kernel (DeepSeek client, entitlement budgets, CORS/JSON
// helpers, logging) from legacy-worker exports instead of duplicating it.
// Everything rune-page-specific (prompt, audits, deterministic fallback copy)
// lives here so the page can evolve without touching the monolith.
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

export const RUNE_FUNNEL_VERSION = 'rune-v2-2026-08';
export const RUNE_PROMPT_VERSION = 'rune-free-cast-v1';
const RUNE_MODEL = 'deepseek-v4-flash';

// ---------------------------------------------------------------------------
// Design data (from the approved Rune V2 page design). The page renders the
// same tables client-side; the server copy is the fallback + validation truth.
// ---------------------------------------------------------------------------
export const RUNES = {
  Fehu: ['Earned gain and what it costs to keep', 'What was gained is leaking away'],
  Uruz: ['Raw strength, health, untamed drive', 'Force applied in the wrong place'],
  Thurisaz: ['A gate with friction on it', 'Reaction moving faster than thought'],
  Ansuz: ['A message arriving, a signal to read', 'Words landing wrong, or not landing'],
  Raidho: ['Movement, travel, a route already chosen', 'Progress stalled, the route in question'],
  Kenaz: ['Clarity, craft, seeing the mechanism', 'Something is still being kept from view'],
  Gebo: ['An exchange, a gift with a return', 'Giving and receiving out of balance'],
  Wunjo: ['Alignment, ease, being in the right place', 'Satisfaction delayed, not denied'],
  Hagalaz: ['Disruption arriving from outside you', 'Weather you cannot argue with'],
  Nauthiz: ['A constraint that teaches something', 'Resistance to the lesson in the need'],
  Isa: ['Stillness, a hold, nothing to force', 'The hold is thawing, but not on your schedule'],
  Jera: ['Harvest in its own season', 'A cycle counted before it closed'],
  Eihwaz: ['Endurance and the long view', 'Avoiding what has to be faced'],
  Perthro: ['A variable still face down', 'Secrecy, information withheld'],
  Algiz: ['Protection and a clean boundary', 'A boundary left open'],
  Sowilo: ['Visibility, momentum in the open', 'Bright light burning the wrong fuel'],
  Tiwaz: ['Commitment, a fair and named decision', "A decision made for someone else's reason"],
  Berkano: ['Growth, a beginning with roots', 'A beginning made too early'],
  Ehwaz: ['Partnership actually in motion', 'Two paces that do not match'],
  Mannaz: ['The self, and how you are being read', 'A story you are telling yourself'],
  Laguz: ['Feeling, intuition, what flows', 'Being carried by feeling'],
  Ingwaz: ['A seed set, work under the surface', 'Potential held, not released'],
  Dagaz: ['A turning point, daylight on it', 'A shift real but not yet visible'],
  Othala: ['Inheritance, home, what you keep', 'Holding what should be handed on'],
};

export const FOCUS_IDS = ['love', 'decision', 'career', 'pattern', 'change', 'self', 'other'];

const REFLECT = {
  love: 'Where in this connection are you waiting for permission you could give yourself?',
  decision: 'Which option are you defending, and which one are you actually drawn to?',
  career: 'What would you need to see in the next two weeks to feel settled either way?',
  pattern: 'What is the earliest moment you can recognise this pattern starting?',
  change: 'What are you still treating as permanent that has already shifted?',
  self: 'Which version of yourself are you protecting, and from whom?',
  other: 'What would change if you stopped waiting for more information?',
};

const STEP = {
  love: 'For the next three days, note what happens when you do not initiate. Record it, do not interpret it yet.',
  decision: 'Write both options as one sentence each. The one that needs a paragraph to defend is the one you doubt.',
  career: 'Name the single condition that would make staying clearly right, then watch for it this month.',
  pattern: 'Pick the earliest point in the pattern you can still influence, and change one small thing there.',
  change: 'List what has already changed without your input, and plan around that list instead of the old version.',
  self: 'Say the thing you want out loud once, to yourself, before you say it to anyone else.',
  other: 'Choose the smallest step you could take this week that you would not need to undo.',
};

const TEASER = {
  love: 'whether reaching out now would create clarity or increase resistance',
  decision: 'whether acting now is a decision or a reaction to the waiting',
  career: 'whether the better terms come from staying or from moving',
  pattern: 'whether the pattern is being repeated by circumstance or by your response to it',
  change: 'whether the shift already underway needs your push or only your patience',
  self: 'whether the change you want is a new direction or an older one you set down',
  other: 'whether the missing piece is more information or a decision',
};

const SLOTS = {
  focused: ['Anchor', 'Gate', 'Direction'],
  crossroads: ['Anchor', 'Path A', 'Path B', 'Gate', 'Move'],
  pattern: ['Root', 'Now', 'Obstacle', 'Support', 'Direction'],
  compass: ['Now', 'Gate', 'Move', 'Watch', 'Direction'],
};

const ANSWER_KINDS = { focused: 3, crossroads: 5, pattern: 5, compass: 5 };
const TIMEFRAMES = new Set(['This week', 'Next 30 days', 'Next 3 months', 'No fixed timeframe']);

// ---------------------------------------------------------------------------
// Input parsing and validation
// ---------------------------------------------------------------------------
function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function parseCastPayload(body) {
  const focus = FOCUS_IDS.includes(body && body.focus) ? body.focus : 'other';
  const kind = ANSWER_KINDS[body && body.answerKind] ? body.answerKind : 'focused';
  const slots = SLOTS[kind];
  const rawCast = Array.isArray(body && body.cast) ? body.cast : [];
  if (rawCast.length !== slots.length) {
    return { ok: false, reason: `cast must contain exactly ${slots.length} runes for the ${kind} spread` };
  }
  const seen = new Set();
  const cast = [];
  for (let i = 0; i < rawCast.length; i += 1) {
    const entry = rawCast[i] || {};
    const name = clean(entry.name, 24);
    if (!RUNES[name]) return { ok: false, reason: `unknown rune name at position ${i + 1}` };
    if (seen.has(name)) return { ok: false, reason: `duplicate rune ${name} in cast` };
    seen.add(name);
    const orientation = entry.orientation === 'reversed' ? 'reversed' : 'upright';
    cast.push({ slot: slots[i], name, orientation });
  }
  const timeframe = TIMEFRAMES.has(body && body.timeframe) ? body.timeframe : 'No fixed timeframe';
  const question = clean(body && body.question, 220);
  const visitorId = clean(body && body.visitorId, 80);
  const readingId = clean(body && body.readingId, 80) || `rune-${Date.now().toString(36)}`;
  return { ok: true, focus, kind, cast, timeframe, question, visitorId, readingId };
}

export function runeMeaning(name, orientation) {
  const entry = RUNES[name];
  if (!entry) return '';
  return orientation === 'reversed' ? entry[1] : entry[0];
}

// ---------------------------------------------------------------------------
// Deterministic fallback (design tables) — never an error box.
// ---------------------------------------------------------------------------
export function deterministicCastReading(payload) {
  const { cast, focus } = payload;
  const center = cast[0];
  const second = cast[1];
  const last = cast[cast.length - 1];
  const theme = `${center.name} ${center.orientation} in ${center.slot} sets the ground here: ${runeMeaning(center.name, center.orientation).toLowerCase()}. ` +
    `${second.name} ${second.orientation} in ${second.slot} adds the live pressure of ${runeMeaning(second.name, second.orientation).toLowerCase()}, ` +
    `while ${last.name} ${last.orientation} in ${last.slot} points where the weight of this cast is leaning.`;
  return {
    theme,
    reflection: REFLECT[focus],
    safeStep: STEP[focus],
    teaser: TEASER[focus],
  };
}

// ---------------------------------------------------------------------------
// LLM path
// ---------------------------------------------------------------------------
function castFacts(payload) {
  return payload.cast
    .map((r) => `${r.slot}: ${r.name} (${r.orientation}) = ${runeMeaning(r.name, r.orientation)}`)
    .join('; ');
}

function systemPrompt() {
  return 'You are the reader behind Deckaura\'s rune page: grounded, plain-spoken and decision-focused, never mystical theatre. ' +
    'You write a FREE preview of an Elder Futhark cast. Use only the supplied runes, orientations and slot names; never invent runes, events, dates or certainty. ' +
    'Never promise a fixed future, never claim access to another person\'s private thoughts or feelings, and never tell the customer what they should do beyond the single provided reflection style. ' +
    'The free preview names the central theme only. The deciding condition, timing windows, path comparisons and the final direction stay reserved for the written reading, so do not state or imply them. ' +
    'Return ONLY strict JSON with keys theme, reflection, step, teaser. No markdown, no code fences, no extra keys, no em or en dashes anywhere.';
}

function userPrompt(payload) {
  const questionLine = payload.question
    ? `Exact customer question (quote nothing verbatim, mirror its situation naturally): "${payload.question}"`
    : 'No question supplied; speak to the chosen focus area in second person.';
  return `FOCUS AREA: ${payload.focus}\nSPREAD: ${payload.kind} (${payload.cast.length} runes)\nTIMEFRAME LENS: ${payload.timeframe}\n${questionLine}\nCAST FACTS: ${castFacts(payload)}\n\n` +
    'Write four fields:\n' +
    `1. theme: 35 to 60 words, 2 or 3 complete sentences. Read the cast as one connected situation in second person. Name at least two runes exactly as given, each with its orientation word (upright or reversed) and slot. Ground every claim in the supplied meanings. End in the present; no outcomes, no advice.\n` +
    `2. reflection: one open question to the customer, 14 to 28 words, ending with a question mark, specific to their focus and cast. Not a yes/no question.\n` +
    `3. step: one small observable action for the coming days, 16 to 34 words, no purchases, no contacting-other-people instructions dressed as certainty, phrased as an experiment to run.\n` +
    `4. teaser: 10 to 22 words, lowercase start, beginning with the word "whether", naming the single unresolved point this cast leaves open for their exact situation. No prices, no product names.\n` +
    'Every field is plain text. JSON only.';
}

const FORBIDDEN_FREE = /\b(?:the answer is|you should (?:leave|stay|text|call|contact|accept|quit)|will definitely|guarantee[ds]?|(?:he|she|they) (?:feels?|thinks?|wants?|misses|loves?) )/i;
const DASHES = /[–—]/;

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function auditCastReading(result, payload) {
  if (!result || typeof result !== 'object') return 'no result object';
  const { theme, reflection, step, teaser } = result;
  for (const [key, value] of Object.entries({ theme, reflection, step, teaser })) {
    if (typeof value !== 'string' || !value.trim()) return `${key} missing`;
    if (DASHES.test(value)) return `${key} used an em or en dash`;
    if (FORBIDDEN_FREE.test(value)) return `${key} leaked a reserved verdict or private-state claim`;
  }
  const tw = wordCount(theme);
  if (tw < 28 || tw > 70) return `theme word count ${tw} outside 28-70`;
  const mentioned = payload.cast.filter((r) => theme.includes(r.name)).length;
  if (mentioned < 2) return `theme mentioned only ${mentioned} of the drawn runes`;
  if (!/\b(?:upright|reversed)\b/i.test(theme)) return 'theme omitted every orientation word';
  const rw = wordCount(reflection);
  if (rw < 10 || rw > 34 || !/\?\s*$/.test(reflection)) return 'reflection outside contract';
  const sw = wordCount(step);
  if (sw < 12 || sw > 40) return `step word count ${sw} outside 12-40`;
  const zw = wordCount(teaser);
  if (zw < 8 || zw > 26 || !/^whether /.test(teaser.trim())) return 'teaser outside contract';
  if (/\$|checkout|reading level|purchase/i.test(teaser)) return 'teaser mentioned commerce';
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

async function generateCastReading(payload, env) {
  const usage = {
    requestId: (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) || `rune_${Date.now()}`,
    feature: 'rune-free-cast',
    route: '/rune/free-cast',
    readingId: payload.readingId,
    promptVersion: RUNE_PROMPT_VERSION,
  };
  const request = {
    model: RUNE_MODEL,
    thinking: { type: 'disabled' },
    temperature: 0.65,
    max_tokens: 420,
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
    const completion = await completeDeepSeek(body, env, attempt === 0 ? 'rune-free-cast' : 'rune-free-cast-retry', usage);
    const parsed = extractJson(completion.text);
    const candidate = parsed && {
      theme: clean(parsed.theme, 620),
      reflection: clean(parsed.reflection, 260),
      safeStep: clean(parsed.step || parsed.safeStep, 300),
      teaser: clean(parsed.teaser, 200),
    };
    const reason = auditCastReading(candidate && { ...candidate, step: candidate.safeStep }, payload);
    if (!reason) {
      return { ...candidate, servedModel: RUNE_MODEL, servedSource: attempt === 0 ? 'model_initial' : 'model_retry' };
    }
    lastReason = reason;
    structuredLog('info', { event: 'rune_free_cast_rejected', attempt, reason, readingId: payload.readingId });
  }
  const error = new Error(lastReason || 'model unavailable');
  error.code = 'RUNE_MODEL_REJECTED';
  throw error;
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------
async function handleFreeCast(request, env) {
  let body;
  try {
    body = await readJsonBody(request, 32 * 1024);
  } catch (_) {
    return cors(json({ error: 'invalid_json' }, 400), request);
  }
  const payload = parseCastPayload(body);
  if (!payload.ok) return cors(json({ error: 'invalid_cast', reason: payload.reason }, 422), request);

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
      result = await generateCastReading(payload, env);
    } catch (error) {
      degraded = true;
      structuredLog('warn', {
        event: 'rune_free_cast_fallback',
        readingId: payload.readingId,
        reason: clean(error && (error.code || error.message), 120) || 'model_error',
      });
    }
  } else {
    degraded = true;
  }
  if (!result) {
    result = { ...deterministicCastReading(payload), servedModel: 'deterministic', servedSource: 'deterministic_design_tables' };
  }

  try {
    await settleFreePreview(env, claim, 'commit-preview');
  } catch (_) {
    // A settle failure must never block the served reading.
  }

  structuredLog('info', {
    event: 'rune_free_cast_served',
    readingId: payload.readingId,
    focus: payload.focus,
    kind: payload.kind,
    servedSource: result.servedSource,
    degraded,
  });

  return cors(json({
    readingId: payload.readingId,
    funnelVersion: RUNE_FUNNEL_VERSION,
    promptVersion: RUNE_PROMPT_VERSION,
    focus: payload.focus,
    spread: payload.kind,
    theme: result.theme,
    reflection: result.reflection,
    safeStep: result.safeStep,
    teaser: result.teaser,
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
    if (path === '/free-cast' && request.method === 'POST') return handleFreeCast(request, env);
    if (path === '/health' && request.method === 'GET') {
      return cors(json({ ok: true, funnel: RUNE_FUNNEL_VERSION }), request);
    }
    return cors(json({ error: 'not_found' }, 404), request);
  },
};
