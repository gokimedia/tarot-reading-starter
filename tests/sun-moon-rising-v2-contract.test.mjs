import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateReadingFields } from '../lib/legacy-worker.mjs';

// Sun Moon Rising V2 sells explicit package promises on the page (word bands
// and tier deliverables). These checks pin the paid pipeline to that page copy
// and prove both evidence shapes (with and without a Rising sign) pass the
// astrology family gate.
const source = await readFile(new URL('../lib/legacy-worker.mjs', import.meta.url), 'utf8');

test('sun moon rising V2 marker pins the presentation variant and page', () => {
  assert.match(source, /function isSunMoonRisingV2\(fields = \{\}\) \{\s*return normalizeContractText\(fields\.presentationVariant\) === "sun-moon-rising-v2"\s*&& normalizeContractText\(fields\.tool\) === "\/pages\/sun-moon-rising-calculator";/);
});

test('sun moon rising V2 word bands mirror the page copy (450-600 / 800-1,000 / 1,300-1,600)', () => {
  const branch = source.match(/if \(isSunMoonRisingV2\(fields\)\) \{[\s\S]{0,900}?\n {2}\}/);
  assert.ok(branch, 'word-band branch missing');
  assert.match(branch[0], /premium[\s\S]{0,80}minWords: 1300, maxWords: 1600/);
  assert.match(branch[0], /medium[\s\S]{0,80}minWords: 800, maxWords: 1e3/);
  assert.match(branch[0], /standard", minWords: 450, maxWords: 600/);
});

test('sun moon rising V2 package contract sells the three page deliverables verbatim', () => {
  assert.match(source, /Focused Insight: answer the exact paid question/);
  assert.match(source, /Pattern Map: answer the exact paid question/);
  assert.match(source, /Alignment Blueprint: answer the exact paid question/);
  assert.match(source, /never invent houses, aspects, degrees or a Rising sign that was not calculated/);
  assert.match(source, /trigger, emotional need, protective response and outcome as one loop/);
  assert.match(source, /safe-state pattern and the stress-state pattern separately/);
  assert.match(source, /30-day integration plan/);
  assert.match(source, /one-page personal summary/);
  assert.match(source, /7-day integration plan/);
});

const withRising = 'Sun: Leo (Fire) 132.41 deg; Moon: Pisces (Water) 348.02 deg; Rising: Capricorn (Earth), exact birth time; Dominant element: Water; Birth time: Exact; Focus: Love & Relationships';

test('sun moon rising V2 evidence with a Rising sign passes the astrology family gate', () => {
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Sun Moon Rising (Big 3)',
    tool: '/pages/sun-moon-rising-calculator',
    presentationVariant: 'sun-moon-rising-v2',
    question: 'I want closeness, but I pull away when someone becomes emotionally available.',
    focus: 'Love & Relationships',
    scope: 'Pattern Map reading from the calculated Big Three placements for the love & relationships focus.',
    confidence: 'Astronomy-based placements from birth date, exact time and birthplace coordinates with the historical time zone.',
    signals: withRising,
    cards: withRising,
    spread: 'Big Three: Sun, Moon and Rising placements',
    context: 'Sun Moon Rising V2. ' + withRising + '. Customer question: "I want closeness, but I pull away when someone becomes emotionally available."'
  });
  assert.deepEqual(validation, { ok: true, code: 'OK', missing: [] });
});

const withoutRising = 'Sun: Virgo (Earth) 158.10 deg; Moon: Pisces (Water) 344.55 deg, calculated from the birth date; Rising: Not calculated (no birth time); Dominant element: Water; Birth time: Unknown; Focus: A Repeating Pattern';

test('sun moon rising V2 evidence without a Rising sign still passes the family gate', () => {
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Sun Moon Rising (Big 3)',
    tool: '/pages/sun-moon-rising-calculator',
    presentationVariant: 'sun-moon-rising-v2',
    question: 'I keep ending up in the same situation and I do not know which part of me starts it.',
    focus: 'A Repeating Pattern',
    scope: 'Pattern Map reading from the calculated Sun and Moon placements; the Rising sign was not calculated because no birth time was supplied.',
    confidence: 'Astronomy-based Sun and Moon from the birth date and birthplace; the Rising sign is never guessed without a birth time.',
    signals: withoutRising,
    cards: withoutRising,
    spread: 'Big Three: Sun and Moon placements, Rising unavailable',
    context: 'Sun Moon Rising V2. ' + withoutRising + '. Customer question: "I keep ending up in the same situation and I do not know which part of me starts it."'
  });
  assert.deepEqual(validation, { ok: true, code: 'OK', missing: [] });
});
