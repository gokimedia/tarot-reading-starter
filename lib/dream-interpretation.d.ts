export const DREAM_THEME_NAMES: readonly string[];
export const DREAM_TONES: readonly string[];
export const DREAM_PRIVACY_MODE: string;
export type DreamInput = { dream: string; tone: string };
export type DreamTheme = { name: string; reflection: string; question: string };
export type DreamAiOutput = {
  headline: string;
  summary: string;
  themes: DreamTheme[];
  groundingSteps: string[];
  safetyNote: string;
};
export function safeDreamInput(value: unknown): DreamInput | null;
export function dreamLengthBand(dream: unknown): 'under 50 words' | '50–149 words' | '150+ words';
export function safeDreamAiOutput(value: unknown): DreamAiOutput | null;
export function dreamEvidence(input: DreamInput, output: DreamAiOutput): {
  signals: Array<{ label: string; value: string }>;
  context: string;
  scope: string;
  confidence: string;
};
