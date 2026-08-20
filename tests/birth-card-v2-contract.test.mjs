import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Tarot Birth Card V2 sells explicit package promises on the page (word bands
// and tier deliverables). These source-contract checks pin the paid pipeline
// to that page copy so a later edit cannot silently break a sold promise.
const source = await readFile(new URL('../lib/legacy-worker.mjs', import.meta.url), 'utf8');

test('birth card V2 marker pins the direct presentation variant and page', () => {
  assert.match(source, /function isBirthCardDirectV2\(fields = \{\}\) \{\s*return normalizeContractText\(fields\.presentationVariant\) === "birth-card-direct-v1"\s*&& normalizeContractText\(fields\.tool\) === "\/pages\/tarot-birth-card-calculator";/);
});

test('birth card V2 word bands mirror the page copy (600-750 / 950-1,150 / 1,500-1,800)', () => {
  const branch = source.match(/if \(isBirthCardDirectV2\(fields\)\) \{[\s\S]{0,900}?\n {2}\}/);
  assert.ok(branch, 'word-band branch missing');
  assert.match(branch[0], /premium[\s\S]{0,80}minWords: 1500, maxWords: 1800/);
  assert.match(branch[0], /medium[\s\S]{0,80}minWords: 950, maxWords: 1150/);
  assert.match(branch[0], /standard", minWords: 600, maxWords: 750/);
});

test('birth card V2 package contract sells the three page deliverables verbatim', () => {
  assert.match(source, /Personalized Birth Card Core Profile: synthesize the Personality and Soul cards/);
  assert.match(source, /Birth Card Life Pattern Reading: deliver everything in the Core Profile/);
  assert.match(source, /Complete Birth Card & Year Ahead Map: deliver the complete birth-card synthesis/);
  assert.match(source, /current and next Year Card strictly as chapters/);
  assert.match(source, /30\/60\/90-day integration plan/);
  assert.match(source, /higher expression with the shadow expression/);
  assert.match(source, /not a personality test, diagnosis or prediction/);
});
