import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateReadingFields } from '../lib/legacy-worker.mjs';

// Celtic Cross V2 sells three tiers (Core Answer / Turning Point / Pathway).
// These checks pin the paid pipeline to the page copy and prove the ten-card
// spread evidence passes the tarot family gate. The Outcome is a possible
// direction, never a fixed fate.
const source = await readFile(new URL('../lib/legacy-worker.mjs', import.meta.url), 'utf8');

test('celtic cross V2 marker pins the presentation variant and page', () => {
  assert.match(source, /function isCelticCrossV2\(fields = \{\}\) \{\s*return normalizeContractText\(fields\.presentationVariant\) === "celtic-cross-v2"\s*&& normalizeContractText\(fields\.tool\) === "\/pages\/celtic-cross-tarot-reading";/);
});

test('celtic cross V2 word bands mirror the page copy (450-600 / 750-950 / 1,250-1,500)', () => {
  const branch = source.match(/if \(isCelticCrossV2\(fields\)\) \{[\s\S]{0,900}?\n {2}\}/);
  assert.ok(branch, 'word-band branch missing');
  assert.match(branch[0], /premium[\s\S]{0,80}minWords: 1250, maxWords: 1500/);
  assert.match(branch[0], /medium[\s\S]{0,80}minWords: 750, maxWords: 950/);
  assert.match(branch[0], /standard", minWords: 450, maxWords: 600/);
});

test('celtic cross V2 package contract sells the three page tiers verbatim', () => {
  assert.match(source, /Pathway Reading: answer the exact paid question/);
  assert.match(source, /Turning Point: answer the exact paid question/);
  assert.match(source, /Core Answer: answer the exact paid question/);
  assert.match(source, /the Outcome is a possible direction if the present pattern continues, never a fixed fate/);
  assert.match(source, /never add a clarifier card or collapse the spread into one card/);
  assert.match(source, /compare the current path against an alternative path with the opportunity, cost and risk/);
  assert.match(source, /central turn the customer is heading toward/);
});

const positions = ['Present', 'Challenge', 'Foundation', 'Recent Past', 'Crown/Potential', 'Near Future', 'Self', 'Environment', 'Hopes and Fears', 'Outcome'];
const cardNames = ['The Fool', 'The Tower', 'Three of Cups', 'The Hermit', 'The Star', 'Six of Swords', 'The Empress', 'Knight of Wands', 'The Moon', 'The Sun'];
const orients = ['Upright', 'Reversed', 'Upright', 'Reversed', 'Upright', 'Upright', 'Reversed', 'Upright', 'Reversed', 'Upright'];
const signalsStr = positions.map((p, i) => (i + 1) + '. ' + p + ': ' + cardNames[i] + ' · ' + orients[i]).join('; ');
const cardsStr = positions.map((p, i) => p + ': ' + cardNames[i] + ' (' + orients[i] + ')').join('; ');
const contextStr = 'Celtic Cross 10-card spread. Topic: general. Cards: ' + positions.map((p, i) => (i + 1) + '. ' + p + ' = ' + cardNames[i] + ' · ' + orients[i]).join(' | ') + '. Read the cross as the situation and the staff as the path.';

test('celtic cross V2 ten-card evidence passes the tarot family gate', () => {
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Tarot',
    tool: '/pages/celtic-cross-tarot-reading',
    presentationVariant: 'celtic-cross-v2',
    question: 'What should I understand about the pattern shaping this relationship right now?',
    focus: 'Relationships',
    scope: 'A reflective ten-card Celtic Cross interpretation tied to the exact question, positions and orientations. It is not a guaranteed prediction.',
    confidence: 'Ten cards drawn without replacement from the full 78-card deck with orientation; reflective tarot guidance only.',
    signals: signalsStr,
    cards: cardsStr,
    spread: 'Celtic Cross · 10 cards',
    context: contextStr
  });
  assert.deepEqual(validation, { ok: true, code: 'OK', missing: [] });
});
