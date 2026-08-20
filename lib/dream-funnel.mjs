// Dedicated dream funnel for the Dream Interpreter V2 page (/api/dream/*).
//
// Architecture contract: this module stays small (well under 2000 lines) and
// imports the shared kernel (DeepSeek client, entitlement budgets, CORS/JSON
// helpers, logging) from legacy-worker exports instead of duplicating it.
// Everything dream-page-specific (theme detection, prompt, audits, the
// deterministic fallback engine ported from the approved page design) lives
// here so the page can evolve without touching the monolith. The raw dream
// text is used only to build this response and is never logged.
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
import { questionLanguage } from './free-tarot-funnel.mjs';

export const DREAM_FUNNEL_VERSION = 'dream-interpreter-v2-2026-08';
export const DREAM_PROMPT_VERSION = 'dream-free-snapshot-v1';
const DREAM_MODEL = 'deepseek-v4-flash';

export const DREAM_EMOTIONS = new Set(['Anxious', 'Afraid', 'Sad', 'Calm', 'Confused', 'Relieved', 'Curious', 'Other']);
export const DREAM_RECURRENCES = new Set(['First time', 'Similar before', 'Recurring']);

// ---------------------------------------------------------------------------
// Design engine (deterministic truth + fallback). Ported verbatim from the
// approved page design so a degraded response is indistinguishable from the
// page's own first paint.
// ---------------------------------------------------------------------------
const SYMBOLS = [
  { name: 'Water', re: /(water|ocean|sea|river|flood|wave|swim|rain|drown)/ },
  { name: 'Snake', re: /(snake|serpent|cobra|python)/ },
  { name: 'Teeth falling out', re: /(teeth|tooth)/ },
  { name: 'Falling', re: /(falling|fell|cliff|edge of)/ },
  { name: 'Being chased', re: /(chas|running from|pursu|following me)/ },
  { name: 'An ex-partner', re: /(\bex\b|ex-|former partner|used to be close|old boyfriend|old girlfriend)/ },
  { name: 'Cheating', re: /(cheat|affair|unfaithful|betray)/ },
  { name: 'A house with unknown rooms', re: /(house|home|hallway|room|apartment|attic|basement)/ },
  { name: 'A baby', re: /(baby|infant|newborn|pregnan)/ },
  { name: 'Death', re: /(death|died|dying|dead|funeral|grave)/ },
  { name: 'Someone who passed away', re: /(passed away|who died|no longer alive|visited me)/ },
  { name: 'Late or unprepared', re: /(late|exam|test|missed the|unprepared|forgot)/ },
  { name: 'Flying', re: /(flying|flew|floating|floated)/ },
  { name: 'Fire', re: /(fire|burning|flame|smoke)/ },
  { name: 'A vehicle you cannot steer', re: /(driving|the car|brakes|train|bus|steer)/ },
  { name: 'A faceless stranger', re: /(stranger|faceless|shadow figure|someone i did not know)/ },
  { name: 'A door that will not open', re: /(door|locked|key|gate)/ },
  { name: 'Losing something', re: /(lost|losing|missing|gone|disappear)/ },
];
const THEMES = {
  change: { label: 'Change & Uncertainty', rel: 'a transition you are already inside, being checked rather than chosen',
    meaning: 'This dream is less about the objects in it than about a change you are already inside. It shows movement that started without your permission, and a part of you testing whether the ground will hold.',
    question: 'What has already changed that you are still planning around as if it had not?' },
  attachment: { label: 'Attachment & Unfinished Feeling', rel: 'a feeling attached to a person, rather than the person themselves',
    meaning: 'Someone appearing this vividly usually stands for the feeling attached to them, not for what they are doing right now. The dream is working on something that was left open, and it chose the clearest face it had.',
    question: 'What would you want to hear from them, and what would change if you never heard it?' },
  pressure: { label: 'Pressure & Control', rel: 'something being managed rather than resolved',
    meaning: 'The urgency is doing the talking here. Chase, height and time-pressure images tend to arrive when something in waking life is being handled rather than settled, and the dream keeps rehearsing the part you cannot control.',
    question: 'What are you carrying alone that you have not asked anyone to help you carry?' },
  loss: { label: 'Loss & Connection', rel: 'a bond that is still active in memory, surfacing around a decision or a date',
    meaning: 'Dreams that return someone who is gone usually arrive around anniversaries, decisions or turning points, when the part of you they represent is needed again. This is contact with your own memory of them, not a message from them.',
    question: 'What did they represent for you that you are currently living without?' },
  identity: { label: 'Identity & Self-Worth', rel: 'the gap between how you are seen and how you feel',
    meaning: 'Body, exposure and appearance images point to how you believe you are being read by other people. The dream is measuring the distance between the version of you that is visible and the one you are actually carrying.',
    question: 'Whose judgment were you imagining in the dream, and how current is it?' },
};
const CENTERS = {
  Anxious: 'Anxiety is the loudest signal here. It usually marks the point where you are anticipating an outcome you cannot yet influence, which is exactly why the dream keeps rehearsing it.',
  Afraid: 'Fear in a dream is rarely about the threat on screen. It marks where your sense of safety is thinner than usual at the moment.',
  Sad: 'The sadness is already interpreting for you. It places this dream closer to grief or missing than to warning.',
  Calm: 'Calm inside an unusual scene is significant. It often means the change the dream is showing you has already been accepted somewhere underneath.',
  Confused: 'Confusion usually means two true things are competing. The dream did not fail to make sense; it declined to choose for you.',
  Relieved: 'Relief at the end points to something you have been bracing for that may be less fixed than it feels.',
  Curious: 'Curiosity rather than fear suggests an exploratory dream: something is being tried on, not warned about.',
  Other: 'The feeling you were left with matters more than the images. It is the part of the dream that kept going after you woke.',
};

export function detectSymbols(dream) {
  const t = String(dream || '').toLowerCase();
  return SYMBOLS.filter((x) => x.re.test(t)).slice(0, 3).map((x) => x.name);
}

export function detectTheme(dream, emotion) {
  const t = String(dream || '').toLowerCase();
  if (/(passed away|funeral|who died|no longer alive|grave)/.test(t)) return 'loss';
  if (/(\bex\b|ex-|used to be close|cheat|affair|partner|husband|wife|boyfriend|girlfriend)/.test(t)) return 'attachment';
  if (/(chas|running from|falling|fell|late|exam|teeth|tooth|trapped|could not|couldn.t)/.test(t)) return 'pressure';
  if (/(naked|mirror|stage|audience|laughing at)/.test(t)) return 'identity';
  if (/(water|flood|house|hallway|door|road|moving|travel|train|fire)/.test(t)) return 'change';
  if (emotion === 'Sad') return 'loss';
  if (emotion === 'Anxious' || emotion === 'Afraid') return 'pressure';
  return 'change';
}

export function deterministicSnapshot(payload) {
  const themeId = detectTheme(payload.dream, payload.emotion);
  const theme = THEMES[themeId];
  const symbols = detectSymbols(payload.dream);
  const t = payload.dream.toLowerCase();
  let symbolRelationship;
  if (symbols.length >= 2) {
    symbolRelationship = `Read separately, ${symbols[0].toLowerCase()} and ${symbols[1].toLowerCase()} mean very little. Read together, one inside the setting of the other, they describe ${theme.rel}.`;
  } else if (symbols.length === 1) {
    symbolRelationship = `${symbols[0]} is the strongest image you described, but its meaning comes from where it appeared and what you did next, not from the symbol itself.`;
  } else {
    symbolRelationship = 'You described a situation more than an object. That is usable: the setting, the people in it and the ending carry the meaning here.';
  }
  let endingMeaning;
  if (/(woke|wake up|before i)/.test(t)) endingMeaning = 'You woke before the scene resolved. An unfinished ending usually means the question is still open in waking life, not that the answer is bad.';
  else if (/(escaped|got out|found the|made it|opened it)/.test(t)) endingMeaning = 'The dream resolved on your action rather than on rescue. That ending shifts the reading from threat toward capability.';
  else if (/(stuck|trapped|could not|couldn.t|never)/.test(t)) endingMeaning = 'The dream ended on the block rather than past it. That is the part worth reading closely, because it points at what is still being avoided while awake.';
  else endingMeaning = 'How the dream ended sets its meaning. The final image is usually closer to the message than the most dramatic scene.';
  return {
    theme: theme.label,
    clearestMeaning: theme.meaning,
    emotionalCenter: CENTERS[payload.emotion] || CENTERS.Other,
    symbolRelationship,
    endingMeaning,
    sittingQuestion: theme.question,
  };
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------
function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function parseDreamPayload(body) {
  const dream = clean(body && body.dream, 2800);
  const wordCount = dream.split(/\s+/).filter(Boolean).length;
  if (wordCount < 4) return { ok: false, reason: 'dream must contain at least a few words' };
  if (wordCount > 420) return { ok: false, reason: 'dream is over the 400 word limit' };
  const emotion = DREAM_EMOTIONS.has(body && body.emotion) ? body.emotion : 'Other';
  const recurrence = DREAM_RECURRENCES.has(body && body.recurrence) ? body.recurrence : 'First time';
  const visitorId = clean(body && body.visitorId, 80);
  const readingId = clean(body && body.readingId, 80) || `di-${Date.now().toString(36)}`;
  return { ok: true, dream, wordCount, emotion, recurrence, visitorId, readingId, language: questionLanguage(dream) };
}

// ---------------------------------------------------------------------------
// LLM path
// ---------------------------------------------------------------------------
const THEME_LABELS = Object.values(THEMES).map((t) => t.label);

function systemPrompt() {
  return 'You are the interpreter behind Deckaura\'s dream page: grounded, plain-spoken and psychologically literate, never mystical theatre and never clinical. ' +
    'You write a FREE dream snapshot from the customer\'s own dream text. Work only with what they wrote; never invent dream details they did not describe. ' +
    'Never predict the future, never diagnose, never claim to know what another person thinks, feels or did, and never present a symbol dictionary meaning as a fact about their life. ' +
    'The free snapshot names the pattern only. Why this dream appeared now, the waking-life trigger, alternative readings and next steps stay reserved for the written reading, so do not state or imply them. ' +
    'Return ONLY strict JSON with keys theme, clearestMeaning, emotionalCenter, symbolRelationship, endingMeaning, sittingQuestion. No markdown, no code fences, no extra keys, no em or en dashes anywhere.';
}

function userPrompt(payload) {
  const symbols = detectSymbols(payload.dream);
  return `DREAM TEXT (customer's own words): "${payload.dream}"\n` +
    `FEELING ON WAKING: ${payload.emotion}\nRECURRENCE: ${payload.recurrence}\n` +
    (symbols.length ? `PRE-DETECTED SYMBOL CANDIDATES (use only those actually present): ${symbols.join(', ')}\n` : '') +
    `\nWrite six fields, in the language of the dream text (language code: ${payload.language}):\n` +
    `1. theme: choose the single best fit from exactly this list and return it verbatim in English: ${THEME_LABELS.join(' | ')}.\n` +
    '2. clearestMeaning: 30 to 60 words, 2 sentences. The single clearest reading of THIS dream, anchored to at least one concrete detail the customer actually wrote. Present tense, second person, no advice.\n' +
    '3. emotionalCenter: 20 to 45 words on what their stated feeling is doing in this dream, tied to a moment from their text.\n' +
    '4. symbolRelationship: 20 to 50 words reading their strongest images TOGETHER with the setting, naming the images with the customer\'s own words.\n' +
    '5. endingMeaning: 20 to 50 words on what their specific ending changes about the reading.\n' +
    '6. sittingQuestion: one open reflective question, 10 to 26 words, ending with a question mark, specific to their dream. Not yes/no.\n' +
    'Every field is plain text. JSON only.';
}

const FORBIDDEN_FREE = /\b(?:will definitely|guarantee[ds]?|i predict|going to (?:die|happen|leave you)|(?:he|she|they) (?:feels?|thinks?|wants?|misses|loves?|is cheating) |diagnos|disorder|therapy you need)/i;
const DASHES = /[–—]/;

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function auditSnapshot(result, payload) {
  if (!result || typeof result !== 'object') return 'no result object';
  const fields = {
    theme: result.theme,
    clearestMeaning: result.clearestMeaning,
    emotionalCenter: result.emotionalCenter,
    symbolRelationship: result.symbolRelationship,
    endingMeaning: result.endingMeaning,
    sittingQuestion: result.sittingQuestion,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || !value.trim()) return `${key} missing`;
    if (DASHES.test(value)) return `${key} used an em or en dash`;
    if (FORBIDDEN_FREE.test(value)) return `${key} leaked a prediction, diagnosis or private-state claim`;
  }
  if (!THEME_LABELS.includes(result.theme)) return 'theme outside the canonical list';
  const cm = wordCount(result.clearestMeaning);
  if (cm < 24 || cm > 72) return `clearestMeaning word count ${cm} outside 24-72`;
  const ec = wordCount(result.emotionalCenter);
  if (ec < 14 || ec > 55) return `emotionalCenter word count ${ec} outside 14-55`;
  const sr = wordCount(result.symbolRelationship);
  if (sr < 14 || sr > 60) return `symbolRelationship word count ${sr} outside 14-60`;
  const em = wordCount(result.endingMeaning);
  if (em < 14 || em > 60) return `endingMeaning word count ${em} outside 14-60`;
  const sq = wordCount(result.sittingQuestion);
  if (sq < 8 || sq > 30 || !/\?\s*$/.test(result.sittingQuestion)) return 'sittingQuestion outside contract';
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

async function generateSnapshot(payload, env) {
  const usage = {
    requestId: (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) || `di_${Date.now()}`,
    feature: 'dream-free-snapshot',
    route: '/dream/free-interpretation',
    readingId: payload.readingId,
    promptVersion: DREAM_PROMPT_VERSION,
  };
  const request = {
    model: DREAM_MODEL,
    thinking: { type: 'disabled' },
    temperature: 0.6,
    max_tokens: 620,
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
    const completion = await completeDeepSeek(body, env, attempt === 0 ? 'dream-free-snapshot' : 'dream-free-snapshot-retry', usage);
    const parsed = extractJson(completion.text);
    const candidate = parsed && {
      theme: clean(parsed.theme, 60),
      clearestMeaning: clean(parsed.clearestMeaning, 620),
      emotionalCenter: clean(parsed.emotionalCenter, 480),
      symbolRelationship: clean(parsed.symbolRelationship, 520),
      endingMeaning: clean(parsed.endingMeaning, 520),
      sittingQuestion: clean(parsed.sittingQuestion, 260),
    };
    const reason = auditSnapshot(candidate, payload);
    if (!reason) {
      return { ...candidate, servedModel: DREAM_MODEL, servedSource: attempt === 0 ? 'model_initial' : 'model_retry' };
    }
    lastReason = reason;
    structuredLog('info', { event: 'dream_snapshot_rejected', attempt, reason, readingId: payload.readingId });
  }
  const error = new Error(lastReason || 'model unavailable');
  error.code = 'DREAM_MODEL_REJECTED';
  throw error;
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------
async function handleFreeInterpretation(request, env) {
  let body;
  try {
    body = await readJsonBody(request, 32 * 1024);
  } catch (_) {
    return cors(json({ error: 'invalid_json' }, 400), request);
  }
  const payload = parseDreamPayload(body);
  if (!payload.ok) return cors(json({ error: 'invalid_dream', reason: payload.reason }, 422), request);

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
      result = await generateSnapshot(payload, env);
    } catch (error) {
      degraded = true;
      structuredLog('warn', {
        event: 'dream_snapshot_fallback',
        readingId: payload.readingId,
        reason: clean(error && (error.code || error.message), 120) || 'model_error',
      });
    }
  } else {
    degraded = true;
  }
  if (!result) {
    result = { ...deterministicSnapshot(payload), servedModel: 'deterministic', servedSource: 'deterministic_design_engine' };
  }

  try {
    await settleFreePreview(env, claim, 'commit-preview');
  } catch (_) {
    // A settle failure must never block the served snapshot.
  }

  structuredLog('info', {
    event: 'dream_snapshot_served',
    readingId: payload.readingId,
    emotion: payload.emotion,
    recurrence: payload.recurrence,
    dreamWords: payload.wordCount,
    language: payload.language,
    servedSource: result.servedSource,
    degraded,
  });

  return cors(json({
    readingId: payload.readingId,
    funnelVersion: DREAM_FUNNEL_VERSION,
    promptVersion: DREAM_PROMPT_VERSION,
    theme: result.theme,
    clearestMeaning: result.clearestMeaning,
    emotionalCenter: result.emotionalCenter,
    symbolRelationship: result.symbolRelationship,
    endingMeaning: result.endingMeaning,
    sittingQuestion: result.sittingQuestion,
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
    if (path === '/free-interpretation' && request.method === 'POST') return handleFreeInterpretation(request, env);
    if (path === '/health' && request.method === 'GET') {
      return cors(json({ ok: true, funnel: DREAM_FUNNEL_VERSION }), request);
    }
    return cors(json({ error: 'not_found' }, 404), request);
  },
};
