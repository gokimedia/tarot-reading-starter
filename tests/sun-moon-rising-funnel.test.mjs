import assert from 'node:assert/strict';
import test from 'node:test';

import sunMoonRisingFunnel, {
  SMR_FUNNEL_VERSION,
  auditSynthesis,
  deterministicSynthesis,
  parseSynthesisPayload,
} from '../lib/sun-moon-rising-funnel.mjs';

function modelResponse(content) {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 130, completion_tokens: 110 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function smrEnv({ allowClaim = true } = {}) {
  const settles = [];
  return {
    settles,
    ENTITLEMENT_PEPPER: 'test-only-entitlement-pepper',
    DEEPSEEK_DIRECT_API_KEY: 'test-only-key',
    AI_BUDGETS: { claim: async () => ({ allowed: true }), settle: async () => ({ allowed: true }) },
    FREE_READING_BUDGETS: {
      claim: async () => (allowClaim ? { allowed: true } : { allowed: false, reason: 'visitor_cap', nextAt: Date.now() + 60_000 }),
      settle: async (...args) => { settles.push(args); return { allowed: true }; },
    },
  };
}

function insightRequest(body) {
  return new Request('https://reading.deckaura.com/insight', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.92',
      'User-Agent': 'smr contract test',
    },
    body: JSON.stringify({
      sun: 'Cancer', moon: 'Scorpio', rising: 'Capricorn', timeConf: 'exact', focus: 'love',
      visitorId: 'rs2_test_visitor_000001', readingId: 'rs2-test-reading-1',
      ...body,
    }),
  });
}

const GOOD_MODEL_JSON = JSON.stringify({
  synthesis: 'Your Cancer core keeps reaching for closeness worth protecting, while your Scorpio side waits for certainty before letting anyone near. With Capricorn meeting the world first, people read self-sufficiency where you feel longing, and in love that gap quietly shapes who approaches you.',
  note: 'This free synthesis describes the parts of your chart; how they negotiate with each other under pressure is a deeper layer.',
});

test('parseSynthesisPayload validates signs, timeConf and rising consistency', () => {
  assert.equal(parseSynthesisPayload({ sun: 'Cancer', moon: 'Scorpio', rising: 'Capricorn', timeConf: 'exact', focus: 'love' }).ok, true);
  assert.equal(parseSynthesisPayload({ sun: 'Cancerr', moon: 'Scorpio', rising: 'Capricorn', timeConf: 'exact', focus: 'love' }).ok, false);
  assert.equal(parseSynthesisPayload({ sun: 'Cancer', moon: 'Scorpio', timeConf: 'unknown', focus: 'pattern' }).ok, true);
  assert.equal(parseSynthesisPayload({ sun: 'Cancer', moon: 'Scorpio', rising: 'Capricorn', timeConf: 'unknown', focus: 'love' }).ok, false, 'rising without a birth time must be rejected');
  assert.equal(parseSynthesisPayload({ sun: 'Cancer', moon: 'Scorpio', timeConf: 'exact', focus: 'love' }).ok, false, 'a birth time without a rising must be rejected');
  assert.equal(parseSynthesisPayload({ sun: 'Cancer', moon: 'Scorpio', rising: 'Capricorn', timeConf: 'exact', focus: 'destiny' }).ok, false);
});

test('auditSynthesis enforces sign naming, honesty and leak rules', () => {
  const payload = parseSynthesisPayload({ sun: 'Cancer', moon: 'Scorpio', rising: 'Capricorn', timeConf: 'exact', focus: 'love' });
  const base = JSON.parse(GOOD_MODEL_JSON);
  assert.equal(auditSynthesis(base, payload), '');
  assert.match(auditSynthesis({ ...base, synthesis: base.synthesis.replace(/Cancer|Scorpio|Capricorn/g, 'your sign') }, payload), /fewer than two/);
  assert.match(auditSynthesis({ ...base, synthesis: base.synthesis + ' They still love you and will definitely come back.' }, payload), /guarantee or private-state/);
  assert.match(auditSynthesis({ ...base, synthesis: base.synthesis + ' Your blueprint will map the full loop.' }, payload), /paid-tier/);
  assert.match(auditSynthesis({ ...base, note: 'Nice.' }, payload), /word count/);
  assert.match(auditSynthesis({ ...base, synthesis: 'Cancer and Scorpio — a deep pairing that waits.' }, payload), /dash/);
});

test('deterministic synthesis passes the audit with and without a rising sign', () => {
  const withRising = parseSynthesisPayload({ sun: 'Leo', moon: 'Pisces', rising: 'Gemini', timeConf: 'exact', focus: 'self' });
  const noRising = parseSynthesisPayload({ sun: 'Virgo', moon: 'Pisces', timeConf: 'unknown', focus: 'pattern' });
  for (const payload of [withRising, noRising]) {
    assert.equal(payload.ok, true);
    const copy = deterministicSynthesis(payload);
    assert.equal(auditSynthesis(copy, payload), '', auditSynthesis(copy, payload));
  }
  assert.match(deterministicSynthesis(noRising).synthesis, /without your birth time/);
});

test('insight serves a model synthesis and commits the entitlement', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let modelCalls = 0;
  globalThis.fetch = async () => { modelCalls += 1; return modelResponse(GOOD_MODEL_JSON); };
  const env = smrEnv();
  const response = await sunMoonRisingFunnel.fetch(insightRequest(), env);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.funnelVersion, SMR_FUNNEL_VERSION);
  assert.equal(body.servedSource, 'model_initial');
  assert.match(body.synthesis, /Cancer/);
  assert.equal(modelCalls, 1);
  assert.equal(env.settles.length, 1);
});

test('insight falls back to the design formula when the model misbehaves twice', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => modelResponse('not json at all');
  const env = smrEnv();
  const response = await sunMoonRisingFunnel.fetch(insightRequest({ rising: undefined, timeConf: 'unknown', focus: 'pattern' }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.servedSource, 'design_formula');
  const expected = deterministicSynthesis(parseSynthesisPayload({ sun: 'Cancer', moon: 'Scorpio', timeConf: 'unknown', focus: 'pattern' }));
  assert.equal(body.synthesis, expected.synthesis);
  assert.equal(env.settles.length, 1);
});

test('insight rejects invalid payloads and enforces the free limit and origin gate', async () => {
  const env = smrEnv();
  const bad = await sunMoonRisingFunnel.fetch(insightRequest({ sun: 'Dragon' }), env);
  assert.equal(bad.status, 422);
  const limited = await sunMoonRisingFunnel.fetch(insightRequest(), smrEnv({ allowClaim: false }));
  assert.equal(limited.status, 429);
  const badOrigin = await sunMoonRisingFunnel.fetch(new Request('https://reading.deckaura.com/insight', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: '{}',
  }), env);
  assert.equal(badOrigin.status, 403);
  const health = await sunMoonRisingFunnel.fetch(new Request('https://reading.deckaura.com/health', {
    headers: { Origin: 'https://deckaura.com' },
  }), env);
  assert.equal(health.status, 200);
});
