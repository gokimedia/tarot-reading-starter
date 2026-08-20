// Dedicated Angel Number funnel for the Angel Number V2 page (/api/angel-number/*).
//
// Architecture contract: this module stays small (well under 2000 lines) and
// imports the shared kernel (DeepSeek client, entitlement budgets, CORS/JSON
// helpers, logging) from legacy-worker exports instead of duplicating it.
// Everything page-specific (theme words, area templates, prompt, audits,
// deterministic fallback copy) lives here. The area templates mirror the V2
// page design exactly, so a degraded response is indistinguishable from the
// page's own deterministic preview. The free preview connects a sequence's
// general symbolism to the customer's situation; the applied interpretation,
// the condition that changes the message and any plan stay paid-only.
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

export const AN_FUNNEL_VERSION = 'angel-number-v2-2026-08';
export const AN_PROMPT_VERSION = 'an-free-preview-v1';
const AN_MODEL = 'deepseek-v4-flash';

// ---------------------------------------------------------------------------
// Theme words per canonical display key (from the approved V2 page design).
// The page ships the same table client-side; the server copy is the fallback
// and validation truth. Sequences outside this table read through their
// single-digit reduced root repeated three times (design behaviour).
// ---------------------------------------------------------------------------
export const AN_WORDS = Object.freeze({
  '000': 'openness',
  '111': 'new alignment',
  '222': 'balance',
  '333': 'expression',
  '444': 'stability',
  '555': 'change',
  '666': 'recalibration',
  '777': 'alignment',
  '888': 'return',
  '999': 'completion',
  '1010': 'decision',
  '1111': 'attention',
  '1212': 'progress',
});

export const AN_AREAS = Object.freeze({
  love: Object.freeze({
    label: 'Love & relationships',
    pvLabel: 'In your relationship context',
    anchor: /\b(?:relationship|connection|partner|dating|trust|between you|talking|bond|the other person|reconnect)/i,
    sit: 'Here, {w} is better measured through consistency and reciprocal effort than emotional intensity. The useful question is not whether the connection feels powerful, but whether it is becoming safer and more dependable.',
    open: 'What would need to become more consistent before you trusted this connection?',
  }),
  person: Object.freeze({
    label: 'A specific person / no contact',
    pvLabel: 'In this specific situation',
    anchor: /\b(?:person|contact|they|them|their|notice|silence|reach|the other)/i,
    sit: 'Here, {w} describes what you are being asked to notice, not what the other person is thinking. The useful question is which part of this is actually inside your control this week.',
    open: 'If nothing about them changed, what would you still want to decide for yourself?',
  }),
  career: Object.freeze({
    label: 'Career & money',
    pvLabel: 'In your work context',
    anchor: /\b(?:work|career|offer|job|money|decision|role|evidence|pay|position|professional)/i,
    sit: 'Here, {w} is a description of conditions rather than a verdict on the offer. The useful question is which part of the decision is already supported by evidence, and which part is still assumption.',
    open: 'What would you need to see in writing before this stopped feeling like a risk?',
  }),
  change: Object.freeze({
    label: 'Change or a decision',
    pvLabel: 'In this decision',
    anchor: /\b(?:change|decision|move|transition|step|choice|test|path|direction)/i,
    sit: 'Here, {w} says more about how to move than whether to move. The useful question is what would have to be true before the next step stops feeling like a gamble.',
    open: 'What is the smallest version of this change you could test first?',
  }),
  spirit: Object.freeze({
    label: 'Spiritual growth',
    pvLabel: 'In your inner work',
    anchor: /\b(?:pattern|inner|yourself|growth|lesson|self|answer|practice|habit|spiritual)/i,
    sit: 'Here, {w} points at a lesson that is repeating rather than a level you have already passed. The useful question is where you already know the answer and have been waiting for permission.',
    open: 'Which pattern have you now recognized often enough to interrupt?',
  }),
  several: Object.freeze({
    label: 'Several numbers / a repeating pattern',
    pvLabel: 'Across the numbers you are seeing',
    anchor: /\b(?:numbers?|pattern|sequences?|together|signs?|theme|repeat)/i,
    sit: 'When several numbers appear together, the theme they share matters more than any single meaning. The useful question is whether they point at one situation from different angles, or at separate areas of your life.',
    open: 'Are these numbers describing one situation, or two that you have been treating as one?',
  }),
});

function digitSum(value) {
  return String(value).split('').reduce((total, ch) => total + Number(ch), 0);
}

// Display-layer root (design behaviour): plain reduction to a single digit,
// no master numbers. The paid pipeline's core-theme layer (master-preserving)
// lives client-side next to the checkout signals, not here.
export function displayKeyFor(number) {
  if (Object.hasOwn(AN_WORDS, number)) return number;
  let root = digitSum(number);
  while (root > 9) root = digitSum(root);
  return root === 0 ? '000' : String(root).repeat(3);
}

// ---------------------------------------------------------------------------
// Input parsing and validation
// ---------------------------------------------------------------------------
function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function parsePreviewPayload(body) {
  const number = clean(body && body.number, 8).replace(/[^0-9]/g, '');
  if (!/^[0-9]{1,6}$/.test(number)) return { ok: false, reason: 'number must be 1 to 6 digits' };
  const areaId = clean(body && body.areaId, 16).toLowerCase();
  if (!Object.hasOwn(AN_AREAS, areaId)) return { ok: false, reason: 'areaId must be one of love, person, career, change, spirit, several' };
  const q1 = clean(body && body.q1, 360);
  const q2 = clean(body && body.q2, 240);
  const visitorId = clean(body && body.visitorId, 80);
  const readingId = clean(body && body.readingId, 80) || `an2-${Date.now().toString(36)}`;
  const displayKey = displayKeyFor(number);
  return {
    ok: true,
    number,
    areaId,
    area: AN_AREAS[areaId],
    displayKey,
    word: AN_WORDS[displayKey],
    derived: displayKey !== number,
    q1,
    q2,
    visitorId,
    readingId,
  };
}

// ---------------------------------------------------------------------------
// Deterministic fallback (design templates) — never an error box. The page
// ships identical templates client-side, so degradation is invisible.
// ---------------------------------------------------------------------------
export function deterministicPreview(payload) {
  return {
    situated: payload.area.sit.replace('{w}', payload.word),
    open: payload.area.open,
  };
}

// ---------------------------------------------------------------------------
// LLM path
// ---------------------------------------------------------------------------
function previewFacts(payload) {
  const lines = [
    `Number the customer keeps seeing: ${payload.number}`,
    payload.derived
      ? `General theme (via its reduced root ${payload.displayKey}): ${payload.word}`
      : `General theme: ${payload.word}`,
    `Life area: ${payload.area.label}`,
  ];
  if (payload.q1) lines.push(`Customer situation, their own words: "${payload.q1}"`);
  if (payload.q2) lines.push(`What they want this sign to help them understand: "${payload.q2}"`);
  return lines.join('\n');
}

function systemPrompt() {
  return 'You are the reader behind Deckaura\'s angel number page: grounded, plain-spoken and decision-focused, never mystical theatre. ' +
    'You write a FREE contextual preview that connects one number sequence\'s general symbolism to the customer\'s own situation. Use only the supplied number, theme and customer words; never invent events, names, dates or certainty. ' +
    'Never promise a fixed future, never answer yes or no to their dilemma, never claim access to another person\'s private thoughts or feelings, and never diagnose. ' +
    'The applied interpretation, the condition that changes the message and any plan stay reserved for the written reading, so do not state or imply them. ' +
    'Return ONLY strict JSON with keys situated and open. No markdown, no code fences, no extra keys, no em or en dashes anywhere.';
}

function userPrompt(payload) {
  return `${previewFacts(payload)}\n\n` +
    'Write two fields:\n' +
    '1. situated: 34 to 68 words, 2 or 3 complete sentences in second person, present tense. Read the theme inside the chosen life area, naming that life area in plain words at least once' +
    (payload.q1 ? ', angled toward the specifics the customer described without quoting them back verbatim' : '') +
    '. Sound like measured observation of their situation, not advice, and end in observation.\n' +
    '2. open: 8 to 22 words, exactly one reflective question this situation leaves open, ending with a question mark. It must be answerable only by the customer, not a yes/no verdict about another person. No prices, no product names.\n' +
    'Every field is plain text. JSON only.';
}

const FORBIDDEN_FREE = /\b(?:will definitely|will certainly|guarantee[ds]?|i promise|soul ?mate|meant to be|destined|(?:he|she|they) (?:secretly |still )?(?:feels?|thinks?|wants?|misses|loves?)\b)/i;
const PAID_LEAK = /\b(?:30[- ]day|thirty[- ]day|7[- ]day sign tracker|life path layer|alignment map)\b/i;
const COMMERCE = /\$|price|checkout|tier|purchase|package/i;
const DASHES = /[–—]/;

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function auditPreview(result, payload) {
  if (!result || typeof result !== 'object') return 'no result object';
  const { situated, open } = result;
  for (const [key, value] of Object.entries({ situated, open })) {
    if (typeof value !== 'string' || !value.trim()) return `${key} missing`;
    if (DASHES.test(value)) return `${key} used an em or en dash`;
    if (FORBIDDEN_FREE.test(value)) return `${key} leaked a guarantee or private-state claim`;
    if (PAID_LEAK.test(value)) return `${key} leaked a paid-tier deliverable`;
    if (COMMERCE.test(value)) return `${key} mentioned commerce`;
  }
  const sw = wordCount(situated);
  if (sw < 24 || sw > 80) return `situated word count ${sw} outside 24-80`;
  if (!payload.area.anchor.test(situated)) return 'situated did not anchor to the chosen life area';
  const ow = wordCount(open);
  if (ow < 6 || ow > 26) return `open word count ${ow} outside 6-26`;
  if (!open.trim().endsWith('?')) return 'open must end with a question mark';
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

async function generatePreview(payload, env) {
  const usage = {
    requestId: (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) || `an_${Date.now()}`,
    feature: 'an-free-preview',
    route: '/angel-number/preview',
    readingId: payload.readingId,
    promptVersion: AN_PROMPT_VERSION,
  };
  const request = {
    model: AN_MODEL,
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
    const completion = await completeDeepSeek(body, env, attempt === 0 ? 'an-free-preview' : 'an-free-preview-retry', usage);
    const parsed = extractJson(completion.text);
    const candidate = parsed && {
      situated: clean(parsed.situated, 620),
      open: clean(parsed.open, 220),
    };
    const reason = auditPreview(candidate, payload);
    if (!reason) {
      return { ...candidate, servedModel: AN_MODEL, servedSource: attempt === 0 ? 'model_initial' : 'model_retry' };
    }
    lastReason = reason;
    structuredLog('info', { event: 'an_free_preview_rejected', attempt, reason, readingId: payload.readingId });
  }
  const error = new Error(lastReason || 'model unavailable');
  error.code = 'AN_MODEL_REJECTED';
  throw error;
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------
async function handleFreePreview(request, env) {
  let body;
  try {
    body = await readJsonBody(request, 16 * 1024);
  } catch (_) {
    return cors(json({ error: 'invalid_json' }, 400), request);
  }
  const payload = parsePreviewPayload(body);
  if (!payload.ok) return cors(json({ error: 'invalid_preview_request', reason: payload.reason }, 422), request);

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
      result = await generatePreview(payload, env);
    } catch (error) {
      degraded = true;
      structuredLog('warn', {
        event: 'an_free_preview_fallback',
        readingId: payload.readingId,
        reason: clean(error && (error.code || error.message), 120) || 'model_error',
      });
    }
  } else {
    degraded = true;
  }
  if (!result) {
    result = { ...deterministicPreview(payload), servedModel: 'deterministic', servedSource: 'deterministic_design_tables' };
  }

  try {
    await settleFreePreview(env, claim, 'commit-preview');
  } catch (_) {
    // A settle failure must never block the served preview.
  }

  structuredLog('info', {
    event: 'an_free_preview_served',
    readingId: payload.readingId,
    number: payload.number,
    displayKey: payload.displayKey,
    areaId: payload.areaId,
    hasSituation: Boolean(payload.q1),
    servedSource: result.servedSource,
    degraded,
  });

  return cors(json({
    readingId: payload.readingId,
    funnelVersion: AN_FUNNEL_VERSION,
    promptVersion: AN_PROMPT_VERSION,
    number: payload.number,
    displayKey: payload.displayKey,
    word: payload.word,
    areaId: payload.areaId,
    pvLabel: payload.area.pvLabel,
    situated: result.situated,
    open: result.open,
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
    if (path === '/preview' && request.method === 'POST') return handleFreePreview(request, env);
    if (path === '/health' && request.method === 'GET') {
      return cors(json({ ok: true, funnel: AN_FUNNEL_VERSION }), request);
    }
    return cors(json({ error: 'not_found' }, 404), request);
  },
};
