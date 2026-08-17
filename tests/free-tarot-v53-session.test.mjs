import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conciseDeterministicFreeTeaser,
  deterministicPrivateStateReservedRecovery,
  freePreviewPayload,
  freeTeaserAudit,
  freeTeaserAssignsUnsupportedStateToName,
  handleFreeReading,
  handleFreeSession,
  hydratePreviewSnapshot,
  privacySafeLogRecord,
  stripTrailingModelQuestion,
} from '../lib/legacy-worker.mjs';
import {
  FREE_TAROT_FUNNEL_VERSION,
  FREE_TAROT_FUNNEL_VERSIONS,
} from '../lib/free-tarot-payment-contract.mjs';

const VISITOR_ID = 'free_tarot_v53_visitor_01';
const REQUEST_HEADERS = Object.freeze({
  Origin: 'https://deckaura.com',
  'Content-Type': 'application/json; charset=utf-8',
  'CF-Connecting-IP': '203.0.113.153',
  'User-Agent': 'Deckaura v53 session contract test',
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

function rollingBudget({ limit = 3, commit = true } = {}) {
  let claims = 0;
  let commits = 0;
  let releases = 0;
  return {
    get claims() {
      return claims;
    },
    get commits() {
      return commits;
    },
    get releases() {
      return releases;
    },
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
        return { allowed: consume ? commit : true };
      },
    },
  };
}

function readingBody(question, readingId, visitorId = VISITOR_ID) {
  return {
    visitorId,
    readingId,
    question,
    requestedLocale: 'en-US',
    locale: 'en-US',
    type: 'Three Card Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'Three Card',
    context: 'Spread: Three Card (3-card spread). Cards: Past: Two of Wands, Present: Nine of Wands, Future: Eight of Wands (Reversed).',
    signals: 'Past: Two of Wands Upright; Present: Nine of Wands Upright; Future: Eight of Wands Reversed',
    cards: 'Two of Wands, Nine of Wands, Eight of Wands',
    scope: '3-card Three Card draw for one focused question',
    confidence: 'Symbolic tarot direction, not a factual prediction',
    snapshotVersion: 'reading-snapshot-v2',
    funnelVersion: FREE_TAROT_FUNNEL_VERSION,
  };
}

function workerEnv(kv, budget) {
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
  };
}

function readingRequest(body, headers = REQUEST_HEADERS) {
  return new Request('https://reading.deckaura.com/free-reading', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function sessionRequest(visitorId = VISITOR_ID, kind = 'last-approved', headers = REQUEST_HEADERS, hint = {}) {
  return new Request('https://reading.deckaura.com/free-session', {
    method: 'POST',
    headers,
    body: JSON.stringify({ visitorId, kind, ...hint }),
  });
}

async function createPreview(env, body) {
  const response = await handleFreeReading(readingRequest(body), env);
  return { response, payload: await response.json() };
}

for (const fixture of [
  {
    label: 'English em dash',
    lang: 'en',
    locale: 'en-US',
    question: 'Should I protect the current plan — or choose a smaller next step?',
  },
  {
    label: 'Spanish en dash',
    lang: 'es',
    locale: 'es-ES',
    question: '¿Conviene mantener el plan actual – o elegir un próximo paso más pequeño?',
  },
  {
    label: 'long compound Spanish question',
    lang: 'es',
    locale: 'es-ES',
    question: '¿Debo mantener el plan profesional actual – aunque ya no encaje con mis prioridades? ¿O conviene aceptar la alternativa llamada “Proyecto Horizonte”, negociar primero sus condiciones y esperar una señal verificable antes de decidir? Quiero comparar estabilidad, crecimiento y carga real sin convertir la presión de hoy en una decisión definitiva.',
  },
]) {
  test(`reserved preview preserves accepted ${fixture.label} punctuation through response, snapshot, and quota commit`, async () => {
    const kv = jsonKv();
    const budget = rollingBudget({ limit: 3 });
    const env = workerEnv(kv, budget);
    const body = {
      ...readingBody(
        fixture.question,
        `exact_question_punctuation_${fixture.lang}`,
        `exact_question_punctuation_visitor_${fixture.lang}`,
      ),
      lang: fixture.lang,
      locale: fixture.locale,
      requestedLocale: fixture.locale,
    };

    const result = await createPreview(env, body);

    assert.equal(result.response.status, 200, JSON.stringify(result.payload));
    assert.equal(result.payload.question, fixture.question);
    assert.equal(result.payload.servedSource, 'deterministic_reserved_fast_path');
    assert.equal(result.payload.auditStatus, 'passed');
    assert.ok(result.payload.teaser.includes(fixture.question), 'visible teaser changed the exact question');
    assert.ok(result.payload.preview.html.includes(fixture.question), 'structured preview changed the exact question');
    assert.match(result.payload.token, /^[a-f0-9]{32}$/i);

    const snapshot = JSON.parse(kv.values.get(`preview:${result.payload.token}`));
    assert.equal(snapshot.question, fixture.question);
    assert.ok(snapshot.teaserText.includes(fixture.question), 'durable snapshot changed the exact question');
    assert.equal(budget.claims, 1);
    assert.equal(budget.commits, 1);
    assert.equal(budget.releases, 0);
  });
}

test('reserved runtime keeps exact compound questions opaque across no-whitespace clause boundaries', async (t) => {
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  globalThis.fetch = async () => { modelCalls += 1; throw new Error('reserved fast path must not call a model'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const fixtures = [
    ['es-ES', 'es', '¿Mantengo el plan actual?¿O elijo la alternativa y comparo primero las condiciones reales?'],
    ['es-MX', 'es', '¿Mantengo el plan actual?O elijo la alternativa solo después de comprobar la carga real?'],
    ['es-ES', 'es', '¡Necesito decidir hoy!¿Conviene esperar una condición verificable antes de elegir?'],
    ['es-ES', 'es', 'La presión está aumentando.¿Debo mantener el plan o negociar una alternativa concreta?'],
    ['es-ES', 'es', 'No quiero decidir por miedo sobre mi plan profesional...¿Qué patrón debo entender antes de comparar estabilidad y crecimiento?'],
    ['es-ES', 'es', '¿Mantengo el plan actual?\u200B¿O espero una señal verificable antes de aceptar la alternativa?'],
    ['en-US', 'en', 'Should I keep the current career plan?Or should I compare the alternative workload before deciding?'],
    ['tr-TR', 'tr', 'Mevcut kariyer planını sürdürmeli miyim?Yoksa karar vermeden önce yeni seçeneğin koşullarını mı karşılaştırmalıyım?'],
    ['pt-BR', 'pt', 'Devo manter o plano profissional atual?Ou devo comparar a carga da alternativa antes de decidir?'],
    ['de-DE', 'de', 'Soll ich beim aktuellen Berufsplan bleiben?Oder soll ich vor der Entscheidung die Arbeitslast der Alternative vergleichen?'],
  ];
  for (const [index, [locale, lang, question]] of fixtures.entries()) {
    const kv = jsonKv();
    const budget = rollingBudget({ limit: 1 });
    const body = {
      ...readingBody(question, `opaque_boundary_${index}`, `opaque_boundary_visitor_${index}`),
      lang,
      locale,
      requestedLocale: locale,
    };
    const result = await createPreview(workerEnv(kv, budget), body);
    assert.equal(result.response.status, 200, `${locale}: ${JSON.stringify(result.payload)}`);
    assert.equal(result.payload.question, question, locale);
    assert.equal(result.payload.servedSource, 'deterministic_reserved_fast_path', locale);
    assert.ok(result.payload.teaser.includes(question), `${locale}: response changed the exact question`);
    assert.ok(result.payload.preview.html.includes(question), `${locale}: structured preview changed the exact question`);
    assert.doesNotMatch(result.payload.teaser, /[\uE000-\uF8FF]/u, `${locale}: sentinel leaked`);
    const snapshot = JSON.parse(kv.values.get(`preview:${result.payload.token}`));
    assert.equal(snapshot.question, question, locale);
    assert.ok(snapshot.teaserText.includes(question), `${locale}: KV snapshot changed the exact question`);
    assert.equal(budget.claims, 1, locale);
    assert.equal(budget.commits, 1, locale);
    assert.equal(budget.releases, 0, locale);
  }
  assert.equal(modelCalls, 0);
});

test('a customer question at model-output tail stays opaque through stripping and structured HTML segmentation', () => {
  const question = '¿Mantengo el plan actual?¿O comparo primero las condiciones reales?';
  const fields = {
    ...readingBody(question, 'tail_exact_question_01', 'tail_exact_question_visitor_01'),
    lang: 'es',
    locale: 'es-ES',
    requestedLocale: 'es-ES',
  };
  const draft = [
    'El patrón inicial muestra una elección que merece una pausa consciente.',
    'La carta central invita a comparar hechos observables antes de decidir.',
    'La carta final mantiene abierta una acción pequeña y reversible.',
    'La dirección sigue siendo simbólica y no una garantía externa.',
    question,
  ].join(' ');

  const stripped = stripTrailingModelQuestion(draft, fields);
  assert.ok(stripped.includes(question), 'tail stripping removed part of the exact customer question');
  assert.doesNotMatch(stripped, /[\uE000-\uF8FF]/u, 'tail stripping leaked its opaque sentinel');

  const payload = freePreviewPayload('tail-exact-token', stripped, fields);
  assert.ok(payload.teaser.includes(question), 'response HTML changed the exact tail question');
  assert.ok(payload.preview.html.includes(question), 'structured HTML changed the exact tail question');
  assert.doesNotMatch(payload.teaser, /[\uE000-\uF8FF]/u, 'response HTML leaked its opaque sentinel');
  assert.doesNotMatch(payload.preview.html, /[\uE000-\uF8FF]/u, 'structured HTML leaked its opaque sentinel');
});

test('an expired 24-hour replay rotates the deterministic claim for the same readingId', async (t) => {
  const originalNow = Date.now;
  let now = Date.UTC(2026, 7, 17, 1, 0, 0);
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });

  const kv = jsonKv();
  const claimed = new Set();
  const consumed = new Set();
  const claimIds = [];
  const budget = {
    binding: {
      claim: async (claimId) => {
        claimIds.push(claimId);
        const idempotent = claimed.has(claimId) || consumed.has(claimId);
        claimed.add(claimId);
        return { allowed: true, idempotent, cap: 3, used: consumed.size, remaining: 2 };
      },
      settle: async (claimId, consume) => {
        if (consume) consumed.add(claimId);
        return { allowed: true };
      },
    },
  };
  const env = workerEnv(kv, budget);
  const body = readingBody('What pattern should I understand before changing careers?', 'rotating_claim_same_reading');
  const first = await createPreview(env, body);
  assert.equal(first.response.status, 200, JSON.stringify(first.payload));

  now += 24 * 60 * 60 * 1000 + 1;
  const afterExpiry = await createPreview(env, body);
  assert.equal(afterExpiry.response.status, 200, JSON.stringify(afterExpiry.payload));
  assert.notEqual(afterExpiry.payload.token, first.payload.token);
  assert.equal(claimIds.length, 2);
  assert.notEqual(claimIds[0], claimIds[1], 'a retained consumed DB claim must not trap an expired replay');
  assert.equal(consumed.size, 2);
});

test('a failed committed marker remains recoverable from its durable snapshot without another quota consumption', async () => {
  const kv = jsonKv();
  let failCommittedMarkers = true;
  let markerFailures = 0;
  let kvReads = 0;
  const cache = {
    get: async (...args) => {
      kvReads += 1;
      return kv.binding.get(...args);
    },
    put: async (key, value, options) => {
      const parsed = key.startsWith('preview-response:') ? JSON.parse(value) : null;
      if (failCommittedMarkers && parsed?.commitState === 'committed') {
        markerFailures += 1;
        throw new Error('simulated committed marker failure');
      }
      return kv.binding.put(key, value, options);
    },
    delete: kv.binding.delete,
  };
  const claimed = new Set();
  const consumed = new Set();
  let uniqueCommits = 0;
  let releases = 0;
  const budget = {
    binding: {
      claim: async (claimId) => {
        const idempotent = claimed.has(claimId) || consumed.has(claimId);
        claimed.add(claimId);
        return { allowed: true, idempotent, cap: 3, used: consumed.size, remaining: 2 };
      },
      settle: async (claimId, consume) => {
        if (consume && !consumed.has(claimId)) {
          consumed.add(claimId);
          uniqueCommits += 1;
        } else if (!consume) releases += 1;
        return { allowed: true, idempotent: consumed.has(claimId) };
      },
    },
  };
  const env = { ...workerEnv(kv, budget), READINGS_CACHE: cache, FREE_PREVIEW_TOTAL_DEADLINE_MS: 300 };
  const body = readingBody('What pattern should I understand before changing careers?', 'marker_repair_same_reading');

  const first = await createPreview(env, body);
  assert.equal(first.response.status, 200, JSON.stringify(first.payload));
  assert.equal(markerFailures, 3, 'owner marker write must use the bounded retry budget');
  assert.equal(uniqueCommits, 1);
  assert.ok(kv.values.has(`preview:${first.payload.token}`), 'consumed quota must retain a restorable snapshot');
  const pending = [...kv.values.entries()]
    .filter(([key]) => key.startsWith('preview-response:'))
    .map(([, value]) => JSON.parse(value))[0];
  assert.equal(pending.commitState, 'pending');

  failCommittedMarkers = false;
  const recovered = await createPreview(env, body);
  assert.equal(recovered.response.status, 200, JSON.stringify(recovered.payload));
  assert.equal(recovered.payload.token, first.payload.token);
  assert.equal(recovered.payload.replayed, true);
  assert.equal(uniqueCommits, 1, 'idempotent repair must not consume quota twice');
  assert.equal(releases, 0);
  assert.ok(kvReads <= 40, `replay recovery exceeded the 40-read cap: ${kvReads}`);
  const committed = [...kv.values.entries()]
    .filter(([key]) => key.startsWith('preview-response:'))
    .map(([, value]) => JSON.parse(value))[0];
  assert.equal(committed.commitState, 'committed');
});

test('an idempotent follower uses bounded backoff and never exceeds the replay KV read cap', async () => {
  let kvReads = 0;
  const env = {
    ...workerEnv(jsonKv(), {
      binding: {
        claim: async () => ({ allowed: true, idempotent: true, cap: 3, used: 0, remaining: 2 }),
        settle: async () => ({ allowed: true }),
      },
    }),
    READINGS_CACHE: {
      get: async () => { kvReads += 1; return null; },
      put: async () => {},
      delete: async () => {},
    },
    FREE_PREVIEW_TOTAL_DEADLINE_MS: 300,
  };
  const result = await createPreview(env, readingBody('What pattern should I understand before changing careers?', 'bounded_poll_missing_owner'));
  assert.equal(result.response.status, 503, JSON.stringify(result.payload));
  assert.equal(result.payload.reason, 'preview_in_progress');
  assert.ok(kvReads <= 8, `50→100→200ms backoff made too many reads: ${kvReads}`);
  assert.ok(kvReads <= 40, 'hard replay KV read cap was exceeded');
});

test('reserved private-state recovery passes a 1/2/3-person seven-locale compound matrix without copying the question', async () => {
  const fixtures = [
    { locale: 'en-US', lang: 'en', question: 'what does alex feel about me, and will the silence change if I do not contact them first?', names: ['alex'] },
    { locale: 'en-GB', lang: 'en', question: 'What do Ana and Jordan secretly feel about me, or are their quoted “mixed signals” only my interpretation?', names: ['Ana', 'Jordan'] },
    { locale: 'tr-TR', lang: 'tr', question: 'Ali, Deniz ve Ece benim hakkımda ne düşünüyor; beni özlüyorlar mı, yoksa bu sessizlik başka bir anlama mı geliyor?', names: ['Ali', 'Deniz', 'Ece'] },
    { locale: 'tr-TR', lang: 'tr', question: 'O gerçekten beni seviyor mu, yoksa gördüğüm işaretler kendi umudumdan mı kaynaklanıyor?', names: [] },
    { locale: 'de-DE', lang: 'de', question: 'Was fühlt Lena für mich, und was fühlt Lukas wirklich, wenn ihr „vielleicht“ Nähe oder nur Höflichkeit bedeutet?', names: ['Lena', 'Lukas'] },
    { locale: 'es-ES', lang: 'es', question: '¿Qué siente Ana por mí, qué siente Carlos y qué siente Lucía; volverán porque me extrañan o interpreto mal su silencio?', names: ['Ana', 'Carlos', 'Lucía'] },
    { locale: 'es-MX', lang: 'es', question: '¿Qué siente él por mí aunque dijo “no”, o esa alternativa contradice lo que realmente quiere?', names: [] },
    { locale: 'pt-BR', lang: 'pt', question: 'O que Ana sente por mim e o que Carlos sente; a distância significa saudade ou apenas uma escolha que não consigo confirmar?', names: ['Ana', 'Carlos'] },
    { locale: 'pt-PT', lang: 'pt', question: 'O que Inês sente por mim, e o seu “talvez” significa interesse ou apenas educação?', names: ['Inês'] },
    { locale: 'de-AT', lang: 'de', question: 'Was fühlt Mila für mich, was fühlt Jonas und was fühlt Priya; wünschen sie eine Rückkehr, oder widerspricht ihr Schweigen?', names: ['Mila', 'Jonas', 'Priya'] },
  ];

  for (const [index, fixture] of fixtures.entries()) {
    const fields = {
      ...readingBody(fixture.question, `private_matrix_${index}`, `private_matrix_visitor_${index}`),
      lang: fixture.lang,
      locale: fixture.locale,
      requestedLocale: fixture.locale,
    };
    const deterministic = deterministicPrivateStateReservedRecovery(fields, fixture.locale);
    assert.ok(deterministic, `${fixture.locale}: dedicated recovery missing`);
    assert.ok(!deterministic.includes(fixture.question), `${fixture.locale}: long private question was copied`);
    assert.doesNotMatch(deterministic, /[\uE000-\uF8FF]/u, `${fixture.locale}: internal sentinel leaked`);
    for (const name of fixture.names) assert.match(deterministic, new RegExp(name, 'iu'), `${fixture.locale}: ${name} missing`);
    const wordCount = deterministic.trim().split(/\s+/u).length;
    assert.ok(wordCount >= 180 && wordCount <= 210, `${fixture.locale}: ${wordCount} words`);
    const audit = freeTeaserAudit(deterministic, fields, 180);
    assert.equal(audit.ok, true, `${fixture.locale}: ${audit.reason}`);
    assert.equal(audit.mentionedEvidence, 3, `${fixture.locale}: evidence identity loss`);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(deterministic, fields), false, fixture.locale);
    if (index === 0) {
      const modifiedTemplate = deterministic.replace('visible communication', 'clearly visible communication');
      const modifiedAudit = freeTeaserAudit(modifiedTemplate, fields, 180);
      assert.equal(modifiedAudit.ok, false, 'only the byte-exact server template may omit the exact private-state question');
    }

    const runtime = await createPreview(workerEnv(jsonKv(), rollingBudget({ limit: 1 })), fields);
    assert.equal(runtime.response.status, 200, `${fixture.locale}: ${JSON.stringify(runtime.payload)}`);
    assert.equal(runtime.payload.servedSource, 'deterministic_reserved_fast_path');
    assert.ok(!runtime.payload.teaser.includes(fixture.question), `${fixture.locale}: runtime copied private question`);
    assert.doesNotMatch(runtime.payload.teaser, /[\uE000-\uF8FF]/u, `${fixture.locale}: runtime sentinel leaked`);
  }
});

test('v56 keeps the third approved reading as the verified paid continuation when the rolling 3/24h quota rejects a new question', async () => {
  const kv = jsonKv();
  const budget = rollingBudget({ limit: 3 });
  const env = workerEnv(kv, budget);
  const approved = [
    readingBody('What should I understand before changing careers?', 'v53_quota_reading_01'),
    readingBody('What pattern is holding back my career decision?', 'v53_quota_reading_02'),
    readingBody('How can I recognize the right career opportunity?', 'v53_quota_reading_03'),
  ];
  const previews = [];

  for (const body of approved) {
    const result = await createPreview(env, body);
    assert.equal(result.response.status, 200, JSON.stringify(result.payload));
    assert.match(result.payload.token, /^[a-f0-9]{32}$/i);
    previews.push(result.payload);
  }

  const rejectedBody = readingBody('Should I accept a completely different job offer?', 'v53_quota_reading_04');
  const rejected = await createPreview(env, rejectedBody);
  assert.equal(rejected.response.status, 429, JSON.stringify(rejected.payload));
  assert.equal(rejected.payload.reason, 'visitor_rate_limit');
  assert.equal(budget.claims, 4);

  const sessionResponse = await handleFreeSession(sessionRequest(), env);
  const sessionPayload = await sessionResponse.json();
  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionPayload.found, true, JSON.stringify(sessionPayload));
  assert.equal(sessionPayload.kind, 'last-approved');
  assert.equal(sessionPayload.verified, true);
  assert.equal(sessionPayload.session.approvalStatus, 'approved');
  assert.equal(sessionPayload.session.question, approved[2].question);
  assert.equal(sessionPayload.session.readingId, approved[2].readingId);
  assert.equal(sessionPayload.session.token, previews[2].token);
  assert.equal(sessionPayload.session.funnelVersion, FREE_TAROT_FUNNEL_VERSION);
  assert.ok(sessionPayload.session.preview?.html, 'restored checkout must keep the structured personalized preview');
  assert.match(sessionPayload.session.preview.html, /Two of Wands/i);
  assert.match(sessionPayload.session.preview.html, /Nine of Wands/i);
  assert.ok(sessionPayload.session.preview.lockLabel);
  assert.deepEqual(sessionPayload.session.preview.reserved, {
    futureInterpretation: true,
    verdict: true,
    decidingCondition: true,
    timing: true,
    nextStep: true,
  });
  assert.equal(sessionPayload.session.servedSource, 'deterministic_reserved_fast_path');
  assert.notEqual(sessionPayload.session.question, rejectedBody.question);
  assert.notEqual(sessionPayload.session.readingId, rejectedBody.readingId);
});

test('a 429 free-preview denial can prepare one exact-question paid-new-spread without an unsafe preview token', async () => {
  const kv = jsonKv();
  const budget = rollingBudget({ limit: 0 });
  const env = workerEnv(kv, budget);
  const question = 'What should I understand before choosing this exact career offer?';
  const denied = await createPreview(env, readingBody(question, 'v56_rate_limited_01'));

  assert.equal(denied.response.status, 429, JSON.stringify(denied.payload));
  assert.equal(denied.payload.reason, 'visitor_rate_limit');
  assert.equal(denied.payload.retryable, false);
  assert.equal(denied.payload.offerAllowed, true);
  assert.equal(denied.payload.token, undefined);
  assert.equal(budget.commits, 0);

  const paidResponse = await handleFreeSession(sessionRequest(VISITOR_ID, 'paid-new-spread', REQUEST_HEADERS, {
    question,
    requestedLocale: 'en-US',
  }), env);
  const paid = await paidResponse.json();
  assert.equal(paidResponse.status, 200, JSON.stringify(paid));
  assert.equal(paid.found, true);
  assert.equal(paid.verified, true);
  assert.equal(paid.source, 'paid_new_spread');
  assert.equal(paid.session.question, question);
  assert.equal(paid.session.funnelVersion, FREE_TAROT_FUNNEL_VERSION);
  assert.equal(paid.session.purchaseIntentOnly, true);
  assert.match(paid.session.token, /^[a-f0-9]{32}$/i);

  const hydrated = await hydratePreviewSnapshot({
    question,
    freeToken: paid.session.token,
    readingId: paid.session.readingId,
    type: paid.session.type,
    cards: paid.session.cards,
    spread: paid.session.spread,
    context: paid.session.context,
    signals: paid.session.signals,
    scope: paid.session.scope,
    confidence: paid.session.confidence,
    tool: paid.session.tool,
    funnelVersion: paid.session.funnelVersion,
    snapshotVersion: paid.session.snapshotVersion,
  }, env);
  assert.equal(hydrated.previewContinuity, true);
  assert.equal(hydrated.question, question);
});

test('insufficient questions fail before quota reservation or preview persistence', async () => {
  const kv = jsonKv();
  const budget = rollingBudget({ limit: 3 });
  const env = workerEnv(kv, budget);
  const result = await createPreview(env, readingBody('Alex', 'v56_insufficient_question_01'));

  assert.equal(result.response.status, 422, JSON.stringify(result.payload));
  assert.equal(result.payload.reason, 'QUESTION_NEEDS_CONTEXT');
  assert.equal(budget.claims, 0);
  assert.equal(budget.commits, 0);
  assert.equal(budget.releases, 0);
  assert.equal(kv.values.size, 0);
});

test('preview persistence failure releases the reserved quota and never returns checkout authority', async () => {
  const kv = jsonKv();
  const budget = rollingBudget({ limit: 3 });
  const env = workerEnv(kv, budget);
  env.READINGS_CACHE = {
    get: kv.binding.get,
    put: async () => {
      throw new Error('simulated cache write failure');
    },
    delete: kv.binding.delete,
  };
  const result = await createPreview(
    env,
    readingBody('What should I understand before changing careers?', 'v56_persist_failure_01'),
  );

  assert.equal(result.response.status, 503, JSON.stringify(result.payload));
  assert.equal(result.payload.reason, 'snapshot_store_failed');
  assert.equal(result.payload.token, undefined);
  assert.equal(budget.claims, 1);
  assert.equal(budget.commits, 0);
  assert.equal(budget.releases, 1);
});

test('a header-fast body timeout recovers deterministically and commits quota only after the preview is saved', async (t) => {
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  const providerSignals = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init = {}) => {
    modelCalls += 1;
    providerSignals.push(init.signal);
    return {
      ok: true,
      status: 200,
      // Ignore abort deliberately: Promise.race must bound response.json(),
      // while AbortSignal still reaches the real provider fetch.
      json: () => new Promise(() => {}),
    };
  };

  const kv = jsonKv();
  const budget = rollingBudget({ limit: 3 });
  const aiBudgetClaims = [];
  const aiBudgetSettlements = [];
  const env = {
    ...workerEnv(kv, budget),
    DEEPSEEK_DIRECT_API_KEY: 'test-only-deepseek-key',
    FREE_PREVIEW_MODEL_TIMEOUT_MS: 25,
    AI_BUDGETS: {
      claim: async (input) => {
        aiBudgetClaims.push(input);
        return { allowed: true, claimId: input.claimId };
      },
      settle: async (claimId, commit, costMicros) => {
        aiBudgetSettlements.push({ claimId, commit, costMicros });
        return { allowed: true };
      },
    },
  };
  const body = {
    ...readingBody('What should I understand about my career energy today?', 'v56_timeout_recovery_01'),
    type: 'Daily Tarot Card',
    spread: 'Daily Card',
    context: 'Card: The Star Upright.',
    signals: 'Card: The Star Upright',
    cards: 'The Star',
    scope: '1-card Daily Card draw for one focused question',
  };
  const result = await createPreview(env, body);

  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.match(result.payload.token, /^[a-f0-9]{32}$/i);
  assert.match(result.payload.servedSource, /^deterministic_/);
  assert.equal(modelCalls, 1, 'public preview transport failures must not multiply provider calls');
  assert.ok(providerSignals[0] instanceof AbortSignal);
  assert.equal(providerSignals[0].aborted, true);
  assert.equal(budget.claims, 1);
  assert.equal(budget.commits, 1);
  assert.equal(budget.releases, 0);
  assert.equal(aiBudgetClaims.length, 1);
  assert.deepEqual(aiBudgetSettlements, [{
    claimId: aiBudgetClaims[0].claimId,
    commit: true,
    costMicros: aiBudgetClaims[0].reserveMicros,
  }]);
  assert.ok([...kv.values.keys()].some((key) => key.startsWith('preview:')));
});

test('Free Tarot preview hydration treats the stored token question as authoritative and rejects a new question', async () => {
  const kv = jsonKv();
  const env = workerEnv(kv, rollingBudget({ limit: 1 }));
  const body = readingBody('What should I understand before changing careers?', 'v53_anchor_reading_01');
  const created = await createPreview(env, body);
  assert.equal(created.response.status, 200, JSON.stringify(created.payload));

  const matching = await hydratePreviewSnapshot({
    ...body,
    question: '  What  should I understand before changing careers?  ',
    freeToken: created.payload.token,
  }, env);
  assert.equal(matching.previewContinuity, true);
  assert.equal(matching.question, body.question);
  assert.equal(matching.readingId, body.readingId);
  assert.equal(matching.funnelVersion, FREE_TAROT_FUNNEL_VERSION);

  await assert.rejects(
    hydratePreviewSnapshot({
      ...body,
      question: 'Should I accept a different role instead?',
      freeToken: created.payload.token,
    }, env),
    (error) => error?.code === 'PREVIEW_QUESTION_MISMATCH' && error?.missing?.includes('question'),
  );
  await assert.rejects(
    hydratePreviewSnapshot({ ...body, question: '', freeToken: created.payload.token }, env),
    (error) => error?.code === 'PREVIEW_QUESTION_MISMATCH',
  );
});

test('last-approved lookup is visitor-bound and fails closed after snapshot question tampering', async () => {
  const kv = jsonKv();
  const env = workerEnv(kv, rollingBudget({ limit: 1 }));
  const body = readingBody('What should I understand before changing careers?', 'v53_security_reading_01');
  const created = await createPreview(env, body);
  assert.equal(created.response.status, 200, JSON.stringify(created.payload));

  const otherVisitorResponse = await handleFreeSession(
    sessionRequest('free_tarot_v53_visitor_02'),
    env,
  );
  assert.deepEqual(await otherVisitorResponse.json(), {
    found: false,
    kind: 'last-approved',
    verified: false,
    reason: 'not_found',
  });

  const snapshotKey = `preview:${created.payload.token}`;
  const snapshot = JSON.parse(kv.values.get(snapshotKey));
  snapshot.question = 'A tampered replacement question?';
  kv.values.set(snapshotKey, JSON.stringify(snapshot));

  const tamperedResponse = await handleFreeSession(sessionRequest(), env);
  assert.deepEqual(await tamperedResponse.json(), {
    found: false,
    kind: 'last-approved',
    verified: false,
    reason: 'snapshot_mismatch',
  });
  const deletedResponse = await handleFreeSession(sessionRequest(), env);
  assert.equal((await deletedResponse.json()).reason, 'not_found');
});

test('v50-v56 legacy current sessions migrate once into a verified last-approved pointer, including pending records', async () => {
  for (const [index, funnelVersion] of FREE_TAROT_FUNNEL_VERSIONS.entries()) {
    const kv = jsonKv();
    const env = workerEnv(kv, rollingBudget({ limit: 1 }));
    const body = {
      ...readingBody(`What career pattern should I understand for legacy release ${index + 1}?`, `legacy_migration_${index + 1}`),
      funnelVersion,
    };
    const created = await createPreview(env, body);
    assert.equal(created.response.status, 200, `${funnelVersion}: ${JSON.stringify(created.payload)}`);

    const currentKey = [...kv.values.keys()].find((key) => key.startsWith('preview-current:'));
    const lastApprovedKey = [...kv.values.keys()].find((key) => key.startsWith('preview-last-approved:'));
    assert.ok(currentKey, funnelVersion);
    assert.ok(lastApprovedKey, funnelVersion);
    const legacyCurrent = JSON.parse(kv.values.get(currentKey));
    if (index % 2 === 0) delete legacyCurrent.approvalStatus;
    else legacyCurrent.approvalStatus = 'pending';
    legacyCurrent.approvedAt = 0;
    kv.values.set(currentKey, JSON.stringify(legacyCurrent));
    kv.values.delete(lastApprovedKey);

    const response = await handleFreeSession(sessionRequest(), env);
    const payload = await response.json();
    assert.equal(payload.found, true, `${funnelVersion}: ${JSON.stringify(payload)}`);
    assert.equal(payload.verified, true, funnelVersion);
    assert.equal(payload.session.approvalStatus, 'approved', funnelVersion);
    assert.equal(payload.session.question, body.question, funnelVersion);
    assert.equal(payload.session.funnelVersion, funnelVersion);

    const persisted = JSON.parse(kv.values.get(lastApprovedKey));
    assert.equal(persisted.approvalStatus, 'approved', funnelVersion);
    assert.ok(persisted.approvedAt > 0, funnelVersion);
  }
});

test('missing-version v2 Free Tarot sessions migrate only with complete owner-bound evidence', async () => {
  for (const missingEvidence of ['', 'signals']) {
    const kv = jsonKv();
    const env = workerEnv(kv, rollingBudget({ limit: 1 }));
    const body = readingBody(`What complete pattern should I understand before legacy recovery ${missingEvidence || 'safe'}?`, `legacy_missing_version_${missingEvidence || 'safe'}`);
    const created = await createPreview(env, body);
    assert.equal(created.response.status, 200, JSON.stringify(created.payload));
    const currentKey = [...kv.values.keys()].find((key) => key.startsWith('preview-current:'));
    const lastApprovedKey = [...kv.values.keys()].find((key) => key.startsWith('preview-last-approved:'));
    const snapshotKey = `preview:${created.payload.token}`;
    const current = JSON.parse(kv.values.get(currentKey));
    const snapshot = JSON.parse(kv.values.get(snapshotKey));
    current.approvalStatus = 'pending';
    current.approvedAt = 0;
    delete current.fields.funnelVersion;
    delete snapshot.fields.funnelVersion;
    if (missingEvidence) {
      current.fields[missingEvidence] = '';
      snapshot.fields[missingEvidence] = '';
    }
    kv.values.set(currentKey, JSON.stringify(current));
    kv.values.set(snapshotKey, JSON.stringify(snapshot));
    kv.values.delete(lastApprovedKey);

    const response = await handleFreeSession(sessionRequest(), env);
    const payload = await response.json();
    if (!missingEvidence) {
      assert.equal(payload.found, true, JSON.stringify(payload));
      assert.equal(payload.verified, true);
      assert.equal(payload.session.question, body.question);
      assert.equal(payload.session.cards, body.cards);
    } else {
      assert.deepEqual(payload, { found: false, kind: 'last-approved', verified: false, reason: 'not_found' });
      assert.equal(kv.values.has(lastApprovedKey), false);
    }
  }
});

test('paid-new-spread creates and replays one server-authoritative v56 snapshot for the exact paid question', async () => {
  const kv = jsonKv();
  const env = workerEnv(kv, rollingBudget({ limit: 10 }));
  const question = 'What should I understand before accepting this new career opportunity?';
  const request = () => handleFreeSession(sessionRequest(VISITOR_ID, 'paid-new-spread', REQUEST_HEADERS, {
    question,
    requestedLocale: 'en-US',
  }), env);
  const firstResponse = await request();
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200, JSON.stringify(first));
  assert.equal(first.found, true);
  assert.equal(first.verified, true);
  assert.equal(first.source, 'paid_new_spread');
  assert.equal(first.replayed, false);
  assert.equal(first.session.question, question);
  assert.equal(first.session.tool, '/pages/free-tarot-reading');
  assert.equal(first.session.funnelVersion, FREE_TAROT_FUNNEL_VERSION);
  assert.equal(first.session.purchaseIntentOnly, true);
  assert.equal(first.session.paidNewSpread, true);
  assert.equal(first.session.continuationMode, 'paid_new_spread');
  assert.match(first.session.token, /^[a-f0-9]{32}$/);
  assert.match(first.session.readingId, /^reading_paid_[a-f0-9]{32}$/);
  assert.equal(first.session.readingId.includes(first.session.token), false, 'observable reading IDs must never contain the bearer token');
  assert.match(first.session.conversationId, /^[a-f0-9-]{36}$/i);
  assert.notEqual(first.session.conversationId.replace(/-/g, ''), first.session.token, 'conversation IDs must be independent from bearer tokens');
  assert.equal(first.session.cards.split(',').length, 3);
  assert.match(first.session.signals, /^Past: .+ (?:Upright|Reversed); Present: .+ (?:Upright|Reversed); Future: .+ (?:Upright|Reversed)$/);

  const secondResponse = await request();
  const second = await secondResponse.json();
  assert.equal(secondResponse.status, 200);
  assert.equal(second.replayed, true);
  assert.equal(second.session.token, first.session.token);
  assert.equal(second.session.readingId, first.session.readingId);
  assert.equal(second.session.cards, first.session.cards);

  const hydrated = await hydratePreviewSnapshot({
    question,
    freeToken: first.session.token,
    readingId: first.session.readingId,
    type: first.session.type,
    cards: first.session.cards,
    spread: first.session.spread,
    context: first.session.context,
    signals: first.session.signals,
    scope: first.session.scope,
    confidence: first.session.confidence,
    tool: first.session.tool,
    funnelVersion: first.session.funnelVersion,
    snapshotVersion: first.session.snapshotVersion,
  }, env);
  assert.equal(hydrated.previewContinuity, true);
  assert.equal(hydrated.question, question);
  assert.equal(hydrated.cards, first.session.cards);
  await assert.rejects(
    hydratePreviewSnapshot({ ...hydrated, question: 'What different question should replace the paid one?' }, env),
    (error) => error?.code === 'PREVIEW_QUESTION_MISMATCH',
  );
});

test('privacy-safe logging redacts token, conversation, and signature authorities at every object depth', () => {
  assert.deepEqual(privacySafeLogRecord({
    token: 'bearer-secret',
    conversationId: 'conversation-secret',
    checkoutSignature: 'signature-secret',
    inputTokens: 128,
    metadata: {
      previewToken: 'nested-token',
      conversation_id: 'nested-conversation',
      hmacSignature: 'nested-signature',
      status: 'safe',
    },
  }), {
    token: '[redacted]',
    conversationId: '[redacted]',
    checkoutSignature: '[redacted]',
    inputTokens: 128,
    metadata: {
      previewToken: '[redacted]',
      conversation_id: '[redacted]',
      hmacSignature: '[redacted]',
      status: 'safe',
    },
  });
});

test('paid-new-spread commits its usage claim and fails closed when the paid preparation cap is reached', async () => {
  const kv = jsonKv();
  let used = 0;
  let activeClaim = '';
  const actions = [];
  const env = workerEnv(kv, rollingBudget({ limit: 10 }));
  env.FREE_ENTITLEMENTS = {
    getByName: () => ({
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        actions.push(body.action);
        if (body.action === 'claim-usage') {
          if (used >= 1) return new Response(JSON.stringify({ allowed: false, reason: 'usage_limit', used, cap: 1, remaining: 0 }));
          activeClaim = body.claimId;
          return new Response(JSON.stringify({ allowed: true, used, cap: 1, remaining: 1 }));
        }
        if (body.action === 'commit-usage' && body.claimId === activeClaim) {
          used += 1;
          activeClaim = '';
          return new Response(JSON.stringify({ allowed: true, used, cap: 1, remaining: 0 }));
        }
        if (body.action === 'release-usage' && body.claimId === activeClaim) {
          activeClaim = '';
          return new Response(JSON.stringify({ allowed: true, used, cap: 1, remaining: Math.max(0, 1 - used) }));
        }
        return new Response(JSON.stringify({ allowed: false, reason: 'claim_mismatch', used, cap: 1, remaining: 0 }));
      },
    }),
  };

  const firstResponse = await handleFreeSession(sessionRequest(VISITOR_ID, 'paid-new-spread', REQUEST_HEADERS, {
    question: 'What should I understand before accepting this exact career offer?',
  }), env);
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200, JSON.stringify(first));
  assert.deepEqual(actions, ['claim-usage', 'commit-usage']);
  assert.equal(used, 1);
  assert.equal(first.session.readingId.includes(first.session.token), false);

  const cappedResponse = await handleFreeSession(sessionRequest(VISITOR_ID, 'paid-new-spread', REQUEST_HEADERS, {
    question: 'What should I understand before choosing a different career offer?',
  }), env);
  const capped = await cappedResponse.json();
  assert.equal(cappedResponse.status, 429, JSON.stringify(capped));
  assert.equal(capped.reason, 'PAID_NEW_SPREAD_RATE_LIMIT');
  assert.deepEqual(actions, ['claim-usage', 'commit-usage', 'claim-usage']);
});

test('an expired visitor session purges all discoverable sibling pointers but preserves token snapshots for checkout continuity', async () => {
  const kv = jsonKv();
  const env = workerEnv(kv, rollingBudget({ limit: 10 }));
  const freeQuestion = 'What should I understand before choosing my next career direction?';
  const free = await createPreview(env, readingBody(freeQuestion, 'v55_expiry_free_reading_01'));
  assert.equal(free.response.status, 200, JSON.stringify(free.payload));

  const paidQuestion = 'What should I understand before accepting this private career opportunity?';
  const paidResponse = await handleFreeSession(sessionRequest(VISITOR_ID, 'paid-new-spread', REQUEST_HEADERS, { question: paidQuestion }), env);
  const paid = await paidResponse.json();
  assert.equal(paidResponse.status, 200, JSON.stringify(paid));

  const pointerKeys = [...kv.values.keys()].filter((key) => /^preview-(?:current|last-approved|paid-new-spread):/.test(key));
  assert.equal(pointerKeys.length, 3, `expected all three sibling pointers: ${pointerKeys.join(', ')}`);
  const expiredKey = pointerKeys.find((key) => key.startsWith('preview-last-approved:'));
  const expiredRecord = JSON.parse(kv.values.get(expiredKey));
  expiredRecord.expiresAt = Date.now() - 1;
  kv.values.set(expiredKey, JSON.stringify(expiredRecord));

  const lookupResponse = await handleFreeSession(sessionRequest(VISITOR_ID, 'current'), env);
  const lookup = await lookupResponse.json();
  assert.equal(lookupResponse.status, 200);
  assert.deepEqual(lookup, { found: false, kind: 'current', verified: false, reason: 'not_found' });
  assert.equal([...kv.values.keys()].some((key) => /^preview-(?:current|last-approved|paid-new-spread):/.test(key)), false, 'visitor-discoverable pointers must be purged together');
  assert.equal(kv.values.has(`preview:${free.payload.token}`), true, 'free token snapshot must survive for an already-started checkout');
  assert.equal(kv.values.has(`preview:${paid.session.token}`), true, 'paid token snapshot must survive for an already-started checkout');
  assert.equal(JSON.stringify(lookup).includes(freeQuestion), false);
  assert.equal(JSON.stringify(lookup).includes(paidQuestion), false);
});

test('paid-new-spread blocks crisis, medical, death, and danger questions before any purchasable snapshot exists', async () => {
  const questions = [
    'Should I kill myself tonight because nothing will improve?',
    'Should I change my medication dose based on these cards?',
    'Will my father die this week according to tarot?',
    'Should I stay with the partner who threatened me with violence?',
  ];
  for (let index = 0; index < questions.length; index += 1) {
    const kv = jsonKv();
    const env = workerEnv(kv, rollingBudget({ limit: 10 }));
    const response = await handleFreeSession(sessionRequest(`paid_new_safety_visitor_${index}`, 'paid-new-spread', REQUEST_HEADERS, { question: questions[index] }), env);
    const payload = await response.json();
    assert.equal(response.status, 422, `${questions[index]}: ${JSON.stringify(payload)}`);
    assert.deepEqual(payload, {
      found: false,
      kind: 'paid-new-spread',
      verified: false,
      reason: 'PAID_NEW_SPREAD_SAFETY_BLOCKED',
      safety: true,
      offerAllowed: false,
    });
    assert.equal([...kv.values.keys()].some((key) => key.startsWith('preview:')), false);
  }
});

test('a returned historical preview token recovers its exact verified snapshot when both session pointers are missing', async () => {
  const kv = jsonKv();
  const env = workerEnv(kv, rollingBudget({ limit: 1 }));
  const body = readingBody('What should I understand before changing careers?', 'v53_token_recovery_01');
  const created = await createPreview(env, body);
  assert.equal(created.response.status, 200, JSON.stringify(created.payload));

  for (const key of [...kv.values.keys()]) {
    if (key.startsWith('preview-current:') || key.startsWith('preview-last-approved:')) kv.values.delete(key);
  }
  const response = await handleFreeSession(sessionRequest(VISITOR_ID, 'last-approved', REQUEST_HEADERS, {
    token: created.payload.token,
    readingId: body.readingId,
    question: body.question,
  }), env);
  const payload = await response.json();
  assert.equal(payload.found, true, JSON.stringify(payload));
  assert.equal(payload.verified, true);
  assert.equal(payload.session.approvalStatus, 'approved');
  assert.equal(payload.session.token, created.payload.token);
  assert.equal(payload.session.readingId, body.readingId);
  assert.equal(payload.session.question, body.question);
  assert.equal(payload.session.cards, body.cards);
  assert.equal(payload.session.spread, body.spread);
  assert.ok([...kv.values.keys()].some((key) => key.startsWith('preview-last-approved:')));
});

test('historical token recovery fails closed for altered question, reading, owner, safety, and purchase-only snapshots', async () => {
  for (const mode of ['question', 'reading', 'owner', 'safety', 'purchase-only']) {
    const kv = jsonKv();
    const env = workerEnv(kv, rollingBudget({ limit: 1 }));
    const body = readingBody(`What career pattern should I understand for ${mode}?`, `v53_token_reject_${mode}`);
    const created = await createPreview(env, body);
    assert.equal(created.response.status, 200, `${mode}: ${JSON.stringify(created.payload)}`);
    for (const key of [...kv.values.keys()]) {
      if (key.startsWith('preview-current:') || key.startsWith('preview-last-approved:')) kv.values.delete(key);
    }
    const snapshotKey = `preview:${created.payload.token}`;
    const snapshot = JSON.parse(kv.values.get(snapshotKey));
    if (mode === 'owner') snapshot.ownerVisitorHash = 'visitor:not-the-requesting-owner';
    if (mode === 'safety') snapshot.fields.safetyAction = 'medical';
    if (mode === 'purchase-only') snapshot.purchaseIntentOnly = true;
    kv.values.set(snapshotKey, JSON.stringify(snapshot));
    const response = await handleFreeSession(sessionRequest(VISITOR_ID, 'last-approved', REQUEST_HEADERS, {
      token: created.payload.token,
      readingId: mode === 'reading' ? 'v53_token_reject_other' : body.readingId,
      question: mode === 'question' ? 'What entirely different question should replace it?' : body.question,
    }), env);
    assert.deepEqual(await response.json(), {
      found: false,
      kind: 'last-approved',
      verified: false,
      reason: 'not_found',
    }, mode);
    assert.equal([...kv.values.keys()].some((key) => key.startsWith('preview-last-approved:')), false, mode);
  }
});

test('legacy migration rejects blocked, safety, owner, question, and funnel-version mismatches', async () => {
  for (const mode of ['blocked', 'safety-snapshot', 'owner-mismatch', 'question-mismatch', 'unknown-version']) {
    const kv = jsonKv();
    const env = workerEnv(kv, rollingBudget({ limit: 1 }));
    const body = readingBody(`What should I understand before a ${mode} career decision?`, `legacy_reject_${mode}`);
    const created = await createPreview(env, body);
    assert.equal(created.response.status, 200, `${mode}: ${JSON.stringify(created.payload)}`);

    const currentKey = [...kv.values.keys()].find((key) => key.startsWith('preview-current:'));
    const lastApprovedKey = [...kv.values.keys()].find((key) => key.startsWith('preview-last-approved:'));
    const current = JSON.parse(kv.values.get(currentKey));
    current.approvalStatus = 'pending';
    current.approvedAt = 0;
    if (mode === 'blocked') current.offerBlocked = true;
    kv.values.set(currentKey, JSON.stringify(current));
    kv.values.delete(lastApprovedKey);
    if (mode !== 'blocked') {
      const snapshotKey = `preview:${created.payload.token}`;
      const snapshot = JSON.parse(kv.values.get(snapshotKey));
      if (mode === 'safety-snapshot') snapshot.fields.safetyAction = 'medical';
      if (mode === 'owner-mismatch') snapshot.ownerVisitorHash = 'visitor:unrelated-owner';
      if (mode === 'question-mismatch') snapshot.question = 'A different stored question?';
      if (mode === 'unknown-version') snapshot.fields.funnelVersion = 'premium-choice-2026-08-v57';
      kv.values.set(snapshotKey, JSON.stringify(snapshot));
    }

    const response = await handleFreeSession(sessionRequest(), env);
    assert.deepEqual(await response.json(), {
      found: false,
      kind: 'last-approved',
      verified: false,
      reason: 'not_found',
    }, mode);
    assert.equal(kv.values.has(lastApprovedKey), false, mode);
  }
});

test('failed quota settlement never creates an approved continuation', async () => {
  const kv = jsonKv();
  const env = workerEnv(kv, rollingBudget({ limit: 1, commit: false }));
  const created = await createPreview(
    env,
    readingBody('What should I understand before changing careers?', 'v53_commit_failure_01'),
  );
  assert.equal(created.response.status, 503);
  assert.equal(created.payload.reason, 'commit_failed');

  const sessionResponse = await handleFreeSession(sessionRequest(), env);
  assert.deepEqual(await sessionResponse.json(), {
    found: false,
    kind: 'last-approved',
    verified: false,
    reason: 'not_found',
  });
});

test('a committed safety-blocked reading updates current state without replacing the last paid-safe continuation', async () => {
  const kv = jsonKv();
  const env = workerEnv(kv, rollingBudget({ limit: 2 }));
  const approvedBody = readingBody('What should I understand before changing careers?', 'v53_safe_reading_01');
  const approved = await createPreview(env, approvedBody);
  assert.equal(approved.response.status, 200, JSON.stringify(approved.payload));

  const safetyBody = readingBody('Do the cards prove my cancer diagnosis?', 'v53_safety_reading_02');
  const safety = await createPreview(env, safetyBody);
  assert.equal(safety.response.status, 200, JSON.stringify(safety.payload));
  assert.equal(safety.payload.safety, true);
  assert.equal(safety.payload.offerAllowed, false);

  const approvedSessionResponse = await handleFreeSession(sessionRequest(), env);
  const approvedSession = await approvedSessionResponse.json();
  assert.equal(approvedSession.found, true, JSON.stringify(approvedSession));
  assert.equal(approvedSession.session.question, approvedBody.question);
  assert.equal(approvedSession.session.token, approved.payload.token);

  const currentResponse = await handleFreeSession(sessionRequest(VISITOR_ID, 'current'), env);
  const current = await currentResponse.json();
  assert.equal(current.found, true, JSON.stringify(current));
  assert.equal(current.session.question, safetyBody.question);
  assert.equal(current.session.approvalStatus, 'blocked');
  assert.equal(current.session.offerAllowed, false);
});

test('free-session rejects unknown lookup kinds before reading any continuation', async () => {
  const kv = jsonKv();
  const env = workerEnv(kv, rollingBudget({ limit: 1 }));
  const response = await handleFreeSession(sessionRequest(VISITOR_ID, 'newest-question'), env);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Unsupported free-session kind.',
    reason: 'INVALID_SESSION_KIND',
  });
});

test('PPF v53 openings are natural and question-anchored in EN/TR/ES/DE/PT without the old meta phrasing', () => {
  const fixtures = [
    ['en', 'What pattern should I understand before changing careers?', /^Looking at “What pattern/u],
    ['tr', 'Kariyer değiştirmeden önce hangi örüntüyü anlamalıyım?', /^“Kariyer değiştirmeden/u],
    ['es', '¿Qué patrón debo entender antes de cambiar de carrera?', /^Al mirar “¿Qué patrón/u],
    ['de', 'Welches Muster sollte ich verstehen, bevor ich den Beruf wechsle?', /^Beim Blick auf „Welches Muster/u],
    ['pt', 'Que padrão devo compreender antes de mudar de carreira?', /^Ao olhar para “Que padrão/u],
  ];

  for (const [lang, question, opening] of fixtures) {
    const fields = {
      ...readingBody(question, `v53_copy_${lang}`),
      lang,
      locale: lang,
    };
    const teaser = conciseDeterministicFreeTeaser(fields, lang);
    const audit = freeTeaserAudit(teaser, fields, 58);
    assert.equal(audit.ok, true, `${lang}: ${audit.reason}: ${teaser}`);
    assert.ok(audit.wordCount >= 180 && audit.wordCount <= 210, `${lang}: ${audit.wordCount}`);
    assert.match(teaser, opening, lang);
    assert.ok(teaser.includes(question), `${lang}: exact question missing`);
    assert.doesNotMatch(teaser, /For\s+[“"](?:[^”"]+),[”"]|this exact question|personal rather than generic|this question/iu, lang);
    assert.doesNotMatch(teaser, /jenerik|gen[eé]ric|generisch/iu, lang);
    assert.deepEqual(freePreviewPayload('v53-copy-token', teaser, fields).preview.reserved, {
      futureInterpretation: true,
      verdict: true,
      decidingCondition: true,
      timing: true,
      nextStep: true,
    });
  }
});
