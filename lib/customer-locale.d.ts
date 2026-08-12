export type CustomerLocaleContext = Readonly<{
  locale: string;
  language: string;
  country: string;
  currency: string;
  market: string;
}>;

export function normalizeCustomerLocale(value: unknown, fallback?: string): string;
export function customerLanguage(value: unknown, fallback?: string): string;
export function acceptLanguageLocale(value: unknown, fallback?: string): string;
export function customerLocaleContext(
  input?: Record<string, unknown>,
  headers?: Pick<Headers, 'get'>,
): CustomerLocaleContext;
export function storefrontPath(locale: unknown, path: string): string;
