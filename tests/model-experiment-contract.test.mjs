import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assignFreePreviewModelExperiment,
  deepSeekPricingWindow,
  estimatedModelCostMicros,
  freePreviewPayload,
  normalizedModelUsage,
} from '../lib/legacy-worker.mjs';

const workerPath = new URL('../lib/legacy-worker.mjs', import.meta.url);
const queuePath = new URL('../lib/reading-queue-processor.ts', import.meta.url);

test('free model experiment is off by default and has a hard zero-percent kill switch', async () => {
  const identity = { visitorName: `visitor:${'a'.repeat(64)}` };
  assert.deepEqual(await assignFreePreviewModelExperiment({}, identity), {
    key: '', variant: 'flash_control', challengerPercent: 0, bucket: null,
  });
  assert.deepEqual(await assignFreePreviewModelExperiment({ FREE_MODEL_EXPERIMENT_PERCENT: '0' }, identity), {
    key: '', variant: 'flash_control', challengerPercent: 0, bucket: null,
  });
});

test('free model experiment assignment is stable, server-side, and bounded', async () => {
  const identity = { visitorName: `visitor:${'b'.repeat(64)}` };
  const first = await assignFreePreviewModelExperiment({ FREE_MODEL_EXPERIMENT_PERCENT: '10' }, identity);
  const second = await assignFreePreviewModelExperiment({ FREE_MODEL_EXPERIMENT_PERCENT: '10' }, identity);
  assert.deepEqual(first, second);
  assert.equal(first.key, 'free_answer_model_v1');
  assert.ok(['flash_control', 'pro_full'].includes(first.variant));
  assert.ok(Number.isInteger(first.bucket) && first.bucket >= 0 && first.bucket < 10_000);

  const allChallenger = await assignFreePreviewModelExperiment({ FREE_MODEL_EXPERIMENT_PERCENT: '999' }, identity);
  assert.equal(allChallenger.challengerPercent, 100);
  assert.equal(allChallenger.variant, 'pro_full');
});

test('DeepSeek pricing follows the announced effective time and UTC peak windows', () => {
  const before = Date.parse('2026-08-16T15:59:59.999Z');
  const offPeak = Date.parse('2026-08-16T16:30:00.000Z');
  const peak = Date.parse('2026-08-17T02:00:00.000Z');
  const usage = { inputTokens: 1_000, cachedInputTokens: 200, outputTokens: 100 };

  assert.equal(deepSeekPricingWindow(before), 'legacy');
  assert.equal(deepSeekPricingWindow(offPeak), 'offPeak');
  assert.equal(deepSeekPricingWindow(peak), 'peak');
  assert.equal(estimatedModelCostMicros('deepseek-v4-flash', usage, before), 141);
  assert.equal(estimatedModelCostMicros('deepseek-v4-flash', usage, offPeak), 244);
  assert.equal(estimatedModelCostMicros('deepseek-v4-flash', usage, peak), 487);
  assert.equal(estimatedModelCostMicros('deepseek-v4-pro', usage, peak), 1_461);
});

test('direct DeepSeek cache hits are parsed and charged at the cache-hit rate', () => {
  const usage = normalizedModelUsage({
    usage: {
      prompt_tokens: 1_000,
      completion_tokens: 100,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    },
  });
  assert.deepEqual(usage, { inputTokens: 1_000, outputTokens: 100, cachedInputTokens: 800 });
  assert.equal(estimatedModelCostMicros('deepseek-v4-flash', usage, Date.parse('2026-08-16T16:30:00.000Z')), 116);
});

test('free preview exposes privacy-safe experiment attribution without raw model prompts', () => {
  const payload = freePreviewPayload('a'.repeat(32), '<p>A grounded answer.</p>', {
    question: 'What should I focus on in this relationship?',
    readingId: 'reading_contract_123456',
    lang: 'en',
    locale: 'en-US',
    experimentKey: 'free_answer_model_v1',
    experimentVariant: 'pro_full',
    freePreviewServedModel: 'deepseek-v4-pro',
    freePreviewServedSource: 'model_initial',
    freePreviewAuditStatus: 'passed',
    freePreviewPromptVersion: 'free-answer-grounded-v20',
  });
  assert.equal(payload.experimentKey, 'free_answer_model_v1');
  assert.equal(payload.experimentVariant, 'pro_full');
  assert.equal(payload.servedModel, 'deepseek-v4-pro');
  assert.equal(payload.servedSource, 'model_initial');
  assert.equal(payload.auditStatus, 'passed');
  assert.ok(!('prompt' in payload));
});

test('runtime and Shopify webhook preserve model experiment attribution', async () => {
  const [worker, queue] = await Promise.all([
    readFile(workerPath, 'utf8'),
    readFile(queuePath, 'utf8'),
  ]);
  assert.match(worker, /experimentKey:\s*""[\s\S]{0,180}experimentVariant:\s*""/);
  assert.match(worker, /assignFreePreviewModelExperiment\(env, identity\)/);
  assert.match(worker, /const initialModel = plannedModel/);
  assert.match(worker, /attempt\(retryNudge, initialModel, false, "free-preview-quality-retry"\)/);
  assert.match(worker, /eventName:\s*"reading_model_experiment_assigned"/);
  assert.match(worker, /generationContractVersion:\s*context\.promptVersion/);
  assert.match(worker, /generation_contract_version:\s*fields\.freePreviewPromptVersion/);
  assert.doesNotMatch(worker, /metadata:\s*\{[\s\S]{0,900}promptVersion:\s*context\.promptVersion/);
  assert.match(worker, /if \(fields\.experimentKey === FREE_PREVIEW_MODEL_EXPERIMENT_KEY\)/);
  assert.match(worker, /freePreviewServedModel:\s*replay\.servedModel/);
  assert.match(worker, /freePreviewServedSource:\s*replay\.servedSource/);
  assert.match(queue, /free_answer_model_v1/);
  assert.match(queue, /flash_control/);
  assert.match(queue, /pro_full/);
});
