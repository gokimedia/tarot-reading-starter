import assert from 'node:assert/strict';
import test from 'node:test';

import runeFunnel, {
  auditCastReading,
  deterministicCastReading,
  parseCastPayload,
  RUNE_FUNNEL_VERSION,
} from '../lib/rune-funnel.mjs';

function modelResponse(content, finishReason = 'stop', outputTokens = 200) {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 150, completion_tokens: outputTokens },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function runeEnv({ allowClaim = true } = {}) {
  const settles = [];
  return {
    settles,
    ENTITLEMENT_PEPPER: 'test-only-entitlement-pepper',
    DEEPSEEK_DIRECT_API_KEY: 'test-only-key',
    AI_BUDGETS: {
      claim: async () => ({ allowed: true }),
      settle: async () => ({ allowed: true }),
    },
    FREE_READING_BUDGETS: {
      claim: async () => (allowClaim
        ? { allowed: true }
        : { allowed: false, reason: 'visitor_cap', nextAt: Date.now() + 60_000 }),
      settle: async (...args) => { settles.push(args); return { allowed: true }; },
    },
  };
}

const CAST_3 = [
  { name: 'Fehu', orientation: 'upright' },
  { name: 'Nauthiz', orientation: 'reversed' },
  { name: 'Dagaz', orientation: 'upright' },
];

function castRequest(body) {
  return new Request('https://reading.deckaura.com/free-cast', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.77',
      'User-Agent': 'rune-funnel contract test',
    },
    body: JSON.stringify({
      focus: 'career',
      answerKind: 'focused',
      timeframe: 'Next 30 days',
      question: 'Is it time to leave my safe job for the startup offer?',
      visitorId: 'rune_test_visitor_1',
      readingId: 'rune_test_reading_1',
      cast: CAST_3,
      ...body,
    }),
  });
}

const GOOD_MODEL_JSON = JSON.stringify({
  theme: 'Fehu upright in the Anchor slot grounds this in what you have genuinely earned and the effort of keeping it safe. Nauthiz reversed in Gate presses on that security with a constraint you keep resisting instead of reading, and Dagaz upright waits in Direction while the present still holds your attention.',
  reflection: 'What would the startup have to prove in the next month for the risk to feel like yours?',
  step: 'For one week, track which tasks at your current job still teach you something and which only protect the salary, then compare the two lists.',
  teaser: 'whether the safety you are protecting is still an asset or has quietly become the cost',
});

test('parseCastPayload validates spread size and rune names', () => {
  const bad = parseCastPayload({ focus: 'career', answerKind: 'focused', cast: [{ name: 'NotARune' }] });
  assert.equal(bad.ok, false);
  const wrongCount = parseCastPayload({ focus: 'career', answerKind: 'compass', cast: CAST_3 });
  assert.equal(wrongCount.ok, false);
  const good = parseCastPayload({ focus: 'career', answerKind: 'focused', cast: CAST_3 });
  assert.equal(good.ok, true);
  assert.deepEqual(good.cast.map((r) => r.slot), ['Anchor', 'Gate', 'Direction']);
});

test('auditCastReading rejects verdicts, dashes and missing rune anchors', () => {
  const payload = parseCastPayload({ focus: 'career', answerKind: 'focused', cast: CAST_3 });
  const base = JSON.parse(GOOD_MODEL_JSON);
  assert.equal(auditCastReading({ ...base, step: base.step }, payload), '');
  assert.match(auditCastReading({ ...base, step: 'You should leave the job now.' }, payload), /reserved verdict/);
  assert.match(auditCastReading({ ...base, theme: base.theme.replace(/Fehu|Nauthiz/g, 'it') }, payload), /mentioned only/);
  assert.match(auditCastReading({ ...base, teaser: 'the missing piece is a decision' }, payload), /teaser outside contract/);
  assert.match(auditCastReading({ ...base, reflection: 'Think about it — carefully?' }, payload), /dash/);
});

test('free-cast serves a model reading and commits the entitlement', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let modelCalls = 0;
  globalThis.fetch = async () => { modelCalls += 1; return modelResponse(GOOD_MODEL_JSON); };
  const env = runeEnv();
  const response = await runeFunnel.fetch(castRequest(), env);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.funnelVersion, RUNE_FUNNEL_VERSION);
  assert.equal(body.servedSource, 'model_initial');
  assert.match(body.theme, /Fehu upright/);
  assert.match(body.teaser, /^whether /);
  assert.equal(modelCalls, 1);
  assert.equal(env.settles.length, 1);
});

test('free-cast falls back to the design tables when the model misbehaves twice', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => modelResponse('not json at all');
  const env = runeEnv();
  const response = await runeFunnel.fetch(castRequest(), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.servedSource, 'deterministic_design_tables');
  const expected = deterministicCastReading(parseCastPayload({ focus: 'career', answerKind: 'focused', cast: CAST_3 }));
  assert.equal(body.reflection, expected.reflection);
  assert.equal(body.safeStep, expected.safeStep);
  assert.match(body.theme, /Fehu upright in Anchor/);
  assert.equal(env.settles.length, 1, 'fallback still consumes the free entitlement');
});

test('free-cast enforces the free entitlement and the origin gate', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error('model must not be called'); };

  const limited = await runeFunnel.fetch(castRequest(), runeEnv({ allowClaim: false }));
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, 'free_limit_reached');

  const foreign = new Request('https://reading.deckaura.com/free-cast', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: '{}',
  });
  const blocked = await runeFunnel.fetch(foreign, runeEnv());
  assert.equal(blocked.status, 403);

  const invalid = await runeFunnel.fetch(castRequest({ cast: [{ name: 'Fehu' }] }), runeEnv());
  assert.equal(invalid.status, 422);
});

test('health endpoint answers inside the allowed origin', async () => {
  const response = await runeFunnel.fetch(new Request('https://reading.deckaura.com/health', {
    headers: { Origin: 'https://deckaura.com' },
  }), runeEnv());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.funnel, RUNE_FUNNEL_VERSION);
});
