import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Career Tarot V2 sells explicit package promises on the page (word bands and
// tier deliverables). These source-contract checks pin the paid pipeline to
// that page copy so a later edit cannot silently break a sold promise.
const source = await readFile(new URL('../lib/legacy-worker.mjs', import.meta.url), 'utf8');

test('career V2 marker pins the direct presentation variant and page', () => {
  assert.match(source, /function isCareerDirectCompact\(fields = \{\}\) \{\s*return normalizeContractText\(fields\.presentationVariant\) === "career-three-card-compact-v1"\s*&& normalizeContractText\(fields\.tool\) === "\/pages\/career-tarot-reading";/);
});

test('career V2 word bands mirror the page copy (450-600 / 750-950 / 1,250-1,500)', () => {
  const branch = source.match(/if \(isCareerDirectCompact\(fields\)\) \{[\s\S]{0,900}?\n {2}\}/);
  assert.ok(branch, 'word-band branch missing');
  assert.match(branch[0], /premium[\s\S]{0,80}minWords: 1250, maxWords: 1500/);
  assert.match(branch[0], /medium[\s\S]{0,80}minWords: 750, maxWords: 950/);
  assert.match(branch[0], /standard", minWords: 450, maxWords: 600/);
});

test('career V2 package contract sells the three page deliverables verbatim', () => {
  assert.match(source, /The Deciding Factor: give one direct answer to the exact paid question/);
  assert.match(source, /Career Crossroads Map: answer the exact paid question/);
  assert.match(source, /30-Day Career Move Plan: answer the exact paid question/);
  assert.match(source, /Current Position, Deciding Factor, Best Next Step/);
  assert.match(source, /one green flag and one red flag the customer can actually check/);
  assert.match(source, /exactly three real-world signs the customer can verify/);
  assert.match(source, /four clearly labeled weekly action steps/);
  assert.match(source, /decision checkpoint and a fallback plan/);
  assert.match(source, /never guarantee a job, promotion, salary, income or business outcome/);
});

test('career V2 requirements enforce the promised comparisons per tier', () => {
  assert.match(source, /const careerDirectTwoPathTier = careerDirectPromises && tier !== "standard";/);
  assert.match(source, /twoPathDecisionMap:[^\n]*careerDirectTwoPathTier/);
  assert.match(source, /pathATradeoff:[^\n]*careerDirectTwoPathTier/);
  assert.match(source, /pathBTradeoff:[^\n]*careerDirectTwoPathTier/);
  assert.match(source, /decidingCondition:[^\n]*careerDirectPromises/);
  assert.match(source, /observableEvidence:[^\n]*careerDirectTwoPathTier/);
});

test('career V2 contract runs before the generic careerReading branches', () => {
  const v2Index = source.indexOf('const careerDirectV2 = isCareerDirectCompact(fields);');
  const genericIndex = source.indexOf('if (careerReading && tier === "premium") return `Career Roadmap');
  assert.ok(v2Index > 0 && genericIndex > 0, 'expected both branches present');
  assert.ok(v2Index < genericIndex, 'career V2 branch must precede the generic careerReading contract');
});
