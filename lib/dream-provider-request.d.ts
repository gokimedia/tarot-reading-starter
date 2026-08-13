export const DEEPSEEK_DREAM_MODELS: readonly ['deepseek-v4-flash', 'deepseek-v4-pro'];
export type DreamModelSignals = {
  themes: string[];
  emotionalTone: 'curious' | 'anxious' | 'sad' | 'calm' | 'confused';
  dreamLengthBand: 'under 50 words' | '50–149 words' | '150+ words';
};
export function buildDreamProviderRequest(model: string, value: unknown): Record<string, unknown>;
export function parseDreamProviderEnvelope(value: unknown): {
  content: string;
  inputTokens: number;
  outputTokens: number;
};
