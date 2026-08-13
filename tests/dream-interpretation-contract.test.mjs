import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DREAM_PRIVACY_MODE,
  dreamEvidence,
  dreamModelSignals,
  immediateSafetyOutput,
  needsImmediateSafetyResponse,
  safeDreamAiOutput,
  safeDreamInput,
} from '../lib/dream-interpretation.mjs';
import { buildDreamProviderRequest, parseDreamProviderEnvelope } from '../lib/dream-provider-request.mjs';
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

test('DeepSeek request contains only coarse allowlisted signals, never raw dream or identifiers', () => {
  const canary = 'SECRET_CANARY Alice Example alice@example.com 123 Main Street 203.0.113.19 networkHash-abcdef dreamed of water and a locked door.';
  const signals = dreamModelSignals({ dream: canary, tone: 'curious' });
  assert.deepEqual(signals, {
    themes: ['Water', 'Door or key'],
    emotionalTone: 'curious',
    dreamLengthBand: 'under 50 words',
  });
  const body = buildDreamProviderRequest('deepseek-v4-flash', signals);
  const serialized = JSON.stringify(body);
  assert.match(serialized, /deepseek-v4-flash/);
  assert.match(serialized, /json_object/);
  assert.match(serialized, /"thinking":\{"type":"disabled"\}/);
  const userMessage = body.messages[1].content;
  assert.deepEqual(JSON.parse(userMessage.slice(userMessage.indexOf('{'))), signals);
  assert.doesNotMatch(serialized, /SECRET_CANARY|Alice Example|alice@example\.com|123 Main Street|203\.0\.113\.19|networkHash-abcdef/);
  assert.throws(() => buildDreamProviderRequest('not-deepseek', signals), /unsupported_dream_model/);
});

test('DeepSeek envelope must finish normally before structured output is accepted', () => {
  const base = { message: { content: '{"ok":true}' } };
  assert.equal(parseDreamProviderEnvelope({ choices: [{ ...base, finish_reason: 'stop' }] }).content, '{"ok":true}');
  for (const finish_reason of ['length', 'content_filter', 'insufficient_system_resource']) {
    assert.throws(() => parseDreamProviderEnvelope({ choices: [{ ...base, finish_reason }] }));
  }
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

test('route enforces origin, Supabase quotas, coarse-signal DeepSeek fallback and log-safe failures', () => {
  assert.match(route, /freeReadingBudgets\.claim/);
  assert.match(route, /network:\$\{networkHash\}/);
  assert.match(route, /global:dream_ai_v1/);
  assert.match(route, /const DEEPSEEK_ENDPOINT = 'https:\/\/api\.deepseek\.com\/chat\/completions'/);
  assert.match(route, /const MODEL = 'deepseek-v4-flash'/);
  assert.match(route, /const FALLBACK_MODEL = 'deepseek-v4-pro'/);
  assert.match(route, /buildDreamProviderRequest\(model, signals\)/);
  assert.match(route, /callDeepSeek\(MODEL, signals, 24_000\)/);
  assert.match(route, /callDeepSeek\(FALLBACK_MODEL, signals, 24_000\)/);
  assert.match(route, /DEEPSEEK_DIRECT_API_KEY \|\| process\.env\.DEEPSEEK_API_KEY/);
  assert.doesNotMatch(route, /alibaba\/qwen/);
  assert.doesNotMatch(route, /openai\/gpt/);
  assert.doesNotMatch(route, /gateway\(|Output\.object|zeroDataRetention|disallowPromptTraining/);
  assert.match(route, /needsImmediateSafetyResponse/);
  assert.match(route, /dreamModelSignals\(input\)/);
  assert.match(route, /readBoundedJson\(request, 12_000\)/);
  assert.match(route, /aiUsage\.record/);
  assert.match(route, /page: '\/pages\/dream-interpreter'/);
  assert.doesNotMatch(route, /page: '\/pages\/ai-dream-interpreter'/);
  assert.match(route, /provider: 'deepseek-direct'/);
  assert.match(route, /status: completion\.fallbackFrom \? 'fallback' : 'success'/);
  assert.doesNotMatch(route, /console\.(?:log|warn|error)\([^\n]*(?:input\.dream|source|request\.json)/);
  assert.doesNotMatch(route, /JSON\.stringify\((?:input|source|networkHash)/);
  assert.doesNotMatch(route, /content:[^\n]*input\.dream/);
  assert.match(route, /private, no-store, max-age=0/);
  assert.equal(route.includes('/api/internal/dream-'), false);
});
