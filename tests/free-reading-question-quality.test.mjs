import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conciseDeterministicFreeTeaser,
  freePreviewPayload,
  freeWriterPlan,
  readingQuestionQuality,
} from '../lib/legacy-worker.mjs';

test('free-reading question quality rejects bare names and meaningless subjects', () => {
  for (const question of ['Jennifer', 'Ali?', 'selami selanbas', 'klmnopqr', 'helloooo']) {
    const result = readingQuestionQuality(question, '', { requireIntent: true });
    assert.equal(result.ok, false, `${question} should require clarification`);
    assert.equal(result.reason, 'subject_only');
  }
  assert.equal(readingQuestionQuality('Jennifer').ok, true, 'the stricter intent rule stays scoped to question-led funnels');
});

test('free-reading question quality keeps concise real questions', () => {
  for (const question of [
    'Will Alex return?',
    'Ne yapmalıyım?',
    'Ali döner mi?',
    'Career change advice',
    '¿Debo aceptar este trabajo?',
    'Soll ich diese Stelle annehmen?',
  ]) {
    assert.equal(readingQuestionQuality(question, '', { requireIntent: true }).ok, true, `${question} should remain valid`);
  }
});

test('subject-only guidance follows the question language', () => {
  const turkish = readingQuestionQuality('selami selanbas', 'tr', { requireIntent: true });
  assert.match(turkish.message, /Yalnızca bir isim|neyi anlamak istediğini/u);
  const english = readingQuestionQuality('Jennifer', 'en', { requireIntent: true });
  assert.match(english.message, /not only a name or topic/i);
});

test('free writer plan completes the answer without manufacturing a sales gap', () => {
  const fields = {
    question: 'Will Alex contact me again?',
    type: 'Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'Three Card',
    context: 'Past: Ace of Cups. Present: Four of Cups. Future: Two of Wands reversed.',
    signals: 'Past: Ace of Cups Upright; Present: Four of Cups Upright; Future: Two of Wands Reversed',
    cards: 'Ace of Cups, Four of Cups, Two of Wands',
    lang: 'en',
  };
  const plan = freeWriterPlan(fields, 'en');
  assert.match(plan.output_boundary, /complete ending|observable condition|grounded next step/i);
  assert.doesNotMatch(plan.output_boundary, /final sentence must name|without resolving/i);
  assert.match(plan.output_boundary, /Do not manufacture an unresolved mystery, sales gap/i);
  const fallback = conciseDeterministicFreeTeaser(fields, 'en');
  assert.doesNotMatch(fallback, /deeper thread|leave open here|what they leave open|unresolved condition/i);
  assert.match(fallback, /next decision|next move|next step|watch|clarify/i);
});

test('free preview response carries the reading id used to correlate the request', () => {
  const fields = {
    question: 'Will Alex contact me again?',
    readingId: 'reading_1234567890abcdef',
    curiosityQuestion: 'What behavior would show that contact is consistent?',
    lang: 'en',
    locale: 'en-US',
  };
  const payload = freePreviewPayload('token123', '<p>A complete answer grounded in the supplied cards.</p>', fields);
  assert.equal(payload.readingId, fields.readingId);
  assert.equal(payload.curiosityQuestion, fields.curiosityQuestion);
});
