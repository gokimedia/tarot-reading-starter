export type ShopifyReadingProduct = Readonly<{ variantId: string; sku: string; price: number }>;
export type ShopifyReadingVariantFailure = Readonly<{
    ok: false;
    kind: 'contract' | 'unavailable' | 'upstream' | 'misconfiguration';
    status: 409 | 422 | 503;
    reason: string;
    upstreamStatus: number;
    upstreamCode?: string;
  }>;
export type ShopifyReadingVariantResult =
  | Readonly<{ ok: true; product: ShopifyReadingProduct }>
  | ShopifyReadingVariantFailure;
export type ShopifyReadingQuote = Readonly<{
  variantId: string;
  sku: string;
  price: number;
  priceCents: number;
  currency: string;
  country: string;
}>;
export type ShopifyReadingVariantQuoteResult =
  | Readonly<{ ok: true; quote: ShopifyReadingQuote }>
  | ShopifyReadingVariantFailure;

export const SHOPIFY_READING_VARIANT_QUERY: string;
export const SHOPIFY_STOREFRONT_READING_VARIANT_QUERY: string;
export const SHOPIFY_STOREFRONT_READING_VARIANT_QUOTE_QUERY: string;
export const SHOPIFY_ADMIN_READING_VARIANT_QUERY: string;
export function verifyShopifyReadingVariant(options: {
  variantId: unknown;
  expectedSku: unknown;
  expectedPrice: unknown;
  env?: Record<string, unknown>;
  adminFetch?: (input: string, init: RequestInit, env: Record<string, unknown>) => Promise<Response>;
  storefrontFetch?: (input: string, init: RequestInit) => Promise<Response>;
}): Promise<ShopifyReadingVariantResult>;
export function verifyShopifyReadingVariantQuote(options: {
  variantId: unknown;
  expectedSku: unknown;
  countryCode?: unknown;
  expectedCurrency?: unknown;
  env?: Record<string, unknown>;
  storefrontFetch?: (input: string, init: RequestInit) => Promise<Response>;
}): Promise<ShopifyReadingVariantQuoteResult>;
