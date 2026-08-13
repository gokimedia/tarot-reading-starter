import { z } from 'zod';
import { DREAM_THEME_NAMES } from './dream-interpretation.mjs';

export const DEEPSEEK_DREAM_MODELS = Object.freeze([
  'deepseek-v4-flash',
  'deepseek-v4-pro',
]);

const OUTPUT_EXAMPLE = Object.freeze({
  headline: 'A threshold beside moving emotion',
  summary: 'This pattern can invite reflection on how emotion and access meet in the situation you are considering. Personal associations matter more than a fixed symbolic dictionary.',
  themes: [Object.freeze({
    name: 'Water',
    reflection: 'Water can support reflection on emotional movement, pace, and what may be difficult to contain.',
    question: 'Which feeling needs room before it needs an explanation?',
  })],
  groundingSteps: Object.freeze([
    'Write one personal association for each listed theme before drawing a conclusion.',
    'Choose one small real-world action that can test the reflection without assuming it is true.',
  ]),
  safetyNote: 'This is symbolic reflection, not a diagnosis, memory claim, factual finding, or prediction.',
});

const SignalsSchema = z.object({
  themes: z.array(z.enum(DREAM_THEME_NAMES)).min(1).max(4),
  emotionalTone: z.enum(['curious', 'anxious', 'sad', 'calm', 'confused']),
  dreamLengthBand: z.enum(['under 50 words', '50–149 words', '150+ words']),
}).strict();

const ProviderEnvelopeSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.literal('stop'),
    message: z.object({ content: z.string().min(2).max(80_000) }).passthrough(),
  }).passthrough()).min(1).max(4),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
  }).passthrough().optional(),
}).passthrough();

export function buildDreamProviderRequest(model, value) {
  if (!DEEPSEEK_DREAM_MODELS.includes(model)) throw new TypeError('unsupported_dream_model');
  const signals = SignalsSchema.parse(value);
  const safeInput = JSON.stringify(signals);
  return {
    model,
    stream: false,
    thinking: { type: 'disabled' },
    temperature: 0.35,
    max_tokens: 900,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'Return one JSON object only, matching the example keys and shape exactly.',
          `Example JSON: ${JSON.stringify(OUTPUT_EXAMPLE)}`,
          `Allowed theme names: ${DREAM_THEME_NAMES.join(', ')}.`,
          'Use every supplied theme exactly once and in the supplied order; do not add a theme.',
          'The supplied values are coarse server-derived signals, not a dream transcript. Do not infer, reconstruct, quote, or invent dream details.',
          'Create restrained symbolic reflection, not prediction, diagnosis, recovered-memory claim, supernatural certainty, private fact about a third party, or guaranteed outcome.',
          'Never mention AI, artificial intelligence, DeepSeek, ChatGPT, a language model, a model provider, Vercel, or an interpretation service in user-visible output.',
          'Be compassionate, concrete, and non-alarmist. Keep all strings inside the lengths demonstrated by the example.',
        ].join(' '),
      },
      { role: 'user', content: `Create JSON from these privacy-minimized signals only: ${safeInput}` },
    ],
  };
}

export function parseDreamProviderEnvelope(value) {
  const payload = ProviderEnvelopeSchema.parse(value);
  return {
    content: payload.choices[0].message.content.trim(),
    inputTokens: payload.usage?.prompt_tokens || 0,
    outputTokens: payload.usage?.completion_tokens || 0,
  };
}
