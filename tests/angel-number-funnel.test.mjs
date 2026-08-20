import assert from 'node:assert/strict';
import test from 'node:test';

import angelNumberFunnel, {
  AN_FUNNEL_VERSION,
  AN_WORDS,
  auditPreview,
  deterministicPreview,
  displayKeyFor,
  parsePreviewPayload,
} from '../lib/angel-number-funnel.mjs';

function modelResponse(content, finishReason = 'stop', outputTokens = 120) {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 130, completion_tokens: outputTokens },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function anEnv({ allowClaim = true } = {}) {
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

function previewRequest(body) {
  return new Request('https://reading.deckaura.com/preview', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.88',
      'User-Agent': 'angel-number contract test',
    },
    body: JSON.stringify({
      number: '444',
      areaId: 'love',
      q1: 'We started talking again after a quiet month and I cannot tell if it is different this time.',
      visitorId: 'an_test_visitor_1',
      readingId: 'an2-test-reading-1',
      ...body,
    }),
  });
}

const GOOD_MODEL_JSON = JSON.stringify({
  situated: 'You noticed 444 while a connection was restarting, and stability here is not the rush of talking again but whether the effort stays mutual across ordinary weeks. What you are really watching is consistency, the part of this relationship that does not depend on a good day.',
  open: 'What would two dependable weeks in a row actually look like to you?',
});

test('displayKeyFor mirrors the design lookup (direct keys and reduced roots)', () => {
  assert.equal(displayKeyFor('444'), '444');
  assert.equal(displayKeyFor('1010'), '1010');
  assert.equal(displayKeyFor('000'), '000');
  // 29 -> 11 -> 2 (display layer has no master numbers, unlike the paid core-theme layer)
  assert.equal(displayKeyFor('29'), '222');
  assert.equal(displayKeyFor('78'), '666');
  assert.equal(displayKeyFor('1234'), '111');
  assert.equal(displayKeyFor('0'), '000');
  // 4444 -> 16 -> 7 -> '777'
  assert.equal(AN_WORDS[displayKeyFor('4444')], 'alignment');
});

test('parsePreviewPayload validates number and area', () => {
  assert.equal(parsePreviewPayload({ number: '444', areaId: 'love' }).ok, true);
  assert.equal(parsePreviewPayload({ number: '444', areaId: 'destiny' }).ok, false);
  assert.equal(parsePreviewPayload({ number: '44a4', areaId: 'love' }).ok, true, 'non-digits are stripped');
  assert.equal(parsePreviewPayload({ number: '1234567', areaId: 'love' }).ok, false);
  assert.equal(parsePreviewPayload({ number: '', areaId: 'love' }).ok, false);
  const derived = parsePreviewPayload({ number: '29', areaId: 'several' });
  assert.equal(derived.ok, true);
  assert.equal(derived.displayKey, '222');
  assert.equal(derived.derived, true);
  assert.equal(derived.word, 'balance');
});

test('auditPreview enforces anchors, bands and forbidden claims', () => {
  const payload = parsePreviewPayload({ number: '444', areaId: 'love', q1: 'We started talking again.' });
  const base = JSON.parse(GOOD_MODEL_JSON);
  assert.equal(auditPreview(base, payload), '');
  assert.match(auditPreview({ ...base, situated: 'Short words only here now.' }, payload), /word count/);
  assert.match(auditPreview({ ...base, situated: base.situated + ' He still loves you and will definitely return soon.' }, payload), /guarantee or private-state/);
  assert.match(auditPreview({ ...base, situated: base.situated.replace(/relationship|connection|consistency/gi, 'thing') }, payload), /anchor/);
  assert.match(auditPreview({ ...base, open: 'Trust the process and wait for a sign.' }, payload), /question mark/);
  assert.match(auditPreview({ ...base, open: 'Would upgrading to the $9.99 package help you decide faster today?' }, payload), /commerce/);
  assert.match(auditPreview({ ...base, situated: base.situated + ' Your 30-day alignment map will confirm it.' }, payload), /paid-tier/);
  assert.match(auditPreview({ ...base, situated: 'You keep seeing 444 in this relationship — and that matters.' }, payload), /dash/);
});

test('deterministic previews pass the audit for every area', () => {
  for (const areaId of ['love', 'person', 'career', 'change', 'spirit', 'several']) {
    const payload = parsePreviewPayload({ number: '444', areaId });
    const copy = deterministicPreview(payload);
    assert.equal(auditPreview(copy, payload), '', `${areaId}: ${auditPreview(copy, payload)}`);
    if (areaId !== 'several') assert.ok(copy.situated.includes('stability'), areaId);
    assert.ok(copy.open.endsWith('?'), areaId);
  }
});

test('preview serves a model result and commits the entitlement', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let modelCalls = 0;
  globalThis.fetch = async () => { modelCalls += 1; return modelResponse(GOOD_MODEL_JSON); };
  const env = anEnv();
  const response = await angelNumberFunnel.fetch(previewRequest(), env);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.funnelVersion, AN_FUNNEL_VERSION);
  assert.equal(body.servedSource, 'model_initial');
  assert.equal(body.number, '444');
  assert.equal(body.displayKey, '444');
  assert.equal(body.pvLabel, 'In your relationship context');
  assert.match(body.situated, /444/);
  assert.ok(body.open.endsWith('?'));
  assert.equal(modelCalls, 1);
  assert.equal(env.settles.length, 1);
});

test('preview falls back to the design templates when the model misbehaves twice', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => modelResponse('not json at all');
  const env = anEnv();
  const response = await angelNumberFunnel.fetch(previewRequest({ areaId: 'career', number: '777' }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.servedSource, 'deterministic_design_tables');
  const expected = deterministicPreview(parsePreviewPayload({ number: '777', areaId: 'career' }));
  assert.equal(body.situated, expected.situated);
  assert.equal(body.open, expected.open);
  assert.ok(body.situated.includes('alignment'));
  assert.equal(env.settles.length, 1);
});

test('preview rejects invalid payloads and enforces the free limit and origin gate', async () => {
  const env = anEnv();
  const bad = await angelNumberFunnel.fetch(previewRequest({ number: 'abcdef' }), env);
  assert.equal(bad.status, 422);
  const limited = await angelNumberFunnel.fetch(previewRequest(), anEnv({ allowClaim: false }));
  assert.equal(limited.status, 429);
  const badOrigin = await angelNumberFunnel.fetch(new Request('https://reading.deckaura.com/preview', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: '{}',
  }), env);
  assert.equal(badOrigin.status, 403);
  const health = await angelNumberFunnel.fetch(new Request('https://reading.deckaura.com/health', {
    headers: { Origin: 'https://deckaura.com' },
  }), env);
  assert.equal(health.status, 200);
});
