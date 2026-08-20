import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POSITIONS,
  auditAnswer,
  deterministicAnswer,
  SEVEN_CARD_FUNNEL_VERSION,
  auditInsights,
  deterministicInsights,
  generateInsights,
  parseSevenCards,
} from '../lib/seven-card-funnel.mjs';

const SIGNALS = 'Past: Six of Cups Upright; Present: Two of Swords Upright; Hidden Influences: The High Priestess Upright; Obstacle: Knight of Wands Reversed; External Influences: Three of Swords Upright; Advice: Temperance Upright; Likely Outcome: Wheel of Fortune Upright';

function modelResponse(content, finishReason = 'stop', outputTokens = 200) {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 150, completion_tokens: outputTokens },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const GOOD_ANSWER = 'The spread leans yes if the pattern changes: Wheel of Fortune in the Likely Outcome favours movement, but only after the stop-start energy settles.';
const GOOD_INSIGHTS = JSON.stringify({ answer: GOOD_ANSWER, insights: [
  {
    label: 'The core pattern',
    lead: 'Something from earlier still sets the terms.',
    body: 'Six of Cups in the Past and Two of Swords in the Present place your question inside a familiar loop where nothing has been decided yet, only postponed.',
  },
  {
    label: 'The deciding condition',
    lead: 'The outcome moves with one condition.',
    body: 'Wheel of Fortune in the Likely Outcome turns on the stop-start energy Knight of Wands reversed names in the Obstacle slot, not on how strongly anyone feels.',
  },
  {
    label: 'What you can influence',
    lead: 'Temperance points to pace, not pressure.',
    body: 'Temperance in the Advice position marks one measured, clearly worded exchange as the part of this that is genuinely yours to choose.',
  },
]});

test('parseSevenCards accepts the canonical signals string and rejects drift', () => {
  const cards = parseSevenCards(SIGNALS);
  assert.ok(cards);
  assert.equal(cards.length, 7);
  assert.deepEqual(cards.map((card) => card.position), POSITIONS);
  assert.equal(cards[3].reversed, true);
  assert.equal(parseSevenCards(SIGNALS.replace('Hidden Influences', 'Hidden influence')), null);
  assert.equal(parseSevenCards(SIGNALS.replace('Six of Cups', 'Not A Card')), null);
  assert.equal(parseSevenCards(SIGNALS.replace('Two of Swords', 'Six of Cups')), null, 'duplicates rejected');
});

test('deterministic insights pass their own audit', () => {
  const cards = parseSevenCards(SIGNALS);
  const insights = deterministicInsights(cards, 'Should I reach out to him, or wait?');
  const audit = auditInsights(insights, cards);
  assert.equal(audit.ok, true, audit.reason);
  assert.equal(insights[0].label, 'The core pattern');
  assert.match(insights[1].body, /Wheel of Fortune/);
});

test('auditInsights rejects verdicts, foreign cards and band violations', () => {
  const cards = parseSevenCards(SIGNALS);
  const good = JSON.parse(GOOD_INSIGHTS).insights.map((block, index) => ({ n: `0${index + 1}`, ...block }));
  assert.equal(auditInsights(good, cards).ok, true);
  const verdict = structuredClone(good);
  verdict[1].body = 'He is thinking about you constantly and Wheel of Fortune in the Likely Outcome with Knight of Wands says the answer will definitely arrive soon for you.';
  assert.equal(auditInsights(verdict, cards).ok, false);
  const foreign = structuredClone(good);
  foreign[2].body = 'The Tower in the Advice position marks one measured, clearly worded exchange as the part of this that is genuinely yours to choose today.';
  assert.equal(auditInsights(foreign, cards).ok, false);
  const short = structuredClone(good);
  short[0].body = 'Too short to pass.';
  assert.equal(auditInsights(short, cards).ok, false);
});

test('generateInsights serves the model draft first and falls back on garbage', async () => {
  const cards = parseSevenCards(SIGNALS);
  const env = { DEEPSEEK_DIRECT_API_KEY: 'test-only-key' };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => modelResponse(GOOD_INSIGHTS);
    const served = await generateInsights({ question: 'Should I reach out to him, or wait?', cards, readingId: 'sc7-test-1' }, env);
    assert.equal(served.source, 'model_initial');
    assert.equal(served.insights.length, 3);
    globalThis.fetch = async () => modelResponse('not json at all');
    const fallback = await generateInsights({ question: 'Should I reach out to him, or wait?', cards, readingId: 'sc7-test-2' }, env);
    assert.equal(fallback.source, 'deterministic_fallback');
    assert.equal(auditInsights(fallback.insights, cards).ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('module exposes a version marker', () => {
  assert.match(SEVEN_CARD_FUNNEL_VERSION, /^seven-card-v2-/);
});

test('deterministicAnswer passes the answer audit', () => {
  const cards = parseSevenCards(SIGNALS);
  const answer = deterministicAnswer(cards);
  const audit = auditAnswer(answer, cards);
  assert.equal(audit.ok, true, audit.reason);
  assert.match(answer, /Wheel of Fortune/);
});

test('auditAnswer rejects guarantees and foreign cards', () => {
  const cards = parseSevenCards(SIGNALS);
  assert.equal(auditAnswer('It will definitely work out for you and Wheel of Fortune guarantees the yes you want soon.', cards).ok, false);
  assert.equal(auditAnswer('The spread leans yes: The Tower in the Likely Outcome favours movement if the current pattern finally changes now.', cards).ok, false);
  assert.equal(auditAnswer(GOOD_ANSWER, cards).ok, true);
});
