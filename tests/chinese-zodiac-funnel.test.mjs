import assert from 'node:assert/strict';
import test from 'node:test';

import chineseZodiacFunnel, {
  CZ_FUNNEL_VERSION,
  auditInsight,
  currentZodiac,
  deterministicInsight,
  pairRhythm,
  parseInsightPayload,
  westernSunSign,
  zodiacSign,
} from '../lib/chinese-zodiac-funnel.mjs';

function modelResponse(content, finishReason = 'stop', outputTokens = 120) {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 130, completion_tokens: outputTokens },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function czEnv({ allowClaim = true } = {}) {
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

function insightRequest(body) {
  return new Request('https://reading.deckaura.com/free-insight', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.88',
      'User-Agent': 'chinese-zodiac contract test',
    },
    body: JSON.stringify({
      dob: { y: 1991, m: 3, d: 4 },
      intent: 'love',
      chip: 'We keep repeating one argument',
      partner: { y: 1992, m: 6, d: 15 },
      visitorId: 'cz_test_visitor_1',
      readingId: 'zc-test-reading-1',
      ...body,
    }),
  });
}

const GOOD_MODEL_JSON = JSON.stringify({
  insight: 'Your Metal Goat pattern holds the peace long past its own boundary, then withdraws in one quiet move that surprises the other person. A Water Monkey partner keeps changing the route around that silence, so the same argument returns wearing different clothes.',
  next: 'Your full compatibility reading maps where this withdrawal meets their improvisation and what actually breaks the loop.',
});

test('zodiacSign applies the Chinese New Year cutoff and the 60-year cycle', () => {
  const goat = zodiacSign(1991, 3, 4);
  assert.equal(goat.full, 'Yin Metal Goat');
  assert.equal(goat.zy, 1991);
  assert.equal(goat.before, false);
  // Jan 15 1990 falls before CNY (Jan 27 1990) -> 1989 Yin Earth Snake.
  const snake = zodiacSign(1990, 1, 15);
  assert.equal(snake.full, 'Yin Earth Snake');
  assert.equal(snake.zy, 1989);
  assert.equal(snake.before, true);
  const horse = zodiacSign(1990, 6, 1);
  assert.equal(horse.full, 'Yang Metal Horse');
  // 2026 is the Yang Fire Horse year after CNY (Feb 17 2026).
  assert.equal(zodiacSign(2026, 8, 20).full, 'Yang Fire Horse');
  assert.equal(currentZodiac(new Date(2026, 7, 20)).full, 'Yang Fire Horse');
});

test('pairRhythm mirrors the design compatibility bands', () => {
  assert.equal(pairRhythm('Rat', 'Dragon'), 'Strong');
  assert.equal(pairRhythm('Rat', 'Ox'), 'Strong');
  assert.equal(pairRhythm('Rat', 'Horse'), 'Challenging');
  assert.equal(pairRhythm('Goat', 'Horse'), 'Strong');
  assert.equal(pairRhythm('Goat', 'Ox'), 'Challenging');
  assert.equal(pairRhythm('Rat', 'Monkey'), 'Strong');
  assert.equal(pairRhythm('Rat', 'Pig'), 'Mixed');
  assert.equal(westernSunSign(3, 4), 'Pisces');
  assert.equal(westernSunSign(12, 25), 'Capricorn');
});

test('parseInsightPayload validates dates, intent and partner', () => {
  assert.equal(parseInsightPayload({ dob: { y: 1991, m: 3, d: 4 }, intent: 'self' }).ok, true);
  assert.equal(parseInsightPayload({ dob: { y: 1919, m: 3, d: 4 }, intent: 'self' }).ok, false);
  assert.equal(parseInsightPayload({ dob: { y: 1991, m: 2, d: 30 }, intent: 'self' }).ok, false);
  assert.equal(parseInsightPayload({ dob: { y: 1991, m: 3, d: 4 }, intent: 'destiny' }).ok, false);
  assert.equal(parseInsightPayload({ dob: { y: 1991, m: 3, d: 4 }, intent: 'love', partner: { y: 1800, m: 1, d: 1 } }).ok, false);
  const full = parseInsightPayload({ dob: { y: 1991, m: 3, d: 4 }, intent: 'love', partner: { y: 1992, m: 6, d: 15 } });
  assert.equal(full.ok, true);
  assert.equal(full.sign.full, 'Yin Metal Goat');
  assert.equal(full.partnerSign.full, 'Yang Water Monkey');
  assert.equal(full.western, 'Pisces');
});

test('auditInsight enforces anchors, bands and forbidden claims', () => {
  const payload = parseInsightPayload({ dob: { y: 1991, m: 3, d: 4 }, intent: 'love', chip: 'We keep repeating one argument', partner: { y: 1992, m: 6, d: 15 } });
  const base = JSON.parse(GOOD_MODEL_JSON);
  assert.equal(auditInsight(base, payload), '');
  assert.match(auditInsight({ ...base, insight: base.insight.replace(/Goat/g, 'sign') }, payload), /animal name/);
  assert.match(auditInsight({ ...base, insight: base.insight.replace(/Metal/g, 'strong').replace(/Yin/g, 'soft') }, payload), /element and the polarity/);
  assert.match(auditInsight({ ...base, insight: base.insight + ' They still love you and will definitely return.' }, payload), /guarantee or private-state/);
  assert.match(auditInsight({ ...base, next: 'The written reading resolves what actually breaks the loop for you.' }, payload), /Your full/);
  assert.match(auditInsight({ ...base, insight: 'Your Metal Goat pattern — holds back.' }, payload), /dash/);
});

test('deterministic fallbacks pass the audit for every intent', () => {
  for (const intent of ['self', 'love', 'career', 'year']) {
    const payload = parseInsightPayload({ dob: { y: 1991, m: 3, d: 4 }, intent });
    const copy = deterministicInsight(payload);
    assert.equal(auditInsight(copy, payload), '', `${intent}: ${auditInsight(copy, payload)}`);
    assert.ok(copy.insight.includes('Goat'), intent);
  }
});

test('free-insight serves a model insight and commits the entitlement', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let modelCalls = 0;
  globalThis.fetch = async () => { modelCalls += 1; return modelResponse(GOOD_MODEL_JSON); };
  const env = czEnv();
  const response = await chineseZodiacFunnel.fetch(insightRequest(), env);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.funnelVersion, CZ_FUNNEL_VERSION);
  assert.equal(body.servedSource, 'model_initial');
  assert.equal(body.sign, 'Yin Metal Goat');
  assert.match(body.insight, /Metal Goat/);
  assert.match(body.next, /^Your full/);
  assert.equal(modelCalls, 1);
  assert.equal(env.settles.length, 1);
});

test('free-insight falls back to the design tables when the model misbehaves twice', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => modelResponse('not json at all');
  const env = czEnv();
  const response = await chineseZodiacFunnel.fetch(insightRequest({ partner: null }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.servedSource, 'deterministic_design_tables');
  const expected = deterministicInsight(parseInsightPayload({ dob: { y: 1991, m: 3, d: 4 }, intent: 'love' }));
  assert.equal(body.insight, expected.insight);
  assert.equal(body.next, expected.next);
  assert.equal(env.settles.length, 1);
});

test('free-insight rejects invalid payloads and enforces the free limit', async () => {
  const env = czEnv();
  const bad = await chineseZodiacFunnel.fetch(insightRequest({ dob: { y: 1991, m: 2, d: 30 } }), env);
  assert.equal(bad.status, 422);
  const limited = await chineseZodiacFunnel.fetch(insightRequest(), czEnv({ allowClaim: false }));
  assert.equal(limited.status, 429);
  const badOrigin = await chineseZodiacFunnel.fetch(new Request('https://reading.deckaura.com/free-insight', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: '{}',
  }), env);
  assert.equal(badOrigin.status, 403);
});
