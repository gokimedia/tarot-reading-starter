export type ShopifyReadingProduct = Readonly<{ variantId: string; sku: string; price: number }>;
export type ShopifyReadingVariantResult =
  | Readonly<{ ok: true; product: ShopifyReadingProduct }>
  | Readonly<{
    ok: false;
    kind: 'contract' | 'unavailable' | 'upstream' | 'misconfiguration';
    status: 409 | 422 | 503;
    reason: string;
    upstreamStatus: number;
    upstreamCode?: string;
  }>;

export const SHOPIFY_READING_VARIANT_QUERY: string;
export const SHOPIFY_STOREFRONT_READING_VARIANT_QUERY: string;
export const SHOPIFY_ADMIN_READING_VARIANT_QUERY: string;
export function verifyShopifyReadingVariant(options: {
  variantId: unknown;
  expectedSku: unknown;
  expectedPrice: unknown;
  env?: Record<string, unknown>;
  adminFetch?: (input: string, init: RequestInit, env: Record<string, unknown>) => Promise<Response>;
  storefrontFetch?: (input: string, init: RequestInit) => Promise<Response>;
}): Promise<ShopifyReadingVariantResult>;
