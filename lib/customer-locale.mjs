import { CUSTOMER_LOCALE_REGISTRY, DEFAULT_CUSTOMER_LOCALE } from './generated/customer-locale-registry.mjs';

const DEFAULT_LOCALE = DEFAULT_CUSTOMER_LOCALE;
const defaultLocaleByLanguage = new Map();
const definitionByAlias = new Map();
const storefrontPrefixByAlias = new Map();
for (const [canonical, definition] of Object.entries(CUSTOMER_LOCALE_REGISTRY)) {
  for (const alias of definition.aliases) definitionByAlias.set(alias, { canonical, ...definition });
  for (const [alias, prefix] of Object.entries(definition.aliasStorefrontPrefixes || {})) storefrontPrefixByAlias.set(alias, prefix);
  if (definition.defaultForLanguage) defaultLocaleByLanguage.set(definition.language, canonical);
}

function clean(value, maximum = 40) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

export function normalizeCustomerLocale(value, fallback = DEFAULT_LOCALE) {
  const supplied = clean(value, 35).replace(/_/g, '-');
  const candidate = /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i.test(supplied)
    ? supplied
    : clean(fallback, 35).replace(/_/g, '-');
  try {
    const canonical = Intl.getCanonicalLocales(candidate || DEFAULT_LOCALE)[0] || DEFAULT_LOCALE;
    if (!canonical.includes('-')) return defaultLocaleByLanguage.get(canonical.toLowerCase()) || canonical;
    return canonical;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function customerLanguage(value, fallback = DEFAULT_LOCALE) {
  return normalizeCustomerLocale(value, fallback).split('-')[0].toLowerCase();
}

export function acceptLanguageLocale(value, fallback = DEFAULT_LOCALE) {
  const first = clean(value, 200).split(',')[0].split(';')[0].trim();
  return normalizeCustomerLocale(first, fallback);
}

function isoCode(value, length) {
  const normalized = clean(value, length).toUpperCase();
  return new RegExp(`^[A-Z]{${length}}$`).test(normalized) ? normalized : '';
}

export function customerLocaleContext(input = {}, headers) {
  const acceptLanguage = headers && typeof headers.get === 'function'
    ? headers.get('accept-language')
    : '';
  const locale = normalizeCustomerLocale(
    input.locale || input.language || input.lang,
    acceptLanguageLocale(acceptLanguage, DEFAULT_LOCALE),
  );
  return Object.freeze({
    locale,
    language: customerLanguage(locale),
    country: isoCode(input.country || input.countryCode, 2),
    currency: isoCode(input.currency || input.currencyCode, 3),
    market: clean(input.market || input.marketHandle, 64).toLowerCase().replace(/[^a-z0-9_-]/g, ''),
  });
}

export function storefrontPath(locale, path) {
  const safePath = String(path || '/').startsWith('/') ? String(path || '/') : `/${path}`;
  const normalized = normalizeCustomerLocale(locale).toLowerCase();
  const aliasPrefix = storefrontPrefixByAlias.get(normalized);
  if (aliasPrefix) return `/${aliasPrefix}${safePath}`.replace(/\/{2,}/g, '/');
  const definition = definitionByAlias.get(normalized);
  const language = customerLanguage(normalized);
  if (language === 'en') return safePath;
  const prefix = normalized.includes('-') ? normalized : definition?.storefrontPrefix;
  if (prefix) return `/${prefix}${safePath}`.replace(/\/{2,}/g, '/');
  return `/${language}${safePath}`.replace(/\/{2,}/g, '/');
}
