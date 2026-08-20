// Dedicated free-tarot V2 funnel (/api/free-tarot/*) for the redesigned
// /pages/free-tarot-reading.
//
// Architecture contract: small page-owned module (rune-funnel pattern).
// The V2 page draws and picks cards client side from the shared 78-card
// deck; this module validates the pick against the design's spreads,
// claims the shared free-preview entitlement, asks deepseek-v4-flash for
// a short audited conditional ANSWER plus a two-sentence synthesis, and
// falls back to the design's deterministic composition instead of ever
// erroring. Checkout runs on the proven shared rail (page added to the
// shared-tool manifest as type "Tarot").
import {
  TAROT_CARD_NAMES,
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

export const FT_FUNNEL_VERSION = 'free-tarot-v2-2026-08';
export const FT_PROMPT_VERSION = 'ft-answer-v1';
const MODEL = 'deepseek-v4-flash';

export const SPREADS = {
  three: ['Situation', 'Hidden influence', 'Best next step'],
  decision: ['If you act', 'If you wait', 'What decides it'],
  love: ['You', 'Them', 'Between you', 'What is hidden', 'Where it moves'],
  timing: ['Where it stands', 'What is holding it', 'Pace of movement'],
  yesno: ['The signal'],
  celtic: ['Situation', 'Challenge', 'Root', 'Recent past', 'Possible outcome', 'Near future', 'Your stance', 'Outside influence', 'Hope or fear', 'Direction'],
};

const CARD_NAME_SET = new Set(TAROT_CARD_NAMES.map((name) => name.toLowerCase()));

function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}
function wordCount(value) {
  return String(value || '').split(/\s+/).filter(Boolean).length;
}

export function parsePick(body) {
  const spread = SPREADS[body && body.spread] ? body.spread : null;
  if (!spread) return { ok: false, reason: 'unknown spread' };
  const positions = SPREADS[spread];
  const raw = Array.isArray(body && body.cards) ? body.cards : [];
  if (raw.length !== positions.length) {
    return { ok: false, reason: `cards must contain exactly ${positions.length} entries for the ${spread} spread` };
  }
  const seen = new Set();
  const cards = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i] || {};
    const name = clean(entry.name, 60);
    if (!CARD_NAME_SET.has(name.toLowerCase())) return { ok: false, reason: `unknown card at position ${i + 1}` };
    if (seen.has(name.toLowerCase())) return { ok: false, reason: `duplicate card ${name}` };
    seen.add(name.toLowerCase());
    cards.push({ position: positions[i], name, reversed: entry.orientation === 'reversed' });
  }
  const question = clean(body && body.question, 240);
  if (question.length < 4) return { ok: false, reason: 'question too short' };
  const visitorId = clean(body && body.visitorId, 80);
  const readingId = clean(body && body.readingId, 80) || `ft-${Date.now().toString(36)}`;
  const category = clean(body && body.category, 20) || 'other';
  return { ok: true, spread, cards, question, visitorId, readingId, category };
}

// ---------------------------------------------------------------------------
// Deterministic fallback — the design's own composition, never an error box.
// ---------------------------------------------------------------------------
export function questionIsTurkish(question) {
  const q = String(question || '');
  return /[çğıöşüÇĞİÖŞÜ]/.test(q)
    || /(?:mi|m[ıi]|mu|m[uü]|acaba|neden|nas[ıi]l|olacak|d[oö]necek|sever|bitti|kalmal[ıi]|ayr[ıi]lmal[ıi])/i.test(q);
}

export function deterministicAnswer(cards, question) {
  const revCount = cards.filter((card) => card.reversed).length;
  const first = cards[0];
  const last = cards[cards.length - 1];
  const tr = questionIsTurkish(question);
  const face = (card) => `${card.name}${card.reversed ? (tr ? ' ters' : ' reversed') : ''}`;
  if (tr) {
    if (revCount === 0) {
      return `Açılım açık yönde eğilim gösteriyor: ${face(first)} durumun bugünkü zeminini, ${face(last)} ise ileriye çeken gücü anlatıyor; tarif ettiği yön şu an erişilebilir.`;
    }
    if (revCount >= Math.ceil(cards.length / 2)) {
      return `Açılım yavaşlamaya işaret ediyor: ${face(last)} bir duraklama istiyor, ${face(first)} ise karar öncesi mevcut düzenin neden oturması gerektiğini gösteriyor.`;
    }
    return `Eğilim koşullu: hareket mümkün, ama ${face(cards.find((card) => card.reversed) || first)} önce değişmesi gereken tek şeyi işaret ediyor; ${face(last)} ancak ondan sonra yönü taşıyabilir.`;
  }
  if (revCount === 0) {
    return `The spread leans open: ${face(first)} sets where this stands, and ${face(last)} carries the pull forward, so the direction it describes is available now.`;
  }
  if (revCount >= Math.ceil(cards.length / 2)) {
    return `The spread leans slowed: ${face(last)} asks for a pause, and ${face(first)} shows why the current pattern needs settling before a decisive move.`;
  }
  return `The lean is conditional: movement is possible, but ${face(cards.find((card) => card.reversed) || first)} marks the one thing that has to shift before ${face(last)} can carry this forward.`;
}

const FORBIDDEN_FREE = /\b(?:will (?:definitely|certainly|surely)|guaranteed?|i promise|(?:he|she|they) (?:loves?|misses?|wants?|is thinking))\b/i;
const DATE_CLAIM = /\b(?:on|by|before|after) (?:january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(?:ocak|[sş]ubat|mart|nisan|may[iı]s|haziran|temmuz|a[gğ]ustos|eyl[uü]l|ekim|kas[iı]m|aral[iı]k)[a-zçğıöşü']* (?:kadar|itibaren|sonunda|ba[sş][iı]nda|gelmeden)\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/iu;
const ANSWER_LEAN = /\b(?:yes|no|lean(?:s|ing)?|points?|suggests?|favou?rs?|likely|unlikely|depends|conditional|open|slowed|not yet|possible|evet|hay[iı]r|hen[uü]z|e[gğ]ilim|ba[gğ]l[iı]|ko[sş]ul|a[cç][iı]k|yava[sş]|olas[iı]|m[uü]mk[uü]n|d[oö]nebilir|g[oö]steriyor|i[sş]aret)\b/iu;

export function auditAnswer(text, cards) {
  const value = clean(text, 420);
  const words = wordCount(value);
  if (words < 14 || words > 50) return { ok: false, reason: `answer word count ${words} outside 14-50` };
  if (/[–—]/.test(value)) return { ok: false, reason: 'em or en dash in answer' };
  if (FORBIDDEN_FREE.test(value)) return { ok: false, reason: 'guarantee or private-state claim' };
  if (DATE_CLAIM.test(value)) return { ok: false, reason: 'timing promise' };
  if (!ANSWER_LEAN.test(value)) return { ok: false, reason: 'no bounded lean stated' };
  const suppliedLower = new Set(cards.map((card) => card.name.toLowerCase()));
  let named = 0;
  for (const name of TAROT_CARD_NAMES) {
    if (!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(value)) continue;
    if (!suppliedLower.has(name.toLowerCase())) return { ok: false, reason: `names ${name}, not in this spread` };
    named += 1;
  }
  if (named < 1) return { ok: false, reason: 'names none of the supplied cards' };
  return { ok: true };
}

function prompt(question, spread, cards, category) {
  const castLine = cards.map((card) => `${card.position}: ${card.name}${card.reversed ? ' reversed' : ''}`).join('; ');
  const system = [
    'You write the free short answer for a tarot draw on Deckaura.',
    'Grounded, plain-spoken, non-mystical. No em or en dashes.',
    'Return STRICT JSON: {"answer": string}.',
    '- answer: 16 to 44 words. A direct, CONDITIONAL answer to the exact question: state the lean (yes / no / not yet / open / slowed / depends on one condition) and name at least one supplied card with its position.',
    '- Use ONLY the supplied cards. Never guarantee, never give dates, never claim another person\'s private feelings.',
    '- Answer in the language of the question.',
  ].join('\n');
  const user = `Exact question: "${question}"\nCategory: ${category}\nSpread (${spread}): ${castLine}\nReturn the JSON object only.`;
  return { system, user };
}

export async function generateAnswer(payload, env, options = {}) {
  const fallback = deterministicAnswer(payload.cards, payload.question);
  const modelAvailable = Boolean(modelCredential(env, 'DEEPSEEK_DIRECT_API_KEY')
    || modelCredential(env, 'AI_GATEWAY_API_KEY')
    || modelCredential(env, 'VERCEL_OIDC_TOKEN')
    || modelCredential(env, 'VERCEL'));
  if (options.deterministicOnly === true || !modelAvailable) {
    return { answer: fallback, source: 'deterministic' };
  }
  const p = prompt(payload.question, payload.spread, payload.cards, payload.category);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const completion = await completeDeepSeek({
        model: MODEL,
        thinking: { type: 'disabled' },
        temperature: 0.5,
        messages: [
          { role: 'system', content: p.system },
          {
            role: 'user',
            content: attempt === 0 ? p.user
              : `${p.user}\nYour previous draft failed review. Follow every rule: 16-44 words, bounded lean, at least one supplied card named with its position, no guarantees, no dates.`,
          },
        ],
        max_tokens: 160,
      }, env, attempt === 0 ? 'ft-answer' : 'ft-answer-retry', {
        requestId: (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) || `ft-${Date.now()}`,
        feature: 'free-preview',
        route: '/free-tarot/answer',
        page: '/pages/free-tarot-reading',
        readingId: payload.readingId || '',
        promptVersion: FT_PROMPT_VERSION,
        turnIndex: attempt,
      });
      const raw = String(completion.text || '').replace(/```(?:json)?/gi, '').trim();
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end <= start) throw new Error('answer JSON missing');
      const parsed = JSON.parse(raw.slice(start, end + 1));
      const answer = clean(parsed && parsed.answer, 420).replace(/[–—]/g, ',');
      const audit = auditAnswer(answer, payload.cards);
      if (audit.ok) {
        structuredLog('info', {
          event: 'ft_answer_served',
          readingId: payload.readingId || 'missing',
          source: attempt === 0 ? 'model_initial' : 'model_retry',
          promptVersion: FT_PROMPT_VERSION,
        });
        return { answer, source: attempt === 0 ? 'model_initial' : 'model_retry' };
      }
      structuredLog('info', { event: 'ft_answer_rejected', attempt, reason: audit.reason, readingId: payload.readingId || 'missing' });
    } catch (error) {
      structuredLog('warn', { event: 'ft_answer_error', attempt, message: clean(error && error.message, 200), readingId: payload.readingId || 'missing' });
    }
  }
  structuredLog('warn', { event: 'ft_answer_fallback', readingId: payload.readingId || 'missing' });
  return { answer: fallback, source: 'deterministic_fallback' };
}

async function handleAnswer(request, env) {
  const body = await readJsonBody(request);
  const parsed = parsePick(body || {});
  if (!parsed.ok) return cors(json({ error: 'invalid_request', reason: parsed.reason }, 422), request);
  const claim = await claimFreePreview(request, { ...body, visitorId: parsed.visitorId, question: parsed.question }, env);
  if (!claim.allowed) {
    return cors(json({
      error: 'free_limit',
      freeReadings: { used: claim.used, cap: claim.cap, remaining: claim.remaining, nextAt: claim.nextAt },
    }, 429), request);
  }
  const { answer, source } = await generateAnswer(parsed, env);
  try { await settleFreePreview(env, claim, 'commit-preview'); } catch (_) {}
  return cors(json({
    answer,
    servedSource: source,
    promptVersion: FT_PROMPT_VERSION,
    funnelModule: FT_FUNNEL_VERSION,
    readingId: parsed.readingId,
    freeReadings: { used: claim.used, cap: claim.cap, remaining: claim.remaining, nextAt: claim.nextAt },
  }, 200), request);
}

const freeTarotFunnel = {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request);
    if (!allowedStorefrontOrigin(request)) {
      return cors(json({ error: 'origin_not_allowed' }, 403), request);
    }
    if (path === '/answer' && request.method === 'POST') return handleAnswer(request, env);
    if (path === '/health' && request.method === 'GET') {
      return cors(json({ ok: true, module: FT_FUNNEL_VERSION, promptVersion: FT_PROMPT_VERSION }), request);
    }
    return cors(json({ error: 'not_found' }, 404), request);
  },
};

export default freeTarotFunnel;
