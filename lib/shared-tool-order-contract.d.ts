import type { ReadingTier, StorefrontTier } from './reading-products';

export type SharedToolOrderVerification =
  | Readonly<{
    ok: true;
    product: Readonly<{
      productKey: 'shared_tool';
      tier: ReadingTier;
      storefrontTier: StorefrontTier;
      variantId: string;
      sku: 'READING-DEEP' | 'READING-MEDIUM' | 'READING-PREMIUM';
      price: 5.99 | 9.99 | 16.99;
    }>;
    verifiedFields: Readonly<Record<string, unknown>>;
  }>
  | Readonly<{ ok: false; reason: string }>;

export function verifySharedToolPaidOrder(input: {
  row: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  line: Record<string, unknown>;
}): SharedToolOrderVerification;
