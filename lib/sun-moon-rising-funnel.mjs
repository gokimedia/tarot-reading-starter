// Dedicated Sun Moon Rising funnel for the Big Three V2 page
// (/api/sun-moon-rising/*).
//
// Architecture contract: small module importing the shared kernel from
// legacy-worker exports. The page calculates placements client-side with the
// astronomy engine; the server only validates sign names against the zodiac
// canon and writes an audited free synthesis. The pairwise dynamics, loop
// mapping, plans and the blueprint stay paid-only and must never leak here.
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

export const SMR_FUNNEL_VERSION = 'sun-moon-rising-v2-2026-08';
export const SMR_PROMPT_VERSION = 'smr-synthesis-v1';
const SMR_MODEL = 'deepseek-v4-flash';

export const SMR_SIGNS = Object.freeze({
  Aries: ['Fire', 'direct action and visible progress', 'space to react honestly and immediately', 'fast, forward and ready to start'],
  Taurus: ['Earth', 'steadiness and something you can build on', 'predictability and physical comfort', 'calm, grounded and unhurried'],
  Gemini: ['Air', 'movement, ideas and variety', 'to talk things through before you settle', 'quick, adaptable and mentally active'],
  Cancer: ['Water', 'closeness and something worth protecting', 'emotional safety and to be remembered', 'gentle, careful and quietly protective'],
  Leo: ['Fire', 'visibility and creative self-expression', 'warm recognition from the people who matter', 'warm, present and hard to overlook'],
  Virgo: ['Earth', 'usefulness and work done properly', 'order and a plan you can trust', 'measured, competent and slightly reserved'],
  Libra: ['Air', 'balance and decisions made together', 'harmony and to know where you stand', 'pleasant, considerate and easy to be around'],
  Scorpio: ['Water', 'depth and something that means everything', 'certainty before you let anyone close', 'controlled, observant and private'],
  Sagittarius: ['Fire', 'range and room to move', 'honesty over politeness, and an exit', 'open, candid and unbothered'],
  Capricorn: ['Earth', 'authority earned slowly', 'control and self-sufficiency', 'serious, capable and self-contained'],
  Aquarius: ['Air', 'independence and a better system', 'distance to process before you share', 'friendly, but hard to place'],
  Pisces: ['Water', 'meaning and imaginative freedom', 'softness and space to process what you absorb', 'soft, receptive and slightly elsewhere'],
});

export const SMR_FOCI = Object.freeze({
  self: 'Understand Myself',
  love: 'Love & Relationships',
  work: 'Work Style & Motivation',
  pattern: 'A Repeating Pattern',
  change: 'Ready for Change',
  theme: 'My Strongest Theme',
});

const TIME_CONF = new Set(['exact', 'approx', 'unknown']);

function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function parseSynthesisPayload(body) {
  const sun = clean(body && body.sun, 16);
  const moon = clean(body && body.moon, 16);
  if (!Object.hasOwn(SMR_SIGNS, sun)) return { ok: false, reason: 'sun must be a canonical zodiac sign' };
  if (!Object.hasOwn(SMR_SIGNS, moon)) return { ok: false, reason: 'moon must be a canonical zodiac sign' };
  const risingRaw = clean(body && body.rising, 16);
  let rising = null;
  if (risingRaw) {
    if (!Object.hasOwn(SMR_SIGNS, risingRaw)) return { ok: false, reason: 'rising must be a canonical zodiac sign when supplied' };
    rising = risingRaw;
  }
  const timeConf = clean(body && body.timeConf, 12).toLowerCase();
  if (!TIME_CONF.has(timeConf)) return { ok: false, reason: 'timeConf must be exact, approx or unknown' };
  if (timeConf === 'unknown' && rising) return { ok: false, reason: 'rising cannot be supplied without a birth time' };
  if (timeConf !== 'unknown' && !rising) return { ok: false, reason: 'rising is required when a birth time was supplied' };
  const focus = clean(body && body.focus, 12).toLowerCase();
  if (!Object.hasOwn(SMR_FOCI, focus)) return { ok: false, reason: 'focus must be one of self, love, work, pattern, change, theme' };
  const visitorId = clean(body && body.visitorId, 80);
  const readingId = clean(body && body.readingId, 80) || `rs2-${Date.now().toString(36)}`;
  return { ok: true, sun, moon, rising, timeConf, focus, focusLabel: SMR_FOCI[focus], visitorId, readingId };
}

// ---------------------------------------------------------------------------
// Deterministic fallback = the page's own synthesis formula (design copy), so
// degradation is invisible.
// ---------------------------------------------------------------------------
export function deterministicSynthesis(payload) {
  const sun = SMR_SIGNS[payload.sun];
  const moon = SMR_SIGNS[payload.moon];
  const rising = payload.rising ? SMR_SIGNS[payload.rising] : null;
  return {
    synthesis: `At your core you seek ${sun[1]}. Emotionally, you need ${moon[2]}. ` + (rising
      ? `Yet people may first experience you as ${rising[3]}.`
      : 'How you come across is the part we cannot confirm without your birth time.'),
    note: 'This is the free synthesis of your three placements. It describes the parts, not yet the way they negotiate with each other.',
  };
}

// ---------------------------------------------------------------------------
// LLM path
// ---------------------------------------------------------------------------
function synthesisFacts(payload) {
  const lines = [
    `Sun sign: ${payload.sun} (${SMR_SIGNS[payload.sun][0]}) - core direction: ${SMR_SIGNS[payload.sun][1]}`,
    `Moon sign: ${payload.moon} (${SMR_SIGNS[payload.moon][0]}) - emotional need: ${SMR_SIGNS[payload.moon][2]}`,
    payload.rising
      ? `Rising sign: ${payload.rising} (${SMR_SIGNS[payload.rising][0]}) - first impression: ${SMR_SIGNS[payload.rising][3]}${payload.timeConf === 'approx' ? ' (estimated from an approximate birth time)' : ''}`
      : 'Rising sign: not calculated because no birth time was supplied; never guess it',
    `Chosen focus: ${payload.focusLabel}`,
  ];
  return lines.join('\n');
}

function systemPrompt() {
  return 'You are the reader behind Deckaura\'s Big Three page: grounded, warm and plain-spoken, never mystical theatre. ' +
    'You write the FREE one-paragraph synthesis of a calculated Sun, Moon and Rising result. Use only the supplied placements and focus; never invent houses, aspects, degrees or a Rising sign that was not calculated. ' +
    'Never predict the future, never diagnose, never present the signs as a fixed personality verdict, and never claim another person\'s private thoughts. ' +
    'The pairwise dynamics, the trigger-need-protection loop, the plans and the blueprint are paid deliverables, so do not state or imply them. ' +
    'Return ONLY strict JSON with keys synthesis and note. No markdown, no code fences, no extra keys, no em or en dashes anywhere.';
}

function userPrompt(payload) {
  return `${synthesisFacts(payload)}\n\n` +
    'Write two fields:\n' +
    '1. synthesis: 34 to 70 words, 2 or 3 complete sentences in second person, present tense. Name at least two of the sign names in plain words, weave their themes into one coherent picture angled toward the chosen focus' +
    (payload.rising ? '' : ', and acknowledge honestly that the first-impression layer is unknown without a birth time') +
    '. End in observation, not advice.\n' +
    '2. note: one sentence of 12 to 28 words saying this free synthesis describes the parts, while how the placements negotiate with each other is a deeper layer. No prices, no product names.\n' +
    'Every field is plain text. JSON only.';
}

const FORBIDDEN_FREE = /\b(?:will definitely|will certainly|guarantee[ds]?|i promise|destined|meant to be|(?:he|she|they) (?:secretly |still )?(?:feels?|thinks?|wants?|misses|loves?)\b)/i;
const PAID_LEAK = /\b(?:trigger|protection loop|blueprint|integration plan|one-page summary|safe-state|stress-state|do more|do less)\b/i;
const COMMERCE = /\$|price|checkout|tier|purchase|package/i;
const DASHES = /[–—]/;

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function auditSynthesis(result, payload) {
  if (!result || typeof result !== 'object') return 'no result object';
  const { synthesis, note } = result;
  for (const [key, value] of Object.entries({ synthesis, note })) {
    if (typeof value !== 'string' || !value.trim()) return `${key} missing`;
    if (DASHES.test(value)) return `${key} used an em or en dash`;
    if (FORBIDDEN_FREE.test(value)) return `${key} leaked a guarantee or private-state claim`;
    if (PAID_LEAK.test(value)) return `${key} leaked a paid-tier deliverable`;
    if (COMMERCE.test(value)) return `${key} mentioned commerce`;
  }
  const sw = wordCount(synthesis);
  if (sw < 28 || sw > 80) return `synthesis word count ${sw} outside 28-80`;
  const named = [payload.sun, payload.moon, payload.rising].filter(Boolean)
    .filter((sign) => synthesis.includes(sign)).length;
  // The deterministic design formula speaks in placement themes instead of
  // sign names; accept that exact shape while holding the model to names.
  const designShape = /at your core you seek/i.test(synthesis) && /emotionally, you need/i.test(synthesis);
  if (named < 2 && !designShape) return 'synthesis named fewer than two of the supplied signs';
  if (!payload.rising && /rising/i.test(synthesis) === false && /birth time|first impression|come across/i.test(synthesis) === false) {
    return 'synthesis did not acknowledge the missing Rising layer';
  }
  const nw = wordCount(note);
  if (nw < 8 || nw > 34) return `note word count ${nw} outside 8-34`;
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

async function generateSynthesis(payload, env) {
  const usage = {
    requestId: (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) || `rs_${Date.now()}`,
    feature: 'smr-synthesis',
    route: '/sun-moon-rising/insight',
    readingId: payload.readingId,
    promptVersion: SMR_PROMPT_VERSION,
  };
  const request = {
    model: SMR_MODEL,
    thinking: { type: 'disabled' },
    temperature: 0.6,
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
    const completion = await completeDeepSeek(body, env, attempt === 0 ? 'smr-synthesis' : 'smr-synthesis-retry', usage);
    const parsed = extractJson(completion.text);
    const candidate = parsed && {
      synthesis: clean(parsed.synthesis, 640),
      note: clean(parsed.note, 300),
    };
    const reason = auditSynthesis(candidate, payload);
    if (!reason) {
      return { ...candidate, servedModel: SMR_MODEL, servedSource: attempt === 0 ? 'model_initial' : 'model_retry' };
    }
    lastReason = reason;
    structuredLog('info', { event: 'smr_synthesis_rejected', attempt, reason, readingId: payload.readingId });
  }
  const error = new Error(lastReason || 'model unavailable');
  error.code = 'SMR_MODEL_REJECTED';
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
  const payload = parseSynthesisPayload(body);
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
      result = await generateSynthesis(payload, env);
    } catch (error) {
      degraded = true;
      structuredLog('warn', {
        event: 'smr_synthesis_fallback',
        readingId: payload.readingId,
        reason: clean(error && (error.code || error.message), 120) || 'model_error',
      });
    }
  } else {
    degraded = true;
  }
  if (!result) {
    result = { ...deterministicSynthesis(payload), servedModel: 'deterministic', servedSource: 'design_formula' };
  }

  try {
    await settleFreePreview(env, claim, 'commit-preview');
  } catch (_) {
    // A settle failure must never block the served synthesis.
  }

  structuredLog('info', {
    event: 'smr_synthesis_served',
    readingId: payload.readingId,
    combo: `${payload.sun}/${payload.moon}/${payload.rising || 'none'}`,
    timeConf: payload.timeConf,
    focus: payload.focus,
    servedSource: result.servedSource,
    degraded,
  });

  return cors(json({
    readingId: payload.readingId,
    funnelVersion: SMR_FUNNEL_VERSION,
    promptVersion: SMR_PROMPT_VERSION,
    synthesis: result.synthesis,
    note: result.note,
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
      return cors(json({ ok: true, funnel: SMR_FUNNEL_VERSION }), request);
    }
    return cors(json({ error: 'not_found' }, 404), request);
  },
};
