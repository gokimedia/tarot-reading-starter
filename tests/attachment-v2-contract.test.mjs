import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateReadingFields } from '../lib/legacy-worker.mjs';

// Attachment Style V2 sells three tiers (My Attachment Pattern Snapshot / Signal
// vs Trigger Decoder / Secure Next-Step Blueprint). These checks pin the paid
// pipeline to the page copy and prove the AS1 evidence shape passes both the
// deterministic reproduction contract and the wellness family gate. Attachment
// tendencies are reflective, never a clinical diagnosis or fixed identity.
const source = await readFile(new URL('../lib/legacy-worker.mjs', import.meta.url), 'utf8');

test('attachment V2 marker pins the presentation variant and page', () => {
  assert.match(source, /function isAttachmentV2\(fields = \{\}\) \{\s*return normalizeContractText\(fields\.presentationVariant\) === "attachment-v2"\s*&& normalizeContractText\(fields\.tool\) === "\/pages\/attachment-style-quiz";/);
});

test('attachment V2 word bands mirror the page copy (500-650 / 850-1,050 / 1,500-1,800)', () => {
  const branch = source.match(/if \(isAttachmentV2\(fields\)\) \{[\s\S]{0,900}?\n {2}\}/);
  assert.ok(branch, 'word-band branch missing');
  assert.match(branch[0], /premium[\s\S]{0,80}minWords: 1500, maxWords: 1800/);
  assert.match(branch[0], /medium[\s\S]{0,80}minWords: 850, maxWords: 1050/);
  assert.match(branch[0], /standard", minWords: 500, maxWords: 650/);
});

test('attachment V2 package contract sells the three page tiers verbatim', () => {
  assert.match(source, /My Attachment Pattern Snapshot: answer the exact paid question/);
  assert.match(source, /Signal vs Trigger Decoder: answer the exact paid question/);
  assert.match(source, /Secure Next-Step Blueprint: answer the exact paid question/);
  assert.match(source, /never a clinical diagnosis, a validated psychological assessment, a fixed label as identity/);
  assert.match(source, /green, yellow and red signal table/);
  assert.match(source, /stay, clarify or step-back decision map/);
  assert.match(source, /reciprocity, consistency and follow-through/);
  assert.match(source, /30-day secure-response practice plan/);
});

// All-3 answers -> connection anxiety 15, distance response 15, secure base 18
// (deterministic AS1 reproduction: sums over the fixed dimension indices).
const AS1_VECTOR = 'AS1:3-3-3-3-3-3-3-3-3-3-3-3-3-3-3-3';
const AS1_SCORE = 'connection anxiety:15|distance response:15|secure base:18';
const AS1_SCOPE = "Reflect only on the supplied AS1 answer vector, its three dimension scores and the optional conversation excerpt for the selected relationship context. No diagnosis, no fixed attachment label as identity, no claim about the other person's hidden feelings, no prediction or guaranteed outcome.";
const AS1_CONFIDENCE = 'Deterministic AS1 scoring from 16 canonical 1-5 answers; educational self-reflection, not a validated or clinical psychological assessment.';
const AS1_CONTEXT = 'AS1 deterministic reflective quiz. Answer vector ' + AS1_VECTOR + '. Relationship context current-relationship. Relationship stage dating. Score vector ' + AS1_SCORE + '.';
const attachSignals = 'Attachment quiz version: AS1; Answer vector: ' + AS1_VECTOR + '; Relationship context: current-relationship; Relationship stage: dating; Score vector: ' + AS1_SCORE + '; Questions answered: 16/16';

test('attachment V2 AS1 evidence passes the deterministic + family gate', () => {
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Attachment Style',
    tool: '/pages/attachment-style-quiz',
    presentationVariant: 'attachment-v2',
    question: 'What should I understand about the pattern shaping how I react when they pull away?',
    focus: 'Love & Relationships',
    scope: AS1_SCOPE,
    confidence: AS1_CONFIDENCE,
    signals: attachSignals,
    context: AS1_CONTEXT
  });
  assert.deepEqual(validation, { ok: true, code: 'OK', missing: [] });
});

test('attachment V2 AS1 evidence passes with an optional conversation excerpt', () => {
  const excerpt = 'Them: been really busy this week. Me: no worries, here when you are free.';
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Attachment Style',
    tool: '/pages/attachment-style-quiz',
    presentationVariant: 'attachment-v2',
    question: 'What should I understand about the pattern shaping how I react when they pull away?',
    focus: 'Love & Relationships',
    scope: AS1_SCOPE,
    confidence: AS1_CONFIDENCE,
    signals: attachSignals,
    context: AS1_CONTEXT + ' Conversation excerpt: ' + excerpt
  });
  assert.deepEqual(validation, { ok: true, code: 'OK', missing: [] });
});

test('attachment V2 tampered score vector fails the deterministic contract', () => {
  const tampered = 'connection anxiety:14|distance response:15|secure base:18';
  const tamperedSignals = 'Attachment quiz version: AS1; Answer vector: ' + AS1_VECTOR + '; Relationship context: current-relationship; Relationship stage: dating; Score vector: ' + tampered + '; Questions answered: 16/16';
  const validation = validateReadingFields({
    snapshotVersion: 'reading-snapshot-v2',
    intentKind: 'shared_tool',
    type: 'Attachment Style',
    tool: '/pages/attachment-style-quiz',
    presentationVariant: 'attachment-v2',
    question: 'What should I understand about the pattern shaping how I react when they pull away?',
    focus: 'Love & Relationships',
    scope: AS1_SCOPE,
    confidence: AS1_CONFIDENCE,
    signals: tamperedSignals,
    context: AS1_CONTEXT
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.code, 'NEW_TOOL_EVIDENCE_MISMATCH');
});
