import assert from 'node:assert/strict';
import test from 'node:test';

import dreamFunnel, {
  DREAM_FUNNEL_VERSION,
  auditSnapshot,
  detectSymbols,
  detectTheme,
  deterministicSnapshot,
  parseDreamPayload,
} from '../lib/dream-funnel.mjs';

function modelResponse(content, finishReason = 'stop', outputTokens = 180) {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 200, completion_tokens: outputTokens },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function dreamEnv({ allowClaim = true } = {}) {
  const settles = [];
  return {
    settles,
    ENTITLEMENT_PEPPER: 'test-only-entitlement-pepper',
    DEEPSEEK_DIRECT_API_KEY: 'test-only-key',
    AI_BUDGETS: { claim: async () => ({ allowed: true }), settle: async () => ({ allowed: true }) },
    FREE_READING_BUDGETS: {
      claim: async () => (allowClaim
        ? { allowed: true }
        : { allowed: false, reason: 'visitor_cap', nextAt: Date.now() + 60_000 }),
      settle: async (...args) => { settles.push(args); return { allowed: true }; },
    },
  };
}

const DREAM = 'I was in a house that was supposed to be mine, but the hallway kept going. Every door I opened led to a room I did not remember, and water was coming in under one of them. Someone I used to be close to was calling me from downstairs and I could not get back to the stairs. I woke up before I found the way out.';

function dreamRequest(body) {
  return new Request('https://reading.deckaura.com/free-interpretation', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.66',
      'User-Agent': 'dream funnel contract test',
    },
    body: JSON.stringify({
      dream: DREAM,
      emotion: 'Anxious',
      recurrence: 'Recurring',
      visitorId: 'dream_test_visitor_1',
      readingId: 'di-test-reading-1',
      ...body,
    }),
  });
}

const GOOD_MODEL_JSON = JSON.stringify({
  theme: 'Attachment & Unfinished Feeling',
  clearestMeaning: 'The hallway that keeps going is your own sense of unfinished business, and the voice from downstairs belongs to what was left open with that person. You are not lost in the house, you are circling something you have not answered yet.',
  emotionalCenter: 'The anxiety sits exactly at the stairs you could not reach, the point where going back toward them stopped being possible in the dream.',
  symbolRelationship: 'The unknown rooms and the water under the door work together: memory keeps opening space while feeling seeps in underneath, faster than you can check each room.',
  endingMeaning: 'Waking before you found the way out keeps the question open. The dream did not end badly, it simply refused to decide for you.',
  sittingQuestion: 'If that voice from downstairs could ask you one thing, what would you least want it to be?',
});

test('parseDreamPayload validates length, emotion and recurrence', () => {
  assert.equal(parseDreamPayload({ dream: DREAM, emotion: 'Anxious', recurrence: 'Recurring' }).ok, true);
  assert.equal(parseDreamPayload({ dream: 'too short', emotion: 'Anxious' }).ok, false);
  assert.equal(parseDreamPayload({ dream: Array(430).fill('word').join(' ') }).ok, false);
  const fallbacks = parseDreamPayload({ dream: DREAM, emotion: 'Angry', recurrence: 'Sometimes' });
  assert.equal(fallbacks.emotion, 'Other');
  assert.equal(fallbacks.recurrence, 'First time');
});

test('design engine detects symbols and themes like the page', () => {
  assert.deepEqual(detectSymbols(DREAM), ['Water', 'An ex-partner', 'A house with unknown rooms']);
  assert.equal(detectTheme(DREAM, 'Anxious'), 'attachment');
  assert.equal(detectTheme('I dreamed I was flying over water and it felt free', 'Calm'), 'change');
  assert.equal(detectTheme('my grandmother who passed away visited me at her funeral', 'Sad'), 'loss');
});

test('deterministic snapshot passes the audit', () => {
  const payload = parseDreamPayload({ dream: DREAM, emotion: 'Anxious', recurrence: 'Recurring' });
  const snap = deterministicSnapshot(payload);
  assert.equal(auditSnapshot(snap, payload), '', auditSnapshot(snap, payload));
  assert.equal(snap.theme, 'Attachment & Unfinished Feeling');
});

test('auditSnapshot rejects predictions, diagnoses and off-list themes', () => {
  const payload = parseDreamPayload({ dream: DREAM, emotion: 'Anxious', recurrence: 'Recurring' });
  const base = JSON.parse(GOOD_MODEL_JSON);
  assert.equal(auditSnapshot(base, payload), '');
  assert.match(auditSnapshot({ ...base, theme: 'Spooky Omens' }, payload), /canonical/);
  assert.match(auditSnapshot({ ...base, endingMeaning: base.endingMeaning + ' This means he is cheating on you.' }, payload), /prediction, diagnosis or private-state/);
  assert.match(auditSnapshot({ ...base, sittingQuestion: 'Why?' }, payload), /sittingQuestion/);
  assert.match(auditSnapshot({ ...base, clearestMeaning: 'Too short to count here.' }, payload), /clearestMeaning word count/);
});

test('free-interpretation serves a model snapshot and commits the entitlement', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return modelResponse(GOOD_MODEL_JSON); };
  const env = dreamEnv();
  const response = await dreamFunnel.fetch(dreamRequest(), env);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.funnelVersion, DREAM_FUNNEL_VERSION);
  assert.equal(body.servedSource, 'model_initial');
  assert.equal(body.theme, 'Attachment & Unfinished Feeling');
  assert.match(body.sittingQuestion, /\?$/);
  assert.equal(calls, 1);
  assert.equal(env.settles.length, 1);
});

test('free-interpretation falls back to the design engine when the model misbehaves', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => modelResponse('not json');
  const env = dreamEnv();
  const response = await dreamFunnel.fetch(dreamRequest(), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.servedSource, 'deterministic_design_engine');
  const expected = deterministicSnapshot(parseDreamPayload({ dream: DREAM, emotion: 'Anxious', recurrence: 'Recurring' }));
  assert.equal(body.clearestMeaning, expected.clearestMeaning);
  assert.equal(env.settles.length, 1);
});

test('free-interpretation enforces validation, limits and origin', async () => {
  const bad = await dreamFunnel.fetch(dreamRequest({ dream: 'tiny' }), dreamEnv());
  assert.equal(bad.status, 422);
  const limited = await dreamFunnel.fetch(dreamRequest(), dreamEnv({ allowClaim: false }));
  assert.equal(limited.status, 429);
  const badOrigin = await dreamFunnel.fetch(new Request('https://reading.deckaura.com/free-interpretation', {
    method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}',
  }), dreamEnv());
  assert.equal(badOrigin.status, 403);
});
