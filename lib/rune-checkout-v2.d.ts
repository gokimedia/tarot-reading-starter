export type RuneV2CastEntry = Readonly<{
  positionId: string;
  runeIndex: number;
  name: string;
  orientation: 'upright' | 'reversed';
}>;

export const RUNE_V2_PAGE: '/pages/rune-reading';
export const RUNE_V2_TYPE: 'Rune Reading';
export const RUNE_V2_PRESENTATION_VARIANT: 'rune-v2-direct-v1';
export const RUNE_V2_CONTRACT_VERSION: 'rune-checkout-v2';

export type RuneV2Validation =
  | Readonly<{ applies: false; ok: true }>
  | Readonly<{ applies: true; ok: false; reason: string; missing: string[] }>
  | Readonly<{
    applies: true;
    ok: true;
    canonicalSnapshot: Readonly<{
      focusId: string;
      answerId: string;
      answerKind: string;
      timeframeId: string;
      cast: RuneV2CastEntry[];
    }>;
    canonicalCast: string;
    display: Readonly<{ focus: string; answerType: string; timeframe: string; signals: string }>;
    verifiedFields: Readonly<Record<string, unknown>>;
  }>;

export function canonicalRuneV2Cast(cast: unknown): string;
export function validateRuneV2Snapshot(input?: Record<string, unknown>): RuneV2Validation;
export function verifyRuneV2PaidLine(input?: Record<string, unknown>): RuneV2Validation;
