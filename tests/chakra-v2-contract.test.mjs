import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateReadingFields } from '../lib/legacy-worker.mjs';

// Chakra Test V2 sells explicit package promises on the page (word bands and
// tier deliverables). These checks pin the paid pipeline to that page copy and
// prove the CT1 evidence shape passes both the deterministic result-reproduction
// contract and the wellness-quiz family gate. The chakra system is held to
// symbolic reflection only, never an energy/medical claim.
const source = await readFile(new URL('../lib/legacy-worker.mjs', import.meta.url), 'utf8');

test('chakra V2 marker pins the presentation variant and page', () => {
  assert.match(source, /function isChakraV2\(fields = \{\}\) \{\s*return normalizeContractText\(fields\.presentationVariant\) === "chakra-v2"\s*&& normalizeContractText\(fields\.tool\) === "\/pages\/chakra-test";/);
});

test('chakra V2 word bands mirror the page copy (500-650 / 850-1,100 / 1,500-1,900)', () => {
  const branch = source.match(/if \(isChakraV2\(fields\)\) \{[\s\S]{0,900}?\n {2}\}/);
  assert.ok(branch, 'word-band branch missing');
  assert.match(branch[0], /premium[\s\S]{0,80}minWords: 1500, maxWords: 1900/);
  assert.match(branch[0], /medium[\s\S]{0,80}minWords: 850, maxWords: 1100/);
  assert.match(branch[0], /standard", minWords: 500, maxWords: 650/);
});

test('chakra V2 package contract sells the three page deliverables verbatim', () => {
  assert.match(source, /Personalized Chakra Pair Decode: answer the exact paid question/);
  assert.match(source, /Personal Chakra Pattern Map: answer the exact paid question/);
  assert.match(source, /30-Day Chakra Alignment Blueprint: answer the exact paid question/);
  // Symbolic-reflection guardrails, verbatim from the contract.
  assert.match(source, /never claim a chakra is blocked, open, closed, broken or imbalanced/);
  assert.match(source, /never promise to heal, unblock, balance or align an energy center/);
  // Tier-specific promises mirror the page bullets.
  assert.match(source, /trigger, reaction and hidden cost that keep it repeating/);
  assert.match(source, /four-week personalized progression with daily and weekly practices/);
  assert.match(source, /printable 30-day tracker outline and a day-30 retest guide/);
  assert.match(source, /journal prompts and affirmations matched to the two themes/);
  assert.match(source, /close with a 3-day mini practice/);
});

// A consistent CT1 result: answers are paired per chakra (answers[i*2] +
// answers[i*2+1] = chakra i score), so root=4, sacral=1, solar=3, heart=4,
// throat=3, third-eye=3, crown=6. Reflection focus is the lowest (sacral 1/6),
// strongest support is the highest (crown 6/6). The scope, confidence and
// context are the fixed CT1 evidence strings the live page attaches.
const ANSWER_VECTOR = 'CT1:2-2-0-1-2-1-2-2-1-2-1-2-3-3';
const SCORE_VECTOR = 'root:4|sacral:1|solar:3|heart:4|throat:3|third-eye:3|crown:6';
const CHAKRA_SCOPE = 'Apply the CT1 symbolic themes only to the user-selected reflective focus. Do not claim a blocked chakra, energy diagnosis, medical or mental-health assessment, treatment effect, fixed identity or guaranteed outcome.';
const CHAKRA_CONFIDENCE = 'Deterministic CT1 scoring from 14 canonical 0-3 answer indices; symbolic self-reflection only.';
const CHAKRA_CONTEXT = 'CT1 deterministic reflective test. Answer vector ' + ANSWER_VECTOR + '. Reflection focus sacral 1/6. Strongest crown 6/6. Score vector ' + SCORE_VECTOR + '.';
const chakraSignals = 'Chakra test version: CT1; Answer vector: ' + ANSWER_VECTOR + '; Reflection focus: sacral|1/6|17%; Strongest signal: crown|6/6|100%; Score vector: ' + SCORE_VECTOR + '; Questions answered: 14/14';

test('chakra V2 CT1 evidence passes the deterministic + family gate', () => {
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Chakra Balance',
    tool: '/pages/chakra-test',
    presentationVariant: 'chakra-v2',
    question: 'I keep saying yes to things I do not want and then feel resentful afterwards.',
    focus: 'Confidence & Boundaries',
    scope: CHAKRA_SCOPE,
    confidence: CHAKRA_CONFIDENCE,
    signals: chakraSignals,
    context: CHAKRA_CONTEXT
  });
  assert.deepEqual(validation, { ok: true, code: 'OK', missing: [] });
});

// A score vector that does not match the deterministic reproduction of the
// answer vector (crown claimed as 5 but the answers sum to 6) must be rejected
// before checkout.
test('chakra V2 tampered score vector fails the deterministic contract', () => {
  const tamperedScores = 'root:4|sacral:1|solar:3|heart:4|throat:3|third-eye:3|crown:5';
  const tamperedSignals = 'Chakra test version: CT1; Answer vector: ' + ANSWER_VECTOR + '; Reflection focus: sacral|1/6|17%; Strongest signal: crown|6/6|100%; Score vector: ' + tamperedScores + '; Questions answered: 14/14';
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Chakra Balance',
    tool: '/pages/chakra-test',
    presentationVariant: 'chakra-v2',
    question: 'I keep saying yes to things I do not want and then feel resentful afterwards.',
    focus: 'Confidence & Boundaries',
    scope: CHAKRA_SCOPE,
    confidence: CHAKRA_CONFIDENCE,
    signals: tamperedSignals,
    context: CHAKRA_CONTEXT
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.code, 'NEW_TOOL_EVIDENCE_MISMATCH');
});
