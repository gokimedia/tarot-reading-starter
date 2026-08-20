import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateReadingFields } from '../lib/legacy-worker.mjs';

// Tarot Timing V2 sells explicit package promises on the page (word bands and
// tier deliverables). These checks pin the paid pipeline to that page copy and
// prove the three-card timing evidence passes the tarot family gate.
const source = await readFile(new URL('../lib/legacy-worker.mjs', import.meta.url), 'utf8');

test('tarot timing V2 marker pins the presentation variant and page', () => {
  assert.match(source, /function isTarotTimingV2\(fields = \{\}\) \{\s*return normalizeContractText\(fields\.presentationVariant\) === "tarot-timing-v2"\s*&& normalizeContractText\(fields\.tool\) === "\/pages\/tarot-timing";/);
});

test('tarot timing V2 word bands mirror the page copy (450-600 / 750-950 / 1,250-1,500)', () => {
  const branch = source.match(/if \(isTarotTimingV2\(fields\)\) \{[\s\S]{0,900}?\n {2}\}/);
  assert.ok(branch, 'word-band branch missing');
  assert.match(branch[0], /premium[\s\S]{0,80}minWords: 1250, maxWords: 1500/);
  assert.match(branch[0], /medium[\s\S]{0,80}minWords: 750, maxWords: 950/);
  assert.match(branch[0], /standard", minWords: 450, maxWords: 600/);
});

test('tarot timing V2 package contract sells the three page deliverables verbatim', () => {
  assert.match(source, /Timing Snapshot: answer the exact paid question/);
  assert.match(source, /Timing & Delay Reading: answer the exact paid question/);
  assert.match(source, /Complete Timeline Map: answer the exact paid question/);
  assert.match(source, /Current Momentum, Timing Signal, Pace Changer/);
  assert.match(source, /never a calendar date and never a guarantee/);
  assert.match(source, /internal, external, mutual or circumstantial/);
  assert.match(source, /the current path, an intentional-action path and a delay path/);
  assert.match(source, /reassessment threshold/);
  assert.match(source, /action plan matched to the chosen horizon under the plan name supplied in the customer details/);
});

test('tarot timing V2 premium swaps the generic 30-day plan for the horizon-matched plan', () => {
  assert.match(source, /thirtyDayActionPlan: !personal777 && tier === "premium" && !timingV2,/);
});

const timingSignals = 'Current Momentum: Eight of Wands (Upright); Timing Signal: Two of Swords (Reversed); Pace Changer: The Star (Upright); Focus: Contact; Horizon: 3 months; Pace: Developing; Signal strength: Conditional';

test('tarot timing V2 fulfillment evidence passes the tarot family gate', () => {
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Tarot Timing',
    tool: '/pages/tarot-timing',
    presentationVariant: 'tarot-timing-v2',
    question: 'He stopped replying about three weeks ago. When could he realistically get back in touch?',
    focus: 'Contact',
    scope: 'Timing & Delay Reading for a contact question read inside a 3 month horizon from the three-card timing spread.',
    confidence: 'Conditional timing window from three cards; a reflective guide, not a fixed-date prediction.',
    signals: timingSignals,
    cards: timingSignals,
    spread: 'Three-card timing spread: Current Momentum, Timing Signal, Pace Changer',
    context: 'Tarot Timing V2. ' + timingSignals + '. Event definition: "A real message from him, not a story view."'
  });
  assert.deepEqual(validation, { ok: true, code: 'OK', missing: [] });
});
