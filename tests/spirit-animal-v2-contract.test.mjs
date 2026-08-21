import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateReadingFields } from '../lib/legacy-worker.mjs';

// Spirit Animal V2 sells three tiers (The Message / The Pattern / The Path).
// These checks pin the paid pipeline to the page copy and prove the quiz-family
// evidence shape (primary archetype + runner-up + match distribution) passes the
// fulfillment gate. The archetype is symbolic self-reflection only.
const source = await readFile(new URL('../lib/legacy-worker.mjs', import.meta.url), 'utf8');

test('spirit animal V2 marker pins the presentation variant and page', () => {
  assert.match(source, /function isSpiritAnimalV2\(fields = \{\}\) \{\s*return normalizeContractText\(fields\.presentationVariant\) === "spirit-animal-v2"\s*&& normalizeContractText\(fields\.tool\) === "\/pages\/spirit-animal-quiz";/);
});

test('spirit animal V2 word bands are set per tier', () => {
  const branch = source.match(/if \(isSpiritAnimalV2\(fields\)\) \{[\s\S]{0,900}?\n {2}\}/);
  assert.ok(branch, 'word-band branch missing');
  assert.match(branch[0], /premium[\s\S]{0,80}minWords: 1250, maxWords: 1600/);
  assert.match(branch[0], /medium[\s\S]{0,80}minWords: 750, maxWords: 1e3/);
  assert.match(branch[0], /standard", minWords: 450, maxWords: 600/);
});

test('spirit animal V2 package contract sells the three page tiers verbatim', () => {
  assert.match(source, /The Path \(30-day animal ally map\): answer the exact paid question/);
  assert.match(source, /The Pattern: answer the exact paid question/);
  assert.match(source, /The Message: answer the exact paid question/);
  // archetype-not-sacred guardrails
  assert.match(source, /never a sacred or Indigenous designation, a scientific assessment or a supernatural certainty/);
  // tier promises mirror the page bullets
  assert.match(source, /primary, supporting \(runner-up\) and balancing archetype/);
  assert.match(source, /behaviour pattern that keeps repeating in the chosen life area/);
  assert.match(source, /personalized 7-day action path/);
  assert.match(source, /grounded step for the next seven days/);
});

// The quiz family gate requires a numeric primary archetype, a runner-up and a
// match distribution — exactly what the live quiz attaches to checkout.
const spiritSignals = 'Primary archetype: The Wolf · 82% quiz match; Runner-up: The Owl · 61% quiz match; Power: Loyalty and instinct; Element: Earth; Match pattern: Close blend: Wolf + Owl; Top matches: Wolf 82%, Owl 61%, Bear 44%';

test('spirit animal V2 quiz evidence passes the quiz family gate', () => {
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Spirit Animal',
    tool: '/pages/spirit-animal-quiz',
    presentationVariant: 'spirit-animal-v2',
    question: 'I keep taking on everyone else’s problems at work and then feel drained and unseen.',
    focus: 'Work & Purpose',
    scope: 'A modern animal-archetype reflection using all eight answers, normalized score distribution, primary match and runner-up, applied only to the chosen situation.',
    confidence: 'Eight-question normalized archetype match; symbolic self-reflection, not probability or diagnosis.',
    signals: spiritSignals,
    context: 'Spirit animal quiz result: The Wolf (82% normalized quiz match). Runner-up: The Owl (61%). ' + spiritSignals
  });
  assert.deepEqual(validation, { ok: true, code: 'OK', missing: [] });
});

test('spirit animal V2 evidence missing the runner-up fails the gate', () => {
  const partial = 'Primary archetype: The Wolf · 82% quiz match; Power: Loyalty; Element: Earth; Match pattern: Clearer lead: Wolf; Top matches: Wolf 82%, Owl 61%, Bear 44%';
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Spirit Animal',
    tool: '/pages/spirit-animal-quiz',
    presentationVariant: 'spirit-animal-v2',
    question: 'I keep taking on everyone else’s problems at work and then feel drained.',
    focus: 'Work & Purpose',
    scope: 'A modern animal-archetype reflection applied only to the chosen situation.',
    confidence: 'Eight-question normalized archetype match; symbolic self-reflection, not probability or diagnosis.',
    signals: partial,
    context: 'Spirit animal quiz result. ' + partial
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes('runnerUp'), 'expected runnerUp in ' + JSON.stringify(validation.missing));
});
