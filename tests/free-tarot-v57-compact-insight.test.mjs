import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FREE_TAROT_COMPACT_MAX_WORDS,
  FREE_TAROT_COMPACT_MIN_WORDS,
  FREE_TAROT_COMPACT_PRESENTATION_VARIANT,
  FREE_TAROT_COMPACT_PROMPT_VERSION,
  auditFreeTarotCompactInsight,
  compactInsightWordCount,
  deterministicFreeTarotCompactInsight,
  isFreeTarotCompactV57,
} from '../lib/free-tarot-compact-insight.mjs';
import { FREE_TAROT_FUNNEL_VERSIONS } from '../lib/free-tarot-payment-contract.mjs';
import {
  TAROT_CARD_NAMES,
  canonicalFunnelMetadata,
  generateFreeTarotCompactInsight,
  handleFreeReading,
  handleFreeSession,
  paidQuestionDomain,
  paidReadingContinuityContract,
  paidSemanticReviewContract,
  privacySafeLogRecord,
  readingCuriosityQuestion,
} from '../lib/legacy-worker.mjs';

const FUNNEL_V57 = 'premium-choice-2026-08-v57';
const PAGE = '/pages/free-tarot-reading';
const VISITOR_ID = 'compact_insight_visitor_20260816';
const REQUEST_HEADERS = Object.freeze({
  Origin: 'https://deckaura.com',
  'Content-Type': 'application/json; charset=utf-8',
  'CF-Connecting-IP': '203.0.113.157',
  'User-Agent': 'Deckaura compact insight contract test',
  'Accept-Language': 'en-US,en;q=0.9',
});

function jsonKv() {
  const values = new Map();
  return {
    values,
    binding: {
      get: async (key, type) => {
        const value = values.get(key);
        if (value == null) return null;
        if (type === 'json' && typeof value === 'string') return JSON.parse(value);
        return value;
      },
      put: async (key, value) => values.set(key, value),
      delete: async (key) => values.delete(key),
    },
  };
}

function rollingBudget({ limit = 3 } = {}) {
  let claims = 0;
  let commits = 0;
  let releases = 0;
  return {
    get claims() { return claims; },
    get commits() { return commits; },
    get releases() { return releases; },
    binding: {
      claim: async () => {
        claims += 1;
        if (claims > limit) {
          return {
            allowed: false,
            reason: 'visitor_rate_limit',
            cap: limit,
            used: limit,
            remaining: 0,
            nextAt: Date.now() + 60 * 60 * 1000,
          };
        }
        return {
          allowed: true,
          cap: limit,
          used: claims - 1,
          remaining: Math.max(0, limit - claims),
          nextAt: Date.now() + 24 * 60 * 60 * 1000,
        };
      },
      settle: async (_claimId, consume) => {
        if (consume) commits += 1;
        else releases += 1;
        return { allowed: true };
      },
    },
  };
}

function workerEnv(kv, budget, overrides = {}) {
  return {
    ENTITLEMENT_PEPPER: 'test-only-entitlement-pepper',
    READINGS_CACHE: kv.binding,
    FREE_READING_BUDGETS: budget.binding,
    FREE_ENTITLEMENTS: {
      getByName: () => ({
        fetch: async () => new Response(JSON.stringify({ allowed: true, used: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      }),
    },
    ...overrides,
  };
}

function aiBudget() {
  return {
    claim: async ({ claimId }) => ({ allowed: true, claimId }),
    settle: async () => ({ allowed: true }),
  };
}

function readingBody(question = 'What should I understand before changing careers?', readingId = 'compact_reading_01') {
  return {
    visitorId: VISITOR_ID,
    readingId,
    question,
    requestedLocale: 'en-US',
    locale: 'en-US',
    type: 'Three Card Tarot',
    tool: PAGE,
    spread: 'Three Card',
    context: 'Spread: Three Card. Past: Two of Wands upright. Present: Nine of Wands upright. Future: Eight of Wands reversed.',
    signals: 'Past: Two of Wands Upright; Present: Nine of Wands Upright; Future: Eight of Wands Reversed',
    cards: 'Two of Wands, Nine of Wands, Eight of Wands',
    scope: '3-card Past, Present, Future spread for one focused question',
    confidence: 'Symbolic tarot direction, not a factual prediction',
    snapshotVersion: 'reading-snapshot-v2',
    funnelVersion: FUNNEL_V57,
  };
}

function readingRequest(body) {
  return new Request('https://reading.deckaura.com/free-reading', {
    method: 'POST',
    headers: REQUEST_HEADERS,
    body: JSON.stringify(body),
  });
}

function sessionRequest(kind = 'last-approved') {
  return new Request('https://reading.deckaura.com/free-session', {
    method: 'POST',
    headers: REQUEST_HEADERS,
    body: JSON.stringify({ visitorId: VISITOR_ID, kind }),
  });
}

function compactModelResponse(content) {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: compactInsightWordCount(content) },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function assertCareerCompactInsight(payload, exactQuestion) {
  const insight = String(payload.preview?.compactInsight || '');
  const wordCount = compactInsightWordCount(insight);
  assert.match(insight, /\b(?:work|career|professional)\b/i);
  assert.ok(wordCount >= FREE_TAROT_COMPACT_MIN_WORDS, `wordCount=${wordCount}: ${insight}`);
  assert.ok(wordCount <= FREE_TAROT_COMPACT_MAX_WORDS, `wordCount=${wordCount}: ${insight}`);
  assert.equal(insight.includes(exactQuestion), false);
  assert.doesNotMatch(insight, /\bemotional pressure\b.*\bemotional pressure\b/i);
  assert.doesNotMatch(insight, /\b(?:this question|future|outcome|timing|condition|next step|action|advice|yes|no|maybe|will|should|must)\b/i);
}

const LOCALE_FIXTURES = Object.freeze([
  Object.freeze({ locale: 'en', card: 'Wheel of Fortune reversed', question: 'What should I understand before changing careers?' }),
  Object.freeze({ locale: 'tr', card: 'Kader Çarkı (Ters)', question: 'Kariyer değiştirmeden önce neyi anlamalıyım?' }),
  Object.freeze({ locale: 'de', card: 'Rad des Schicksals (umgekehrt)', question: 'Was sollte ich vor einem Berufswechsel verstehen?' }),
  Object.freeze({ locale: 'es', card: 'La Rueda de la Fortuna (invertida)', question: '¿Qué debo comprender antes de cambiar de carrera?' }),
  Object.freeze({ locale: 'pt', card: 'A Roda da Fortuna (invertida)', question: 'O que devo compreender antes de mudar de carreira?' }),
]);

const CAREER_INFLECTION_FIXTURES = Object.freeze([
  Object.freeze({ locale: 'en', question: 'What should I understand before changing careers?', anchor: /\b(?:work|career|professional)\b/i }),
  Object.freeze({ locale: 'tr', question: 'Kariyerimde değişiklik yapmadan önce neyi anlamalıyım?', anchor: /(?:iş istikrarı|mesleki baskı)/i }),
  Object.freeze({ locale: 'de', question: 'Was sollte ich vor einem Berufswechsel verstehen?', anchor: /(?:beruflicher Stabilität|Leistungsdruck)/i }),
  Object.freeze({ locale: 'es', question: '¿Qué debo comprender sobre mis carreras profesionales?', anchor: /(?:estabilidad laboral|presión profesional)/i }),
  Object.freeze({ locale: 'pt', question: 'O que devo compreender sobre as minhas carreiras profissionais?', anchor: /(?:estabilidade profissional|pressão profissional)/i }),
]);

const COMPACT_DOMAINS = Object.freeze([
  'love',
  'career',
  'money',
  'timing',
  'self',
  'trust',
  'family',
  'education',
  'relocation',
  'creative',
  'legal',
  'health',
  'general',
]);

test('EN/TR/DE/ES/PT deterministic compact insights are localized, question-aware, and strictly 24-32 words', () => {
  const reservedWord = { en: 'future', tr: 'gelecek', de: 'Zukunft', es: 'futuro', pt: 'futuro' };
  const pressurePattern = {
    en: /emotional pressure/gi,
    tr: /duygusal baskı/gi,
    de: /Druck/gi,
    es: /presión/gi,
    pt: /pressão/gi,
  };
  for (const fixture of LOCALE_FIXTURES) {
    const contract = {
      locale: fixture.locale,
      domain: 'career',
      privateState: false,
      question: fixture.question,
      anchorCardLabel: fixture.card,
      anchorCardAliases: [fixture.card],
      reservedCardAliases: ['Eight of Wands'],
    };
    const insight = deterministicFreeTarotCompactInsight(contract);
    const audit = auditFreeTarotCompactInsight(insight, contract);
    assert.equal(audit.ok, true, `${fixture.locale}: ${audit.reason}: ${insight}`);
    assert.ok(audit.wordCount >= FREE_TAROT_COMPACT_MIN_WORDS, fixture.locale);
    assert.ok(audit.wordCount <= FREE_TAROT_COMPACT_MAX_WORDS, fixture.locale);
    assert.doesNotMatch(insight, /this question|bu soru|diese frage|esta pregunta|future|outcome|timing|next step/i);
    assert.equal(insight.includes(fixture.question), false, fixture.locale);
    const unsafe = insight.replace(/\.$/, ` ${reservedWord[fixture.locale]}.`);
    assert.equal(auditFreeTarotCompactInsight(unsafe, contract).ok, false, `${fixture.locale} reserved-content audit`);

    for (const domain of COMPACT_DOMAINS) {
      const domainContract = { ...contract, domain };
      const domainInsight = deterministicFreeTarotCompactInsight(domainContract);
      const domainAudit = auditFreeTarotCompactInsight(domainInsight, domainContract);
      assert.equal(domainAudit.ok, true, `${fixture.locale}/${domain}: ${domainAudit.reason}: ${domainInsight}`);
      assert.ok(
        (domainInsight.match(pressurePattern[fixture.locale]) || []).length <= 1,
        `${fixture.locale}/${domain}: ${domainInsight}`,
      );
    }
  }
});

test('the full v57 adapter keeps all 780 localized card/orientation fallbacks inside the strict contract', async () => {
  for (const fixture of LOCALE_FIXTURES) {
    for (const card of TAROT_CARD_NAMES) {
      for (const orientation of ['Upright', 'Reversed']) {
        const future = card === 'Eight of Wands' ? 'Seven of Cups' : 'Eight of Wands';
        const fields = {
          ...readingBody(fixture.question, `compact_locale_${fixture.locale}`),
          lang: fixture.locale,
          locale: fixture.locale,
          requestedLocale: fixture.locale,
          signals: `Past: ${card} ${orientation}; Present: Nine of Wands Upright; Future: ${future} Reversed`,
          cards: `${card}, Nine of Wands, ${future}`,
        };
        const insight = await generateFreeTarotCompactInsight(fields, {}, { deterministicOnly: true });
        const label = `${fixture.locale}/${card}/${orientation}`;
        assert.ok(insight, label);
        assert.ok(compactInsightWordCount(insight) >= FREE_TAROT_COMPACT_MIN_WORDS, label);
        assert.ok(compactInsightWordCount(insight) <= FREE_TAROT_COMPACT_MAX_WORDS, label);
        assert.equal(fields.freePreviewCompactInsightAuditStatus, 'passed', label);
        assert.equal(fields.freePreviewCompactInsightSource, 'deterministic_preview_recovery', label);
        assert.equal(fields.freePreviewPresentationVariant, FREE_TAROT_COMPACT_PRESENTATION_VARIANT, label);
      }
    }
  }
});

test('localized career plurals and inflections stay career-bound in free and paid domain contracts', async () => {
  for (const fixture of CAREER_INFLECTION_FIXTURES) {
    const fields = {
      ...readingBody(fixture.question, `compact_career_inflection_${fixture.locale}`),
      lang: fixture.locale,
      locale: fixture.locale,
      requestedLocale: fixture.locale,
    };
    const insight = await generateFreeTarotCompactInsight(fields, {}, { deterministicOnly: true });
    assert.match(insight, fixture.anchor, fixture.locale);
    assert.equal(paidQuestionDomain(fixture.question), 'career', fixture.locale);
  }
});

test('v57 serves one audited DeepSeek Flash compact insight while preserving internal preview and snapshot authority', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const compact = 'Two of Wands upright highlights how an earlier pattern around work stability, recognition, and professional pressure still shapes the emotional pressure you carry here, while leaving the wider picture unresolved.';
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, init = {}) => {
    requests.push(JSON.parse(String(init.body)));
    return compactModelResponse(compact);
  };

  const kv = jsonKv();
  const budget = rollingBudget();
  const env = workerEnv(kv, budget, {
    DEEPSEEK_DIRECT_API_KEY: 'test-only-deepseek-key',
    AI_BUDGETS: aiBudget(),
  });
  const body = readingBody();
  const response = await handleFreeReading(readingRequest(body), env);
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(requests.length, 1, 'the deterministic internal PPF preview must leave exactly one compact model call');
  assert.equal(requests[0].model, 'deepseek-v4-flash');
  assert.equal(requests[0].temperature, 0.1);
  assert.equal(requests[0].max_tokens, 80);
  assert.equal(requests[0].thinking?.type, 'disabled');
  assert.doesNotMatch(requests[0].messages[1].content, /Eight of Wands|Future:/i, 'later-card evidence must never reach the compact writer');
  assert.ok(payload.preview.html, 'the internal audited preview remains available for snapshot continuity');
  assert.equal(payload.preview.compactInsight, compact);
  assert.equal(payload.curiosityQuestion, '');
  assert.equal(payload.presentationVariant, FREE_TAROT_COMPACT_PRESENTATION_VARIANT);
  assert.equal(payload.compactInsightSource, 'deepseek_flash');
  assert.equal(payload.compactInsightAuditStatus, 'passed');
  assert.equal(payload.compactInsightPromptVersion, FREE_TAROT_COMPACT_PROMPT_VERSION);
  assert.equal(budget.commits, 1);

  const snapshotKey = `preview:${payload.token}`;
  const snapshot = JSON.parse(kv.values.get(snapshotKey));
  assert.ok(snapshot.teaserText, 'paid continuity keeps the existing internal preview text');
  assert.equal(snapshot.fields.compactInsight, compact);
  assert.equal(snapshot.fields.curiosityQuestion, '');
  assert.equal(snapshot.fields.presentationVariant, FREE_TAROT_COMPACT_PRESENTATION_VARIANT);

  const replayResponse = await handleFreeReading(readingRequest(body), env);
  const replay = await replayResponse.json();
  assert.equal(replayResponse.status, 200);
  assert.equal(replay.replayed, true);
  assert.equal(replay.preview.compactInsight, compact);
  assert.equal(replay.curiosityQuestion, '');
  assert.equal(requests.length, 1, 'server replay must not call the compact model again');

  const sessionResponse = await handleFreeSession(sessionRequest(), env);
  const session = await sessionResponse.json();
  assert.equal(sessionResponse.status, 200);
  assert.equal(session.session.preview.compactInsight, compact);
  assert.equal(session.session.curiosityQuestion, '');
});

test('v50-v56 remain schema-compatible and keep their existing curiosity contract', () => {
  const legacy = {
    funnelVersion: 'premium-choice-2026-08-v56',
    tool: PAGE,
    question: 'What should I understand before changing careers?',
    curiosityQuestion: 'What condition would make this career choice clearer?',
  };
  assert.equal(isFreeTarotCompactV57(legacy), false);
  assert.equal(readingCuriosityQuestion(legacy, 'en'), legacy.curiosityQuestion);
  assert.equal(isFreeTarotCompactV57({ ...legacy, funnelVersion: FUNNEL_V57 }), true);
  assert.equal(readingCuriosityQuestion({ ...legacy, funnelVersion: FUNNEL_V57 }, 'en'), '');
  assert.equal(isFreeTarotCompactV57({ ...legacy, funnelVersion: 'premium-choice-2026-08-v58' }), false, 'v58 remains outside the v57 presentation contract');
});

test('free reading accepts v50-v57, preserves missing legacy requests, and rejects supplied future or unknown funnels', async () => {
  for (const [index, funnelVersion] of FREE_TAROT_FUNNEL_VERSIONS.entries()) {
    const body = readingBody(undefined, `supported_funnel_${index}`);
    body.funnelVersion = funnelVersion;
    const response = await handleFreeReading(readingRequest(body), workerEnv(jsonKv(), rollingBudget()));
    assert.equal(response.status, 200, funnelVersion);
  }

  const legacyBody = readingBody(undefined, 'missing_funnel_legacy');
  delete legacyBody.funnelVersion;
  const legacyResponse = await handleFreeReading(readingRequest(legacyBody), workerEnv(jsonKv(), rollingBudget()));
  assert.equal(legacyResponse.status, 200);

  for (const [index, funnelVersion] of [
    'premium-choice-2026-08-v58',
    'premium-choice-2026-08-unknown',
  ].entries()) {
    const body = readingBody(undefined, `unsupported_funnel_${index}`);
    body.funnelVersion = funnelVersion;
    const budget = rollingBudget();
    const response = await handleFreeReading(readingRequest(body), workerEnv(jsonKv(), budget));
    const payload = await response.json();
    assert.equal(response.status, 422, funnelVersion);
    assert.equal(payload.reason, 'UNSUPPORTED_FUNNEL_VERSION');
    assert.deepEqual(payload.missing, ['funnelVersion']);
    assert.equal(budget.claims, 0, 'unsupported versions must fail before quota is reserved');
  }
});

test('compact provider 429 falls back locally and commits the free draw only after the snapshot is saved', async (t) => {
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => {
    modelCalls += 1;
    return new Response(JSON.stringify({ error: 'rate limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const kv = jsonKv();
  const budget = rollingBudget();
  const env = workerEnv(kv, budget, {
    DEEPSEEK_DIRECT_API_KEY: 'test-only-deepseek-key',
    AI_BUDGETS: aiBudget(),
  });
  const response = await handleFreeReading(readingRequest(readingBody(undefined, 'compact_429_01')), env);
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(modelCalls, 1);
  assert.equal(payload.compactInsightSource, 'deterministic_rate_limit_fallback');
  assert.equal(payload.compactInsightAuditStatus, 'passed_fallback');
  assert.ok(payload.preview.compactInsight);
  assert.equal(payload.curiosityQuestion, '');
  assert.equal(budget.commits, 1);
  assert.equal(budget.releases, 0);
});

test('a rejected compact response keeps the exact plural careers question in the career domain', async (t) => {
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  const rejected = 'Two of Wands upright highlights an earlier work pattern, then reveals the future outcome and exact timing, while telling you which career action should happen next for certain success.';
  globalThis.fetch = async () => {
    modelCalls += 1;
    return compactModelResponse(rejected);
  };

  const kv = jsonKv();
  const budget = rollingBudget();
  const env = workerEnv(kv, budget, {
    DEEPSEEK_DIRECT_API_KEY: 'test-only-deepseek-key',
    AI_BUDGETS: aiBudget(),
  });
  const exactQuestion = 'What should I understand before changing careers?';
  const response = await handleFreeReading(readingRequest(readingBody(
    exactQuestion,
    'compact_plural_careers_01',
  )), env);
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.question, exactQuestion);
  assert.equal(modelCalls, 1);
  assert.equal(payload.compactInsightSource, 'deterministic_audit_fallback');
  assertCareerCompactInsight(payload, exactQuestion);
  assert.doesNotMatch(payload.preview.compactInsight, /security, expectations, and emotional pressure/i);
});

test('compact model has one hard bounded timeout and then uses the localized deterministic fallback', async (t) => {
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, init = {}) => {
    modelCalls += 1;
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted by compact timeout test');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };

  const kv = jsonKv();
  const budget = rollingBudget();
  const env = workerEnv(kv, budget, {
    DEEPSEEK_DIRECT_API_KEY: 'test-only-deepseek-key',
    FREE_COMPACT_INSIGHT_MODEL_TIMEOUT_MS: 25,
    AI_BUDGETS: aiBudget(),
  });
  const startedAt = Date.now();
  const response = await handleFreeReading(readingRequest(readingBody(undefined, 'compact_timeout_01')), env);
  const elapsed = Date.now() - startedAt;
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(modelCalls, 1, 'timeout must not retry or switch providers');
  assert.ok(elapsed < 1000, `test timeout should recover promptly, elapsed=${elapsed}`);
  assert.equal(payload.compactInsightSource, 'deterministic_timeout_fallback');
  assertCareerCompactInsight(payload, 'What should I understand before changing careers?');
  assert.equal(budget.commits, 1);
});

test('quota 429 exposes no token, compact content, or curiosity promise but keeps the PII-free presentation variant', async () => {
  const kv = jsonKv();
  const budget = rollingBudget({ limit: 0 });
  const env = workerEnv(kv, budget);
  const response = await handleFreeReading(readingRequest(readingBody(undefined, 'compact_quota_429_01')), env);
  const payload = await response.json();

  assert.equal(response.status, 429, JSON.stringify(payload));
  assert.equal(payload.reason, 'visitor_rate_limit');
  assert.equal(payload.token, undefined);
  assert.equal(payload.preview, undefined);
  assert.equal(payload.curiosityQuestion, '');
  assert.equal(payload.presentationVariant, FREE_TAROT_COMPACT_PRESENTATION_VARIANT);
  assert.equal(budget.commits, 0);
});

test('safety response skips compact generation and never creates a paid curiosity promise', async (t) => {
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => {
    modelCalls += 1;
    throw new Error('safety response must not call a model');
  };

  const kv = jsonKv();
  const budget = rollingBudget();
  const env = workerEnv(kv, budget, {
    DEEPSEEK_DIRECT_API_KEY: 'test-only-deepseek-key',
    AI_BUDGETS: aiBudget(),
  });
  const response = await handleFreeReading(readingRequest(readingBody(
    'Do the cards prove that my cancer diagnosis is correct?',
    'compact_safety_01',
  )), env);
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.safety, true);
  assert.equal(payload.offerAllowed, false);
  assert.equal(payload.curiosityQuestion, '');
  assert.equal(payload.preview.compactInsight, undefined);
  assert.equal(modelCalls, 0);
  assert.equal(budget.commits, 1);
});

test('private-state claim is rejected by the strict audit and replaced with an epistemically safe compact insight', async (t) => {
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  const unsafe = 'Two of Wands upright shows Alex still loves you deeply and will return soon, bringing the honest commitment and emotional certainty you have patiently waited to receive.';
  globalThis.fetch = async () => {
    modelCalls += 1;
    return compactModelResponse(unsafe);
  };

  const kv = jsonKv();
  const budget = rollingBudget();
  const env = workerEnv(kv, budget, {
    DEEPSEEK_DIRECT_API_KEY: 'test-only-deepseek-key',
    AI_BUDGETS: aiBudget(),
  });
  const response = await handleFreeReading(readingRequest(readingBody(
    'Does Alex still love me and want to return?',
    'compact_private_state_01',
  )), env);
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(modelCalls, 1);
  assert.equal(payload.compactInsightSource, 'deterministic_audit_fallback');
  assert.equal(payload.compactInsightAuditStatus, 'passed_fallback');
  assert.match(payload.preview.compactInsight, /cannot verify another person's private feelings/i);
  assert.doesNotMatch(payload.preview.compactInsight, /Alex.*(?:loves|wants|will return)/i);
  assert.equal(payload.curiosityQuestion, '');
});

test('v57 paid continuity keeps the original exact question and disables the promised-question deliverable', () => {
  const exactQuestion = 'What should I understand before accepting this specific career offer?';
  const fields = {
    funnelVersion: FUNNEL_V57,
    tool: PAGE,
    question: exactQuestion,
    freeQuestion: exactQuestion,
    curiosityQuestion: readingCuriosityQuestion({
      funnelVersion: FUNNEL_V57,
      tool: PAGE,
      question: exactQuestion,
      curiosityQuestion: 'A stale promise that must not survive v57',
    }, 'en'),
    type: 'Three Card Tarot',
    tier: 'medium',
    cards: 'Two of Wands, Nine of Wands, Eight of Wands',
    signals: 'Past: Two of Wands Upright; Present: Nine of Wands Upright; Future: Eight of Wands Reversed',
    scope: '3-card spread',
    confidence: 'Symbolic direction',
    previewContinuity: true,
  };
  const continuity = paidReadingContinuityContract(fields);
  const semantic = paidSemanticReviewContract(fields);

  assert.equal(fields.curiosityQuestion, '');
  assert.equal(continuity.originalQuestion, exactQuestion);
  assert.equal(continuity.paidQuestion, exactQuestion);
  assert.equal(continuity.promisedQuestion, '');
  assert.equal(semantic.latestPaidQuestion, exactQuestion);
  assert.equal(semantic.promisedQuestion, '');
  assert.equal(semantic.packageRequirements.promisedQuestion, false);
});

test('presentation telemetry accepts only the fixed PII-free compact variant', () => {
  const valid = canonicalFunnelMetadata({
    flow_id: 'compact-flow-20260816',
    free_value_status: 'delivered',
    presentation_variant: FREE_TAROT_COMPACT_PRESENTATION_VARIANT,
  }, 'free_answer_view');
  assert.equal(valid.ok, true);
  assert.equal(valid.value.presentation_variant, FREE_TAROT_COMPACT_PRESENTATION_VARIANT);

  assert.equal(canonicalFunnelMetadata({
    flow_id: 'compact-flow-20260816',
    free_value_status: 'delivered',
    presentation_variant: 'question=private customer text',
  }, 'free_answer_view').ok, false);
  assert.equal(canonicalFunnelMetadata({
    flow_id: 'compact-flow-20260816',
    free_value_status: 'delivered',
    presentation_variant: FREE_TAROT_COMPACT_PRESENTATION_VARIANT,
    question: 'private customer text',
  }, 'free_answer_view').ok, false);

  const safeLog = privacySafeLogRecord({
    presentation_variant: FREE_TAROT_COMPACT_PRESENTATION_VARIANT,
    compactInsight: 'private generated text',
  });
  assert.equal(safeLog.presentation_variant, FREE_TAROT_COMPACT_PRESENTATION_VARIANT);
  assert.equal(safeLog.compactInsight, '[redacted]');
});
