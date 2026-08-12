export type SharedToolStorefrontTier = 'essential' | 'deeper' | 'indepth';
export type SharedToolPaidTier = 'standard' | 'medium' | 'premium';
export type SharedToolSku = 'READING-DEEP' | 'READING-MEDIUM' | 'READING-PREMIUM';
export type SharedToolContract = Readonly<{
  page: string;
  toolType: string;
  storefrontTier: SharedToolStorefrontTier;
  paidTier: SharedToolPaidTier;
  variantId: string;
  sku: SharedToolSku;
  price: 5.99 | 9.99 | 16.99;
}>;

export const SHARED_TOOL_SOURCE_SHA256: string;
export const SHARED_TOOL_FUNNEL_VERSION: string;
export const SHARED_TOOL_READING_MODE: 'shared_tool';
export const SHARED_TOOL_OFFER_VARIANT: string;
export const SHARED_TOOL_PRODUCTS: Readonly<Record<string, Readonly<{ label: string; e: string; d: string; i: string }>>>;
export const SHARED_TOOL_PAGE_TOOL_TYPES: Readonly<Record<string, string>>;
export const SHARED_TOOL_PAGE_ALLOWED_TIERS: Readonly<Record<string, readonly SharedToolStorefrontTier[]>>;
export const SHARED_TOOL_PAGES: readonly string[];
export const SHARED_TOOL_VARIANT_IDS: readonly string[];
export const SHARED_TOOL_EVENT_NAMES: readonly string[];
export const SHARED_TOOL_COMMERCE_EVENT_NAMES: readonly string[];
export function sharedToolContract(page: unknown, toolType: unknown, storefrontTier: unknown): SharedToolContract | null;
export function sharedToolVariantContract(page: unknown, toolType: unknown, storefrontTier: unknown, expectedVariantId: unknown): SharedToolContract | null;
export function sharedToolPaidOrderContract(page: unknown, toolType: unknown, paidTier: unknown, variantId: unknown, sku: unknown, price: unknown): SharedToolContract | null;
