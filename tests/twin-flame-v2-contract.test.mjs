import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateReadingFields } from '../lib/legacy-worker.mjs';

// Twin Flame V2 sells three tiers (Connection Truth / Separation & Next Move /
// Reunion or Release Blueprint). These checks pin the paid pipeline to the page
// copy and prove the two-birth-date pattern-score evidence passes the compatibility
// family gate. Twin flame is a symbolic pattern reflection, never proof of destiny,
// another person's private feelings, or a guaranteed reunion.
const source = await readFile(new URL('../lib/legacy-worker.mjs', import.meta.url), 'utf8');

test('twin flame V2 marker pins the presentation variant and page', () => {
  assert.match(source, /function isTwinFlameV2\(fields = \{\}\) \{\s*return normalizeContractText\(fields\.presentationVariant\) === "twin-flame-v2"\s*&& normalizeContractText\(fields\.tool\) === "\/pages\/twin-flame-calculator";/);
});

test('twin flame V2 word bands mirror the page copy (450-600 / 750-950 / 1,250-1,500)', () => {
  const branch = source.match(/if \(isTwinFlameV2\(fields\)\) \{[\s\S]{0,900}?\n {2}\}/);
  assert.ok(branch, 'word-band branch missing');
  assert.match(branch[0], /premium[\s\S]{0,80}minWords: 1250, maxWords: 1500/);
  assert.match(branch[0], /medium[\s\S]{0,80}minWords: 750, maxWords: 950/);
  assert.match(branch[0], /standard", minWords: 450, maxWords: 600/);
});

test('twin flame V2 package contract sells the three page tiers verbatim', () => {
  assert.match(source, /Reunion or Release Blueprint: answer the exact paid question/);
  assert.match(source, /Separation & Next Move: answer the exact paid question/);
  assert.match(source, /Connection Truth: answer the exact paid question/);
  assert.match(source, /never proof of destiny, a measurement of another person's private feelings or intentions, a diagnosis, or a guaranteed reunion/);
  assert.match(source, /compare three possible relationship paths \(reconnection, redefinition and release\)/);
  assert.match(source, /personalized 14-day guidance plan/);
  assert.match(source, /classify what this bond most closely resembles/);
});

const signalsStr = [
  'Person A: March 14, 1994 · Pisces · Life Path 9',
  'Person B: September 17, 1991 · Virgo · Life Path 1',
  'Pattern score: 72 / 100',
  'Connection type: Mirror-Intense Connection',
  'Recognition: 88 / 100',
  'Magnetic polarity: 79 / 100',
  'Emotional rhythm: 61 / 100',
  'Growth pressure: 74 / 100',
  'Situation: No contact'
].join('; ');

const contextStr = 'Twin Flame Calculator — symbolic pattern comparison of two birth dates. '
  + 'Person A: March 14, 1994 (Sun sign Pisces, Life Path 9). '
  + 'Person B: September 17, 1991 (Sun sign Virgo, Life Path 1). '
  + 'Pattern score 72/100 — Mirror-Intense Connection. '
  + 'This is a symbolic pattern score from birth dates only, never proof of destiny, another person\'s private feelings, or a guaranteed reunion.';

test('twin flame V2 two-birth-date pattern-score evidence passes the compatibility family gate', () => {
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Twin Flame Connection',
    tool: '/pages/twin-flame-calculator',
    presentationVariant: 'twin-flame-v2',
    question: 'Should I contact them now, or would more space be healthier?',
    focus: 'Relationships',
    scope: 'A reflective twin-flame connection reading tied to the two supplied birth dates, their symbolic pattern score and the situation described. It is a symbolic pattern reflection, never proof of destiny, another person\'s feelings or a guaranteed reunion.',
    confidence: 'Symbolic comparison of two birth dates across Sun-sign relationship, approximate lunar rhythm, Life Path distance and mirror/polarity balance. Birth times are not used.',
    signals: signalsStr,
    context: contextStr
  });
  assert.deepEqual(validation, { ok: true, code: 'OK', missing: [] });
});
