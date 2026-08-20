import assert from 'node:assert/strict';
import test from 'node:test';

import tarotTimingFunnel, {
  TT_DECK,
  TT_FUNNEL_VERSION,
  auditInsight,
  deterministicInsight,
  parseInsightPayload,
} from '../lib/tarot-timing-funnel.mjs';

function modelResponse(content, finishReason = 'stop', outputTokens = 120) {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 140, completion_tokens: outputTokens },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function ttEnv({ allowClaim = true } = {}) {
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

const CARDS = [
  { name: 'Eight of Wands', orientation: 'Upright', role: 'Current Momentum' },
  { name: 'Two of Swords', orientation: 'Reversed', role: 'Timing Signal' },
  { name: 'The Star', orientation: 'Upright', role: 'Pace Changer' },
];

function insightRequest(body) {
  return new Request('https://reading.deckaura.com/insight', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.90',
      'User-Agent': 'tarot-timing contract test',
    },
    body: JSON.stringify({
      focus: 'contact',
      horizon: '3m',
      question: 'He stopped replying about three weeks ago. When could he realistically get back in touch?',
      eventDef: 'A real message from him, not a story view.',
      cards: CARDS,
      visitorId: 'tt_test_visitor_000001',
      readingId: 'tt2-test-reading-1',
      ...body,
    }),
  });
}

const GOOD_MODEL_JSON = JSON.stringify({
  lensNote: 'Eight of Wands says the channel itself moves quickly once something is actually sent, while the reversed Two of Swords shows the pause is a suspended decision rather than absence. Inside your 3 month horizon the signal leans early to middle, conditional on that avoidance ending rather than on any date.',
  watchFor: 'Watch for a small direct signal from him, such as a reply or reaction that invites an answer.',
});

test('the canonical deck holds all 78 cards', () => {
  assert.equal(TT_DECK.length, 78);
  assert.ok(TT_DECK.includes('The Fool'));
  assert.ok(TT_DECK.includes('Queen of Pentacles'));
  assert.equal(new Set(TT_DECK).size, 78);
});

test('parseInsightPayload validates focus, horizon, question and cards', () => {
  assert.equal(parseInsightPayload({ focus: 'contact', horizon: '3m', question: 'When could he get back in touch?', cards: CARDS }).ok, true);
  assert.equal(parseInsightPayload({ focus: 'destiny', horizon: '3m', question: 'When could he get back in touch?', cards: CARDS }).ok, false);
  assert.equal(parseInsightPayload({ focus: 'contact', horizon: '2y', question: 'When could he get back in touch?', cards: CARDS }).ok, false);
  assert.equal(parseInsightPayload({ focus: 'contact', horizon: '3m', question: 'Когда?', cards: CARDS }).ok, false);
  assert.equal(parseInsightPayload({ focus: 'contact', horizon: '3m', question: 'When could he get back in touch?', cards: CARDS.slice(0, 2) }).ok, false);
  const badName = [{ ...CARDS[0], name: 'Nine of Cups Deluxe' }, CARDS[1], CARDS[2]];
  assert.equal(parseInsightPayload({ focus: 'contact', horizon: '3m', question: 'When could he get back in touch?', cards: badName }).ok, false);
  const badRole = [CARDS[0], { ...CARDS[1], role: 'Signal' }, CARDS[2]];
  assert.equal(parseInsightPayload({ focus: 'contact', horizon: '3m', question: 'When could he get back in touch?', cards: badRole }).ok, false);
  const dupes = [CARDS[0], { ...CARDS[1], name: 'Eight of Wands' }, CARDS[2]];
  assert.equal(parseInsightPayload({ focus: 'contact', horizon: '3m', question: 'When could he get back in touch?', cards: dupes }).ok, false);
});

test('auditInsight enforces the conditional-window rules', () => {
  const payload = parseInsightPayload({ focus: 'contact', horizon: '3m', question: 'When could he realistically get back in touch?', cards: CARDS });
  const base = JSON.parse(GOOD_MODEL_JSON);
  assert.equal(auditInsight(base, payload), '');
  assert.match(auditInsight({ ...base, lensNote: base.lensNote + ' He will definitely reach out.' }, payload), /guarantee/);
  assert.match(auditInsight({ ...base, lensNote: base.lensNote.replace('Inside your 3 month horizon', 'Within 10 days') }, payload), /calendar or countdown/);
  assert.match(auditInsight({ ...base, lensNote: base.lensNote + ' Your milestone plan will confirm it.' }, payload), /paid-tier/);
  assert.match(auditInsight({ ...base, lensNote: base.lensNote.replace(/Eight of Wands|Two of Swords/g, 'the cards') }, payload), /name any supplied card/);
  assert.match(auditInsight({ ...base, watchFor: 'Trust that it comes.' }, payload), /word count/);
  assert.match(auditInsight({ ...base, watchFor: base.watchFor.replace('.', '?') }, payload), /period|statement/);
  assert.match(auditInsight({ ...base, watchFor: 'Watch for whether he replies with a real question inside the window?.' }, payload), /statement/);
  assert.match(auditInsight({ ...base, lensNote: 'Eight of Wands moves fast — trust the pace of the window.' }, payload), /dash/);
});

test('deterministic insight passes the audit across foci, horizons and suits', () => {
  const variants = [
    { focus: 'contact', horizon: '14d', cards: CARDS },
    { focus: 'career', horizon: '12m', cards: [
      { name: 'Ten of Pentacles', orientation: 'Reversed', role: 'Current Momentum' },
      { name: 'Justice', orientation: 'Upright', role: 'Timing Signal' },
      { name: 'Knight of Cups', orientation: 'Upright', role: 'Pace Changer' },
    ] },
    { focus: 'decision', horizon: '30d', cards: [
      { name: 'The Tower', orientation: 'Upright', role: 'Current Momentum' },
      { name: 'Six of Swords', orientation: 'Upright', role: 'Timing Signal' },
      { name: 'Ace of Wands', orientation: 'Reversed', role: 'Pace Changer' },
    ] },
  ];
  for (const variant of variants) {
    const payload = parseInsightPayload({ question: 'When will I have enough clarity to decide about this move?', ...variant });
    assert.equal(payload.ok, true);
    const copy = deterministicInsight(payload);
    assert.equal(auditInsight(copy, payload), '', `${variant.focus}: ${auditInsight(copy, payload)}`);
    assert.ok(copy.lensNote.includes(variant.cards[0].name));
  }
});

test('insight serves a model result and commits the entitlement', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let modelCalls = 0;
  globalThis.fetch = async () => { modelCalls += 1; return modelResponse(GOOD_MODEL_JSON); };
  const env = ttEnv();
  const response = await tarotTimingFunnel.fetch(insightRequest(), env);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.funnelVersion, TT_FUNNEL_VERSION);
  assert.equal(body.servedSource, 'model_initial');
  assert.match(body.lensNote, /Eight of Wands/);
  assert.ok(body.watchFor.endsWith('.'));
  assert.equal(modelCalls, 1);
  assert.equal(env.settles.length, 1);
});

test('insight falls back to the design engine when the model misbehaves twice', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => modelResponse('not json at all');
  const env = ttEnv();
  const response = await tarotTimingFunnel.fetch(insightRequest(), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.servedSource, 'design_engine');
  const expected = deterministicInsight(parseInsightPayload({ focus: 'contact', horizon: '3m', question: 'He stopped replying about three weeks ago. When could he realistically get back in touch?', cards: CARDS }));
  assert.equal(body.lensNote, expected.lensNote);
  assert.equal(env.settles.length, 1);
});

test('insight rejects invalid payloads and enforces the free limit and origin gate', async () => {
  const env = ttEnv();
  const bad = await tarotTimingFunnel.fetch(insightRequest({ cards: [] }), env);
  assert.equal(bad.status, 422);
  const limited = await tarotTimingFunnel.fetch(insightRequest(), ttEnv({ allowClaim: false }));
  assert.equal(limited.status, 429);
  const badOrigin = await tarotTimingFunnel.fetch(new Request('https://reading.deckaura.com/insight', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: '{}',
  }), env);
  assert.equal(badOrigin.status, 403);
  const health = await tarotTimingFunnel.fetch(new Request('https://reading.deckaura.com/health', {
    headers: { Origin: 'https://deckaura.com' },
  }), env);
  assert.equal(health.status, 200);
});
