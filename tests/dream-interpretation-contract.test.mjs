import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DREAM_PRIVACY_MODE,
  dreamEvidence,
  immediateSafetyOutput,
  needsImmediateSafetyResponse,
  safeDreamAiOutput,
  safeDreamInput,
} from '../lib/dream-interpretation.mjs';
import { BoundedJsonBodyError, readBoundedJson } from '../lib/bounded-json-body.mjs';

const route = await readFile(new URL('../app/api/dreams/interpret/route.ts', import.meta.url), 'utf8');

test('dream input and AI output are bounded and evidence excludes raw text', () => {
  const canary = 'SECRET_CANARY My dream had water and a locked door.';
  const input = safeDreamInput({ dream: canary, tone: 'curious' });
  assert.ok(input);
  const output = safeDreamAiOutput({
    headline: 'Water and a threshold shape this reflection',
    summary: 'The dream may be holding emotion beside a question of access or boundaries. Treat the symbols as prompts for your own associations rather than fixed meanings.',
    themes: [
      { name: 'Water', reflection: 'Water can invite attention to emotion, pace, and what is difficult to contain.', question: 'Which feeling needs room before it needs an explanation?' },
      { name: 'Door or key', reflection: 'A locked threshold can reflect access, timing, or a boundary that deserves respect.', question: 'What are you ready to open, and what still needs protection?' },
    ],
    groundingSteps: ['Write one personal association for each symbol before reading it as a pattern.', 'Choose one small boundary or honest conversation to test in real life.'],
    safetyNote: 'This is symbolic reflection, not a diagnosis, memory claim, or prediction.',
  });
  assert.ok(output);
  const evidence = dreamEvidence(input, output);
  assert.equal(evidence.signals[3].value, DREAM_PRIVACY_MODE);
  assert.doesNotMatch(JSON.stringify({ output, evidence }), /SECRET_CANARY/);
});

test('dream contracts reject unapproved labels, duplicate themes and malformed input', () => {
  assert.equal(safeDreamInput({ dream: 'too short', tone: 'curious' }), null);
  assert.equal(safeDreamInput({ dream: 'A sufficiently long symbolic dream description.', tone: 'diagnosed' }), null);
  assert.equal(safeDreamAiOutput({ headline: 'Invalid', summary: 'x', themes: [], groundingSteps: [], safetyNote: '' }), null);
  assert.equal(safeDreamAiOutput({
    headline: 'A valid-length but unsafe theme example',
    summary: 'This summary is deliberately long enough to reach the minimum validation threshold for this contract.',
    themes: [{ name: 'Guaranteed prophecy', reflection: 'This reflection is long enough but its theme is not allowlisted.', question: 'What happens next in this invalid example?' }],
    groundingSteps: ['A sufficiently long first step.', 'A sufficiently long second step.'],
    safetyNote: 'A sufficiently long safety statement.',
  }), null);
});

test('request JSON is byte-bounded even without a Content-Length header', async () => {
  const valid = new Request('https://reading.deckaura.com/api/dreams/interpret', {
    method: 'POST',
    body: JSON.stringify({ dream: 'A sufficiently long dream for this bounded request.', tone: 'calm' }),
  });
  assert.deepEqual(await readBoundedJson(valid, 12_000), { dream: 'A sufficiently long dream for this bounded request.', tone: 'calm' });

  const oversized = new Request('https://reading.deckaura.com/api/dreams/interpret', {
    method: 'POST',
    body: JSON.stringify({ dream: 'x'.repeat(13_000), tone: 'calm' }),
  });
  await assert.rejects(() => readBoundedJson(oversized, 12_000), (error) => error instanceof BoundedJsonBodyError && error.code === 'too_large');

  const malformed = new Request('https://reading.deckaura.com/api/dreams/interpret', { method: 'POST', body: '{"dream":' });
  await assert.rejects(() => readBoundedJson(malformed, 12_000), (error) => error instanceof BoundedJsonBodyError && error.code === 'invalid_json');
});

test('explicit present-tense self-harm intent receives a fixed safety response', () => {
  assert.equal(needsImmediateSafetyResponse('I am going to kill myself tonight and I cannot stay safe.'), true);
  assert.equal(needsImmediateSafetyResponse("I'm going to kill myself tonight."), true);
  assert.equal(needsImmediateSafetyResponse('I plan to end my life today.'), true);
  assert.equal(needsImmediateSafetyResponse('I am suicidal and may act tonight.'), true);
  assert.equal(needsImmediateSafetyResponse('I cannot keep myself safe.'), true);
  for (const phrase of [
    "I'm going to end my life tonight.",
    'I am about to end my life.',
    'I will commit suicide.',
    'I want to commit suicide.',
    'I have a plan to kill myself.',
    'I have decided to kill myself.',
    'I plan on killing myself.',
    'I intend to die tonight.',
    'I might kill myself tonight.',
    'I am planning on killing myself.',
    "I've decided to kill myself.",
  ]) assert.equal(needsImmediateSafetyResponse(phrase), true, phrase);
  assert.equal(needsImmediateSafetyResponse('In my dream I was falling. I woke safe and calm, but now I want to die.'), true);
  assert.equal(needsImmediateSafetyResponse('I dreamed of a storm and I woke safe, but while awake I cannot keep myself safe.'), true);
  assert.equal(needsImmediateSafetyResponse('In the dream I was lost. I woke calm, but tonight I am suicidal and may act.'), true);
  assert.equal(needsImmediateSafetyResponse('I dreamed of a storm. I woke safe, but now I want to die while awake.'), true);
  assert.equal(needsImmediateSafetyResponse('I dreamed I was lost. I woke calm, but right now I might kill myself while awake.'), true);
  assert.equal(needsImmediateSafetyResponse('I dreamed I fell from a bridge, but I feel safe while awake.'), false);
  assert.equal(needsImmediateSafetyResponse('In the dream someone said “I want to die,” but I woke calm and safe.'), false);
  assert.equal(needsImmediateSafetyResponse('In my dream I said I will commit suicide, then I woke calm and safe.'), false);
  const output = immediateSafetyOutput();
  assert.equal(output.urgentSafety, true);
  assert.ok(safeDreamAiOutput(output));
  assert.match(output.summary, /local emergency services or a crisis line/i);
});

test('route enforces origin, Supabase quotas, ZDR, model fallback and log-safe failures', () => {
  assert.match(route, /freeReadingBudgets\.claim/);
  assert.match(route, /network:\$\{networkHash\}/);
  assert.match(route, /global:dream_ai_v1/);
  assert.match(route, /zeroDataRetention:\s*true/);
  assert.match(route, /disallowPromptTraining:\s*true/);
  assert.match(route, /models:\s*\[FALLBACK_MODEL\]/);
  assert.match(route, /reasoning:\s*'none'/);
  assert.match(route, /Never quote the dream verbatim or repeat names, addresses, contact details/);
  assert.match(route, /needsImmediateSafetyResponse/);
  assert.match(route, /readBoundedJson\(request, 12_000\)/);
  assert.match(route, /GatewayError\.isInstance/);
  assert.match(route, /aiUsage\.record/);
  assert.match(route, /modelAttempts/);
  assert.match(route, /canonicalSlug/);
  assert.match(route, /status:\s*delivery\.usedFallback\s*\?\s*'fallback'\s*:\s*'success'/);
  assert.match(route, /fallbackFrom:\s*delivery\.usedFallback\s*\?\s*MODEL/);
  assert.doesNotMatch(route, /console\.(?:log|warn|error)\([^\n]*(?:input\.dream|source|request\.json)/);
  assert.match(route, /private, no-store, max-age=0/);
});
