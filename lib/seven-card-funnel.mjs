// Dedicated seven-card horseshoe funnel for the 7 Card Tarot Reading V2 page
// (/api/seven-card/*).
//
// Architecture contract: this module stays small and page-owned. It PINS the
// page identity server-side, delegates the proven free-reading pipeline
// (entitlement, preview-token authority, compact insight, audits) to the
// legacy worker unchanged, and then adds the V2 page's structured three-block
// insight panel with its own prompt, audit and deterministic fallback. All
// page-specific knobs live at the top of this file so they can be tuned
// without touching the monolith.
import legacyWorker, {
  TAROT_CARD_NAMES,
  allowedStorefrontOrigin,
  completeDeepSeek,
  cors,
  json,
  modelCredential,
  readJsonBody,
  structuredLog,
} from './legacy-worker.mjs';

export const SEVEN_CARD_FUNNEL_VERSION = 'seven-card-v2-2026-08';
export const SEVEN_CARD_INSIGHTS_PROMPT_VERSION = 'sc7-insights-v1';

// ---- page identity pins (the storefront cannot drift these) ---------------
const PAGE = '/pages/7-card-tarot-reading';
const TYPE = 'Tarot';
const SPREAD = 'seven-card-horseshoe';
const PRESENTATION_VARIANT = 'seven-card-compact-v1';
const SNAPSHOT_VERSION = 'reading-snapshot-v2';
const SHARED_FUNNEL_VERSION = 'enterprise-shared-tools-2026-08-v1';
const SCOPE = 'Seven-card horseshoe overview: past, present, hidden influence, obstacle, external influence, advice and outcome read together for one focused question.';
const CONFIDENCE = 'Symbolic tarot guidance for reflection, not a factual or guaranteed prediction.';

// ---- V2 insight panel knobs ------------------------------------------------
const INSIGHT_MODEL = 'deepseek-v4-flash';
const INSIGHT_TEMPERATURE = 0.4;
const INSIGHT_MAX_TOKENS = 360;
const INSIGHT_LABELS = ['The core pattern', 'The deciding condition', 'What you can influence'];
const LEAD_WORDS = [3, 12];
const BODY_WORDS = [14, 46];

// Canonical horseshoe position labels — the legacy intent-time evidence
// validation verifies against exactly these, so the page sends these in
// signals/cards even when it DISPLAYS the design's shorter labels.
export const POSITIONS = [
  'Past',
  'Present',
  'Hidden Influences',
  'Obstacle',
  'External Influences',
  'Advice',
  'Likely Outcome',
];

const CARD_NAME_SET = new Set(TAROT_CARD_NAMES.map((name) => name.toLowerCase()));

function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function wordCount(value) {
  return String(value || '').split(/\s+/).filter(Boolean).length;
}

// The page sends the legacy signals contract: one string of
// "Past: Six of Cups Upright; Present: Two of Swords Reversed; ...".
export function parseSevenCards(signals) {
  const parts = String(signals || '').split(';').map((part) => part.trim()).filter(Boolean);
  if (parts.length !== POSITIONS.length) return null;
  const cards = [];
  for (let index = 0; index < POSITIONS.length; index += 1) {
    const match = parts[index].match(/^([^:]+):\s*(.+?)\s+(Upright|Reversed)$/i);
    if (!match) return null;
    if (clean(match[1], 40).toLowerCase() !== POSITIONS[index].toLowerCase()) return null;
    const name = clean(match[2], 60);
    if (!name || !CARD_NAME_SET.has(name.toLowerCase())) return null;
    cards.push({ position: POSITIONS[index], name, reversed: /reversed/i.test(match[3]) });
  }
  const unique = new Set(cards.map((card) => card.name.toLowerCase()));
  if (unique.size !== cards.length) return null;
  return cards;
}

// ---------------------------------------------------------------------------
// Deterministic fallback (design's editorial pattern, filled with the real
// cards) — the panel never renders an error box.
// ---------------------------------------------------------------------------
export function deterministicInsights(cards, question) {
  const byPosition = Object.fromEntries(cards.map((card) => [card.position, card]));
  const face = (card) => card.reversed ? `${card.name} reversed` : card.name;
  const past = byPosition.Past;
  const present = byPosition.Present;
  const hidden = byPosition['Hidden Influences'];
  const obstacle = byPosition.Obstacle;
  const advice = byPosition.Advice;
  const outcome = byPosition['Likely Outcome'];
  return [
    {
      n: '01',
      label: INSIGHT_LABELS[0],
      lead: 'Something from earlier still sets the terms.',
      body: `${face(past)} in the Past and ${face(present)} in the Present place your question inside a pattern that formed before today. The present reads as held in place rather than closed.`,
    },
    {
      n: '02',
      label: INSIGHT_LABELS[1],
      lead: 'The outcome moves with one condition.',
      body: `${face(outcome)} in the Outcome position turns on the friction ${face(obstacle)} names in the Obstacle slot, with ${face(hidden)} still working underneath. Which way it tips is what your full reading maps.`,
    },
    {
      n: '03',
      label: INSIGHT_LABELS[2],
      lead: `${advice.name} points to what is yours to choose.`,
      body: `${face(advice)} in the Advice position marks the one part of this inside your control. Acting on it deliberately is what shifts the pattern the other cards describe.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Audit — free tier must intrigue, stay grounded in the exact cards and never
// resolve the paid question.
// ---------------------------------------------------------------------------
const FORBIDDEN_FREE = /\b(?:will (?:definitely|certainly|surely)|guaranteed?|i promise|(?:he|she|they) (?:loves?|misses?|wants?|is thinking))\b/i;
const DATE_CLAIM = /\b(?:on|by|before|after) (?:january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/i;

export function auditInsights(insights, cards) {
  if (!Array.isArray(insights) || insights.length !== 3) return { ok: false, reason: 'expected exactly three insight blocks' };
  const suppliedNames = cards.map((card) => card.name);
  const suppliedLower = new Set(suppliedNames.map((name) => name.toLowerCase()));
  let namedSupplied = new Set();
  for (let index = 0; index < 3; index += 1) {
    const block = insights[index] || {};
    const label = clean(block.label, 60);
    const lead = clean(block.lead, 160);
    const body = clean(block.body, 480);
    if (label !== INSIGHT_LABELS[index]) return { ok: false, reason: `block ${index + 1} label must be "${INSIGHT_LABELS[index]}"` };
    const leadWords = wordCount(lead);
    if (leadWords < LEAD_WORDS[0] || leadWords > LEAD_WORDS[1]) return { ok: false, reason: `block ${index + 1} lead word count ${leadWords} outside ${LEAD_WORDS[0]}-${LEAD_WORDS[1]}` };
    const bodyWords = wordCount(body);
    if (bodyWords < BODY_WORDS[0] || bodyWords > BODY_WORDS[1]) return { ok: false, reason: `block ${index + 1} body word count ${bodyWords} outside ${BODY_WORDS[0]}-${BODY_WORDS[1]}` };
    const text = `${lead} ${body}`;
    if (/[–—]/.test(text)) return { ok: false, reason: 'em or en dash in insight text' };
    if (FORBIDDEN_FREE.test(text)) return { ok: false, reason: `block ${index + 1} makes a verdict or private-state claim` };
    if (DATE_CLAIM.test(text)) return { ok: false, reason: `block ${index + 1} promises timing` };
    for (const name of TAROT_CARD_NAMES) {
      if (!suppliedLower.has(name.toLowerCase()) && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) {
        return { ok: false, reason: `block ${index + 1} names ${name}, which is not in this spread` };
      }
    }
    for (const name of suppliedNames) {
      if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) namedSupplied.add(name.toLowerCase());
    }
  }
  if (namedSupplied.size < 3) return { ok: false, reason: `only ${namedSupplied.size} of the supplied cards are named across the three blocks (need at least 3)` };
  return { ok: true };
}

function insightsPrompt(question, cards) {
  const castLine = cards.map((card) => `${card.position}: ${card.name}${card.reversed ? ' reversed' : ''}`).join('; ');
  const system = [
    'You write the free three-block insight panel for a seven-card tarot horseshoe on Deckaura.',
    'Grounded, plain-spoken, non-mystical. British-neutral English. No em or en dashes.',
    'Rules:',
    `- Return STRICT JSON: an array of exactly 3 objects {"label","lead","body"} with labels exactly "${INSIGHT_LABELS[0]}", "${INSIGHT_LABELS[1]}", "${INSIGHT_LABELS[2]}" in that order.`,
    `- lead: ${LEAD_WORDS[0]} to ${LEAD_WORDS[1]} words, a sharp plain-language headline.`,
    `- body: ${BODY_WORDS[0]} to ${BODY_WORDS[1]} words.`,
    '- Use ONLY the supplied cards; never mention any other card. Across the three bodies, name at least three of the supplied cards with their position (for example "Two of Swords in the Present").',
    '- Block 1 explains the pattern the Past and Present cards form around the exact question.',
    '- Block 2 states the single condition the Outcome turns on, using the Obstacle or Hidden influence card. Name what it depends on but NEVER which way it resolves, no timing, no dates.',
    '- Block 3 names the one thing inside the customer\'s control, from the Advice card, as an observation rather than an instruction list.',
    '- Never answer the question, never predict, never claim another person\'s private feelings or thoughts.',
  ].join('\n');
  const user = `Exact question: "${question}"\nSpread: ${castLine}\nReturn the JSON array only.`;
  return { system, user };
}

export async function generateInsights(payload, env, options = {}) {
  const question = clean(payload.question, 240);
  const cards = payload.cards;
  const fallback = deterministicInsights(cards, question);
  const modelAvailable = Boolean(modelCredential(env, 'DEEPSEEK_DIRECT_API_KEY')
    || modelCredential(env, 'AI_GATEWAY_API_KEY')
    || modelCredential(env, 'VERCEL_OIDC_TOKEN')
    || modelCredential(env, 'VERCEL'));
  if (options.deterministicOnly === true || !modelAvailable) {
    return { insights: fallback, source: 'deterministic' };
  }
  const prompt = insightsPrompt(question, cards);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const completion = await completeDeepSeek({
        model: INSIGHT_MODEL,
        thinking: { type: 'disabled' },
        temperature: INSIGHT_TEMPERATURE,
        messages: [
          { role: 'system', content: prompt.system },
          {
            role: 'user',
            content: attempt === 0
              ? prompt.user
              : `${prompt.user}\nYour previous draft failed review. Follow every rule exactly: correct labels, word bands, at least three supplied cards named with positions, no verdicts, no timing.`,
          },
        ],
        max_tokens: INSIGHT_MAX_TOKENS,
      }, env, attempt === 0 ? 'sc7-insights' : 'sc7-insights-retry', {
        requestId: (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) || `sc7-${Date.now()}`,
        feature: 'free-preview',
        route: '/seven-card/free-reading',
        page: PAGE,
        readingId: payload.readingId || '',
        promptVersion: SEVEN_CARD_INSIGHTS_PROMPT_VERSION,
        turnIndex: attempt,
      });
      const raw = String(completion.text || '').replace(/```(?:json)?/gi, '').trim();
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start < 0 || end <= start) throw new Error('insights JSON missing');
      const parsed = JSON.parse(raw.slice(start, end + 1));
      const shaped = (Array.isArray(parsed) ? parsed : []).map((block, index) => ({
        n: `0${index + 1}`,
        label: clean(block && block.label, 60),
        lead: clean(block && block.lead, 160).replace(/[–—]/g, ','),
        body: clean(block && block.body, 480).replace(/[–—]/g, ','),
      }));
      const audit = auditInsights(shaped, cards);
      if (audit.ok) {
        structuredLog('info', {
          event: 'sc7_insights_served',
          readingId: payload.readingId || 'missing',
          source: attempt === 0 ? 'model_initial' : 'model_retry',
          promptVersion: SEVEN_CARD_INSIGHTS_PROMPT_VERSION,
        });
        return { insights: shaped, source: attempt === 0 ? 'model_initial' : 'model_retry' };
      }
      structuredLog('info', {
        event: 'sc7_insights_rejected',
        attempt,
        reason: audit.reason,
        readingId: payload.readingId || 'missing',
      });
    } catch (error) {
      structuredLog('warn', {
        event: 'sc7_insights_error',
        attempt,
        message: clean(error && error.message, 200),
        readingId: payload.readingId || 'missing',
      });
    }
  }
  structuredLog('warn', {
    event: 'sc7_insights_fallback',
    readingId: payload.readingId || 'missing',
  });
  return { insights: fallback, source: 'deterministic_fallback' };
}

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------
async function handleFreeReading(request, env) {
  const body = await readJsonBody(request);
  if (!body || typeof body !== 'object') {
    return cors(json({ error: 'invalid_request' }, 422), request);
  }
  // Pin the page identity: the legacy pipeline verifies evidence against these
  // exact values at intent time, so the page cannot drift them.
  const pinned = {
    ...body,
    type: TYPE,
    tool: PAGE,
    spread: SPREAD,
    presentationVariant: PRESENTATION_VARIANT,
    snapshotVersion: SNAPSHOT_VERSION,
    funnelVersion: SHARED_FUNNEL_VERSION,
    scope: SCOPE,
    confidence: CONFIDENCE,
    focus: 'Seven-card Horseshoe overview',
  };
  const forwarded = new Request(new URL('/free-reading', request.url), {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(pinned),
  });
  const upstream = await legacyWorker.fetch(forwarded, env);
  let data = null;
  try {
    data = await upstream.clone().json();
  } catch (_) {
    return upstream;
  }
  if (!upstream.ok || !data || typeof data !== 'object') return upstream;
  const cards = parseSevenCards(pinned.signals);
  if (cards) {
    const { insights, source } = await generateInsights({
      question: pinned.question,
      cards,
      readingId: pinned.readingId,
    }, env);
    data.insights = insights;
    data.insightsSource = source;
    data.insightsPromptVersion = SEVEN_CARD_INSIGHTS_PROMPT_VERSION;
  }
  data.funnelModule = SEVEN_CARD_FUNNEL_VERSION;
  return cors(json(data, upstream.status), request);
}

const sevenCardFunnel = {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request);
    if (!allowedStorefrontOrigin(request)) {
      return cors(json({ error: 'origin_not_allowed' }, 403), request);
    }
    if (path === '/free-reading' && request.method === 'POST') {
      return handleFreeReading(request, env);
    }
    if (path === '/health' && request.method === 'GET') {
      return cors(json({
        ok: true,
        module: SEVEN_CARD_FUNNEL_VERSION,
        insightsPromptVersion: SEVEN_CARD_INSIGHTS_PROMPT_VERSION,
      }), request);
    }
    return cors(json({ error: 'not_found' }, 404), request);
  },
};

export default sevenCardFunnel;
