import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateReadingFields } from '../lib/legacy-worker.mjs';

// Angel Number V2 sells explicit package promises on the page (word bands and
// tier deliverables). These checks pin the paid pipeline to that page copy and
// keep the fulfillment evidence gate open for both V2 signal formats.
const source = await readFile(new URL('../lib/legacy-worker.mjs', import.meta.url), 'utf8');

test('angel number V2 marker pins the presentation variant and page', () => {
  assert.match(source, /function isAngelNumberV2\(fields = \{\}\) \{\s*return normalizeContractText\(fields\.presentationVariant\) === "angel-number-v2"\s*&& normalizeContractText\(fields\.tool\) === "\/pages\/angel-number-meaning";/);
});

test('angel number V2 word bands mirror the page copy (450-600 / 750-950 / 1,250-1,500)', () => {
  const branch = source.match(/if \(isAngelNumberV2\(fields\)\) \{[\s\S]{0,900}?\n {2}\}/);
  assert.ok(branch, 'word-band branch missing');
  assert.match(branch[0], /premium[\s\S]{0,80}minWords: 1250, maxWords: 1500/);
  assert.match(branch[0], /medium[\s\S]{0,80}minWords: 750, maxWords: 950/);
  assert.match(branch[0], /standard", minWords: 450, maxWords: 600/);
});

test('angel number V2 package contract sells the three page deliverables verbatim', () => {
  assert.match(source, /Personalized Angel Number Message: answer the exact paid question/);
  assert.match(source, /Angel Number Clarity Reading: answer the exact paid question/);
  assert.match(source, /Angel Number Pattern & Life Path Reading: answer the exact paid question/);
  assert.match(source, /30-day alignment map/);
  assert.match(source, /7-day sign tracker/);
  assert.match(source, /never proof of another person's private thoughts/);
  assert.match(source, /Life Path connection as a separate clearly labeled layer/);
  assert.match(source, /name one caution so the sign is not overread/);
});

const angelSignals = 'Number: 444; Core theme: Angelic Protection; Life area: Love & relationships; Situation focus: relationship consistency; Derived core: direct entry';

test('angel number V2 fulfillment evidence passes the family gate', () => {
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Angel Number',
    tool: '/pages/angel-number-meaning',
    presentationVariant: 'angel-number-v2',
    question: 'We started talking again after a quiet month and I cannot tell if it is different this time.',
    focus: 'Love & relationships',
    scope: 'Angel Number Clarity Reading for 444 read inside the love & relationships area.',
    confidence: 'Angel-number symbolism supports reflection and decision-making; it does not predict fixed outcomes.',
    signals: angelSignals,
    cards: angelSignals,
    spread: 'Angel number lookup: number, core theme, life area, situation',
    context: 'Angel Number Meaning V2. ' + angelSignals + '. Free snapshot: stability measured by consistency over intensity.'
  });
  assert.deepEqual(validation, { ok: true, code: 'OK', missing: [] });
});

const dreamSignals = 'Dominant theme: Change & Uncertainty; Emotion on waking: Anxious; Recurrence: First time; Detected symbols: Water; Reading focus: Love & relationships; Approach: Balanced; Dream length: 42 words';

test('dream interpreter V2 fulfillment evidence passes the family gate (regression)', () => {
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Dream Interpretation',
    tool: '/pages/dream-interpreter',
    presentationVariant: 'dream-interpreter-v2',
    question: 'What does my dream mean, especially water and the way it ended?',
    focus: 'Love & relationships',
    scope: 'What This Dream Means dream reading focused on love & relationships with a balanced approach.',
    confidence: 'Grounded dream reflection, not a prediction, diagnosis, or claim about another person.',
    signals: dreamSignals,
    cards: dreamSignals,
    spread: 'Dream snapshot: theme, emotion, symbols, ending',
    context: 'Dream Interpreter V2. ' + dreamSignals + '. Free snapshot: A change already underway somewhere real. Customer chose not to include the raw dream text; interpret from the structured signals above.'
  });
  assert.deepEqual(validation, { ok: true, code: 'OK', missing: [] });
});
