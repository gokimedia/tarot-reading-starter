import assert from 'node:assert/strict';
import test from 'node:test';

import freeTarotFunnel, {
  FT_FUNNEL_VERSION,
  SPREADS,
  auditAnswer,
  deterministicAnswer,
  generateAnswer,
  parsePick,
  questionIsTurkish,
} from '../lib/free-tarot-funnel.mjs';

const CARDS3 = [
  { name: 'The Moon', orientation: 'upright' },
  { name: 'Two of Swords', orientation: 'reversed' },
  { name: 'The Sun', orientation: 'upright' },
];

function body(extra) {
  return {
    spread: 'three',
    question: 'Should I reach out to him, or wait?',
    visitorId: 'visitor_ft_test_000001',
    readingId: 'ft-test-1',
    category: 'contact',
    cards: CARDS3,
    ...extra,
  };
}

function modelResponse(content) {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 80 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('parsePick validates spread size, names and duplicates', () => {
  assert.equal(parsePick(body()).ok, true);
  assert.equal(parsePick(body({ spread: 'nope' })).ok, false);
  assert.equal(parsePick(body({ cards: CARDS3.slice(0, 2) })).ok, false);
  assert.equal(parsePick(body({ cards: [CARDS3[0], CARDS3[0], CARDS3[2]] })).ok, false);
  assert.equal(parsePick(body({ cards: [{ name: 'Fake Card' }, CARDS3[1], CARDS3[2]] })).ok, false);
  const celtic = parsePick(body({ spread: 'celtic', cards: CARDS3 }));
  assert.equal(celtic.ok, false);
  assert.equal(SPREADS.celtic.length, 10);
});

test('deterministic answers pass the audit for each lean band', () => {
  const parsed = parsePick(body());
  const conditional = deterministicAnswer(parsed.cards);
  assert.equal(auditAnswer(conditional, parsed.cards).ok, true, conditional);
  const open = deterministicAnswer(parsed.cards.map((c) => ({ ...c, reversed: false })));
  assert.equal(auditAnswer(open, parsed.cards).ok, true, open);
  const slowed = deterministicAnswer(parsed.cards.map((c) => ({ ...c, reversed: true })));
  assert.equal(auditAnswer(slowed, parsed.cards).ok, true, slowed);
});

test('auditAnswer rejects guarantees, foreign cards and dates', () => {
  const parsed = parsePick(body());
  assert.equal(auditAnswer('He is thinking about you and The Moon guarantees he will definitely text you back soon enough now.', parsed.cards).ok, false);
  assert.equal(auditAnswer('The spread leans yes: The Tower in the Situation slot points to contact if you leave space for it.', parsed.cards).ok, false);
  assert.equal(auditAnswer('The spread leans yes by March 12/03/2026 with The Moon carrying the contact forward if you wait for it.', parsed.cards).ok, false);
  assert.equal(auditAnswer('The lean is conditional: The Moon in the Situation slot keeps this open, and contact depends on one visible shift from you.', parsed.cards).ok, true);
});

test('generateAnswer serves audited model output then falls back', async () => {
  const parsed = parsePick(body());
  const env = { DEEPSEEK_DIRECT_API_KEY: 'test-only-key' };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => modelResponse(JSON.stringify({ answer: 'The spread leans not yet: Two of Swords reversed in Hidden influence shows the stalemate breaking first, and The Sun favours contact after that shift.' }));
    const served = await generateAnswer(parsed, env);
    assert.equal(served.source, 'model_initial');
    globalThis.fetch = async () => modelResponse('garbage');
    const fb = await generateAnswer(parsed, env);
    assert.equal(fb.source, 'deterministic_fallback');
    assert.equal(auditAnswer(fb.answer, parsed.cards).ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('router rejects foreign origins and serves health', async () => {
  const bad = await freeTarotFunnel.fetch(new Request('https://reading.deckaura.com/health', {
    headers: { Origin: 'https://evil.example' },
  }), {});
  assert.equal(bad.status, 403);
  const ok = await freeTarotFunnel.fetch(new Request('https://reading.deckaura.com/health', {
    headers: { Origin: 'https://deckaura.com' },
  }), {});
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.equal(data.module, FT_FUNNEL_VERSION);
});

test('Turkish questions get a Turkish deterministic answer that passes audit', () => {
  const parsed = parsePick(body({ question: 'Selami bana geri döner mi acaba?' }));
  assert.equal(questionIsTurkish(parsed.question), true);
  const answer = deterministicAnswer(parsed.cards, parsed.question);
  assert.match(answer, /eğilim|Açılım/i);
  assert.equal(auditAnswer(answer, parsed.cards).ok, true, answer);
  assert.equal(auditAnswer('Eğilim koşullu: The Moon önce değişmesi gereken tek şeyi işaret ediyor, dönüş buna bağlı görünüyor bu aralar.', parsed.cards).ok, true);
});
