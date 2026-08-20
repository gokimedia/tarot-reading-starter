import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Yes/No Tarot V3 sells explicit package promises on the page (word bands and
// tier deliverables). These source-contract checks pin the paid pipeline to
// that page copy so a later edit cannot silently break a sold promise.
const source = await readFile(new URL('../lib/legacy-worker.mjs', import.meta.url), 'utf8');

test('yes/no V3 marker pins the direct presentation variant and page', () => {
  assert.match(source, /function isYesNoDirectCompact\(fields = \{\}\) \{\s*return normalizeContractText\(fields\.presentationVariant\) === "yes-no-direct-v1"\s*&& normalizeContractText\(fields\.tool\) === "\/pages\/yes-or-no-tarot";/);
});

test('yes/no V3 word bands mirror the page copy (450-600 / 750-950 / 1,250-1,500)', () => {
  const branch = source.match(/if \(isYesNoDirectCompact\(fields\)\) \{[\s\S]{0,900}?\n {2}\}/);
  assert.ok(branch, 'word-band branch missing');
  assert.match(branch[0], /premium[\s\S]{0,80}minWords: 1250, maxWords: 1500/);
  assert.match(branch[0], /medium[\s\S]{0,80}minWords: 750, maxWords: 950/);
  assert.match(branch[0], /standard", minWords: 450, maxWords: 600/);
});

test('yes/no V3 package contract sells the three page deliverables verbatim', () => {
  assert.match(source, /Understand the Answer: give one direct answer to the exact paid question/);
  assert.match(source, /Compare Your Paths: answer the exact paid question/);
  assert.match(source, /Map the Next 30 Days: answer the exact paid question/);
  assert.match(source, /never change, hedge away or overrule that lean/);
  assert.match(source, /30-day decision map broken into weekly checkpoints/);
  assert.match(source, /finish with exactly three practical next steps\.`;\r?\n    return `Understand the Answer/);
});

test('yes/no V3 requirements enforce the promised comparisons per tier', () => {
  assert.match(source, /const yesNoDirectTwoPathTier = yesNoDirectPromises && tier !== "standard";/);
  assert.match(source, /twoPathDecisionMap:[^\n]*yesNoDirectTwoPathTier/);
  assert.match(source, /pathATradeoff:[^\n]*yesNoDirectTwoPathTier/);
  assert.match(source, /pathBTradeoff:[^\n]*yesNoDirectTwoPathTier/);
  assert.match(source, /decidingCondition:[^\n]*yesNoDirectPromises/);
  assert.match(source, /observableEvidence:[^\n]*yesNoDirectTwoPathTier/);
});

test('order property _Details keeps feeding fields.context for the paid writer', () => {
  // The V3 page carries the decision/background composer text to fulfillment
  // as the _Details line-item property; FIELD_MAP maps it into fields.context
  // and preview hydration must not stomp it (context is not an anchored key).
  assert.match(source, /details: "context"/);
  const anchored = source.match(/const anchoredKeys = \[[^\]]*\]/);
  assert.ok(anchored, 'anchoredKeys missing');
  assert.doesNotMatch(anchored[0], /"context"/);
});
