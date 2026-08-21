import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateReadingFields } from '../lib/legacy-worker.mjs';

// Aura Color V2 sells three tiers (Aura Clarity / Signature Map / Blueprint).
// These checks pin the paid pipeline to the page copy and prove the AQ1 evidence
// shape passes both the deterministic reproduction contract and the wellness
// family gate. Aura colors are symbolic reflection only, never energy/medical.
const source = await readFile(new URL('../lib/legacy-worker.mjs', import.meta.url), 'utf8');

test('aura V2 marker pins the presentation variant and page', () => {
  assert.match(source, /function isAuraV2\(fields = \{\}\) \{\s*return normalizeContractText\(fields\.presentationVariant\) === "aura-v2"\s*&& normalizeContractText\(fields\.tool\) === "\/pages\/aura-color-quiz";/);
});

test('aura V2 word bands mirror the page copy (450-600 / 750-950 / 1,250-1,500)', () => {
  const branch = source.match(/if \(isAuraV2\(fields\)\) \{[\s\S]{0,900}?\n {2}\}/);
  assert.ok(branch, 'word-band branch missing');
  assert.match(branch[0], /premium[\s\S]{0,80}minWords: 1250, maxWords: 1500/);
  assert.match(branch[0], /medium[\s\S]{0,80}minWords: 750, maxWords: 950/);
  assert.match(branch[0], /standard", minWords: 450, maxWords: 600/);
});

test('aura V2 package contract sells the three page tiers verbatim', () => {
  assert.match(source, /Aura Clarity Reading: answer the exact paid question/);
  assert.match(source, /Full Aura Signature Map: answer the exact paid question/);
  assert.match(source, /30-Day Aura Alignment Blueprint: answer the exact paid question/);
  assert.match(source, /never a measurement or photograph of a physical energy field/);
  assert.match(source, /primary, supporting and underused colors together as the customer's complete pattern/);
  assert.match(source, /personalized 7-day alignment plan/);
  assert.match(source, /four-week alignment plan/);
  assert.match(source, /twelve journal prompts/);
});

// All-violet answers → violet:22, indigo:20 (deterministic AQ1 reproduction).
const AURA_VECTOR = 'AQ1:0-0-0-0-0-0-0';
const AURA_SCORE = 'violet:22|indigo:20|blue:0|green:0|yellow:0|orange:0|red:0';
const AURA_SCOPE = 'Apply the AQ1 color-archetype pattern only to the user-selected reflective focus. Do not present an energy-field measurement, health assessment, diagnosis, fixed identity or guaranteed outcome.';
const AURA_CONFIDENCE = 'Deterministic AQ1 scoring from seven canonical answer indices; symbolic self-reflection only.';
const AURA_CONTEXT = 'AQ1 deterministic reflective quiz. Answer vector ' + AURA_VECTOR + '. Primary violet 22. Secondary indigo 20. Score vector ' + AURA_SCORE + '.';
const auraSignals = 'Aura quiz version: AQ1; Answer vector: ' + AURA_VECTOR + '; Primary aura: violet|22; Secondary aura: indigo|20; Score vector: ' + AURA_SCORE + '; Questions answered: 7/7';

test('aura V2 AQ1 evidence passes the deterministic + family gate', () => {
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Aura Color',
    tool: '/pages/aura-color-quiz',
    presentationVariant: 'aura-v2',
    question: 'I keep sensing what a relationship needs before it is said and then feel unseen myself.',
    focus: 'Love & Relationships',
    scope: AURA_SCOPE,
    confidence: AURA_CONFIDENCE,
    signals: auraSignals,
    context: AURA_CONTEXT
  });
  assert.deepEqual(validation, { ok: true, code: 'OK', missing: [] });
});

test('aura V2 tampered score vector fails the deterministic contract', () => {
  const tampered = 'violet:21|indigo:20|blue:0|green:0|yellow:0|orange:0|red:0';
  const tamperedSignals = 'Aura quiz version: AQ1; Answer vector: ' + AURA_VECTOR + '; Primary aura: violet|22; Secondary aura: indigo|20; Score vector: ' + tampered + '; Questions answered: 7/7';
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Aura Color',
    tool: '/pages/aura-color-quiz',
    presentationVariant: 'aura-v2',
    question: 'I keep sensing what a relationship needs before it is said and then feel unseen myself.',
    focus: 'Love & Relationships',
    scope: AURA_SCOPE,
    confidence: AURA_CONFIDENCE,
    signals: tamperedSignals,
    context: AURA_CONTEXT
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.code, 'NEW_TOOL_EVIDENCE_MISMATCH');
});
