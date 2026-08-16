import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const EXPECTED_LIVE_PAGE_COUNT = 60;
const EXPECTED_UNIQUE_VARIANT_COUNT = 75;
const DEAD_PAGE_ALIASES = Object.freeze(['/pages/celtic-cross-reading']);
const BACKEND_CANONICAL_PAGE_TYPES = Object.freeze({
  '/pages/yes-or-no-tarot': 'Yes or No Tarot',
});
const TIERS = Object.freeze([
  ['essential', 'e', 'standard', 'READING-DEEP', 5.99],
  ['deeper', 'd', 'medium', 'READING-MEDIUM', 9.99],
  ['indepth', 'i', 'premium', 'READING-PREMIUM', 16.99],
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function fail(message) {
  throw new Error(`SHARED_TOOL_MANIFEST_${message}`);
}

function objectBody(source, variableName) {
  const marker = new RegExp(`\\bvar\\s+${variableName}\\s*=\\s*\\{`, 'm');
  const match = marker.exec(source);
  if (!match) fail(`${variableName}_MISSING`);
  const start = match.index + match[0].length;
  const end = source.indexOf('};', start);
  if (end < 0) fail(`${variableName}_UNTERMINATED`);
  return source.slice(start, end);
}

function parseProducts(source) {
  const products = {};
  const linePattern = /^\s*"([^"]{1,120})"\s*:\s*\{label:"([^"]{1,120})",e:(\d{8,20}),d:(\d{8,20}),i:(\d{8,20})\},?\s*$/;
  for (const line of objectBody(source, 'DDR_PRODUCTS').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = linePattern.exec(line);
    if (!match) fail('PRODUCT_LINE_INVALID');
    const [, toolType, label, e, d, i] = match;
    if (Object.hasOwn(products, toolType)) fail('PRODUCT_DUPLICATE');
    products[toolType] = { label, e, d, i };
  }
  return products;
}

function parsePages(source) {
  const pages = {};
  const linePattern = /^\s*'([/]pages[/][a-z0-9-]{3,80})'\s*:\s*'([^']{1,120})',?\s*$/;
  for (const line of objectBody(source, 'DDR_PAGE_TOOL_TYPES').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = linePattern.exec(line);
    if (!match) fail('PAGE_LINE_INVALID');
    const [, page, toolType] = match;
    if (Object.hasOwn(pages, page)) fail('PAGE_DUPLICATE');
    pages[page] = toolType;
  }
  return pages;
}

function parseAllowedTiers(source, pages) {
  const policies = Object.fromEntries(Object.keys(pages).map((page) => [page, ['essential', 'deeper', 'indepth']]));
  const linePattern = /^\s*'([/]pages[/][a-z0-9-]{3,80})'\s*:\s*'((?:essential|deeper|indepth)(?:\|(?:essential|deeper|indepth))*)',?\s*$/;
  for (const line of objectBody(source, 'DDR_PAGE_ALLOWED_TIERS').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = linePattern.exec(line);
    if (!match) fail('ALLOWED_TIER_LINE_INVALID');
    const [, page, tierList] = match;
    if (!Object.hasOwn(pages, page)) fail('ALLOWED_TIER_PAGE_UNKNOWN');
    const tiers = [...new Set(tierList.split('|'))];
    if (tiers.length !== tierList.split('|').length) fail('ALLOWED_TIER_DUPLICATE');
    policies[page] = tiers;
  }
  return policies;
}

function parseFlagObject(source, variableName) {
  const body = objectBody(source, variableName).trim();
  if (!body) fail(`${variableName}_EMPTY`);
  const events = [];
  for (const entry of body.split(',')) {
    const match = /^\s*([a-z][a-z0-9_]*)\s*:\s*1\s*$/.exec(entry);
    if (!match) fail(`${variableName}_ENTRY_INVALID`);
    if (events.includes(match[1])) fail(`${variableName}_DUPLICATE`);
    events.push(match[1]);
  }
  return events;
}

function quotedConstant(source, variableName) {
  const match = new RegExp(`\\bvar\\s+${variableName}\\s*=\\s*'([^']+)'\\s*;`).exec(source);
  if (!match) fail(`${variableName}_MISSING`);
  return match[1];
}

function priceArray(source, variableName) {
  const match = new RegExp(`\\bvar\\s+${variableName}\\s*=\\s*\\[([^\\]]+)\\]\\s*;`).exec(source);
  if (!match) fail(`${variableName}_MISSING`);
  const prices = match[1].split(',').map((value) => Number(value.trim()));
  if (prices.length !== TIERS.length || prices.some((price) => !Number.isFinite(price) || price <= 0)) {
    fail(`${variableName}_INVALID`);
  }
  return prices;
}

function validate(products, pages, allowedTiers, sharedEvents, commerceEvents) {
  const pageCount = Object.keys(pages).length;
  if (pageCount !== EXPECTED_LIVE_PAGE_COUNT && pageCount !== EXPECTED_LIVE_PAGE_COUNT + DEAD_PAGE_ALIASES.length) {
    fail('PAGE_COUNT_MISMATCH');
  }
  for (const toolType of Object.values(pages)) {
    if (!Object.hasOwn(products, toolType)) fail('PAGE_PRODUCT_MISSING');
  }
  if (Object.keys(allowedTiers).length !== pageCount) fail('ALLOWED_TIER_PAGE_COUNT_MISMATCH');
  for (const [page, tiers] of Object.entries(allowedTiers)) {
    if (!Object.hasOwn(pages, page) || !Array.isArray(tiers) || tiers.length < 1) fail('ALLOWED_TIER_POLICY_INVALID');
  }
  const variants = Object.values(products).flatMap((product) => [product.e, product.d, product.i]);
  if (new Set(variants).size !== EXPECTED_UNIQUE_VARIANT_COUNT) fail('VARIANT_COUNT_MISMATCH');
  if (commerceEvents.some((event) => !sharedEvents.includes(event))) fail('COMMERCE_EVENT_NOT_SHARED');
}

function literal(value) {
  return JSON.stringify(value, null, 2);
}

function render({ products, pages, allowedTiers, sharedEvents, commerceEvents, funnelVersion, offerVariant, sourceDigest }) {
  return `// Generated by scripts/generate-shared-tool-manifest.mjs. Do not hand-edit.\n` +
`// Source contract SHA-256: ${sourceDigest}\n` +
`export const SHARED_TOOL_SOURCE_SHA256 = ${JSON.stringify(sourceDigest)};\n` +
`export const SHARED_TOOL_FUNNEL_VERSION = ${JSON.stringify(funnelVersion)};\n` +
`export const SHARED_TOOL_READING_MODE = 'shared_tool';\n` +
`export const SHARED_TOOL_OFFER_VARIANT = ${JSON.stringify(offerVariant)};\n` +
`export const SHARED_TOOL_PRODUCTS = deepFreeze(${literal(products)});\n` +
`export const SHARED_TOOL_PAGE_TOOL_TYPES = Object.freeze(${literal(pages)});\n` +
`export const SHARED_TOOL_PAGE_ALLOWED_TIERS = deepFreeze(${literal(allowedTiers)});\n` +
`export const SHARED_TOOL_PAGES = Object.freeze(Object.keys(SHARED_TOOL_PAGE_TOOL_TYPES));\n` +
`export const SHARED_TOOL_VARIANT_IDS = Object.freeze([...new Set(Object.values(SHARED_TOOL_PRODUCTS).flatMap((product) => [product.e, product.d, product.i]))]);\n` +
`export const SHARED_TOOL_EVENT_NAMES = Object.freeze(${literal(sharedEvents)});\n` +
`export const SHARED_TOOL_COMMERCE_EVENT_NAMES = Object.freeze(${literal(commerceEvents)});\n` +
`const TIER_CONTRACT = Object.freeze(${literal(Object.fromEntries(TIERS.map(([storefrontTier, key, paidTier, sku, price]) => [storefrontTier, { key, paidTier, sku, price }])))});\n\n` +
`function deepFreeze(value) {\n  for (const entry of Object.values(value)) Object.freeze(entry);\n  return Object.freeze(value);\n}\n\n` +
`export function sharedToolContract(page, toolType, storefrontTier) {\n` +
`  const canonicalPage = String(page || '').trim();\n` +
`  const canonicalType = String(toolType || '').trim();\n` +
`  const tier = TIER_CONTRACT[String(storefrontTier || '').trim().toLowerCase()];\n` +
`  const allowedTiers = SHARED_TOOL_PAGE_ALLOWED_TIERS[canonicalPage];\n` +
`  if (!tier || !allowedTiers || !allowedTiers.includes(String(storefrontTier || '').trim().toLowerCase()) || SHARED_TOOL_PAGE_TOOL_TYPES[canonicalPage] !== canonicalType) return null;\n` +
`  const product = SHARED_TOOL_PRODUCTS[canonicalType];\n` +
`  if (!product) return null;\n` +
`  return { page: canonicalPage, toolType: canonicalType, storefrontTier: String(storefrontTier).trim().toLowerCase(), paidTier: tier.paidTier, variantId: product[tier.key], sku: tier.sku, price: tier.price };\n` +
`}\n\n` +
`export function sharedToolVariantContract(page, toolType, storefrontTier, expectedVariantId) {\n` +
`  const contract = sharedToolContract(page, toolType, storefrontTier);\n` +
`  return contract && contract.variantId === String(expectedVariantId || '').trim() ? contract : null;\n` +
`}\n\n` +
`export function sharedToolPaidOrderContract(page, toolType, paidTier, variantId, sku, price) {\n` +
`  const normalizedTier = String(paidTier || '').trim().toLowerCase();\n` +
`  const storefrontTier = normalizedTier === 'premium' ? 'indepth' : normalizedTier === 'medium' ? 'deeper' : normalizedTier === 'standard' ? 'essential' : '';\n` +
`  const contract = sharedToolContract(page, toolType, storefrontTier);\n` +
`  const numericPrice = Number(price);\n` +
`  return contract && contract.paidTier === normalizedTier && contract.variantId === String(variantId || '').trim() && contract.sku === String(sku || '').trim().toUpperCase() && Number.isFinite(numericPrice) && Math.abs(contract.price - numericPrice) <= 0.001 ? contract : null;\n` +
`}\n`;
}

const themePath = resolve(argument('--theme') || process.env.DECKAURA_THEME_CONTRACT_SOURCE || '');
const outputPath = resolve(argument('--out') || 'lib/generated/shared-tool-manifest.mjs');
if (!argument('--theme') && !process.env.DECKAURA_THEME_CONTRACT_SOURCE) fail('THEME_PATH_REQUIRED');
const source = await readFile(themePath, 'utf8');
const products = parseProducts(source);
const themePages = parsePages(source);
const pages = {
  ...Object.fromEntries(Object.entries(themePages).filter(([page]) => !DEAD_PAGE_ALIASES.includes(page))),
  ...BACKEND_CANONICAL_PAGE_TYPES,
};
const themeAllowedTiers = parseAllowedTiers(source, themePages);
const allowedTiers = {
  ...Object.fromEntries(Object.entries(themeAllowedTiers).filter(([page]) => !DEAD_PAGE_ALIASES.includes(page))),
  ...Object.fromEntries(Object.keys(BACKEND_CANONICAL_PAGE_TYPES).map((page) => [page, ['essential', 'deeper', 'indepth']])),
};
const sharedEvents = parseFlagObject(source, 'DDR_SHARED_EVENTS');
const commerceEvents = parseFlagObject(source, 'DDR_COMMERCE_EVENTS');
const defaultPrices = priceArray(source, 'DEF_PRICES');
const premiumPrices = priceArray(source, 'PREM_PRICES');
if (defaultPrices.some((price, index) => Math.abs(price - TIERS[index][4]) > 0.001)
  || premiumPrices.some((price, index) => Math.abs(price - TIERS[index][4]) > 0.001)) {
  fail('PRICE_CONTRACT_MISMATCH');
}
validate(products, themePages, themeAllowedTiers, sharedEvents, commerceEvents);
if (Object.keys(pages).length !== EXPECTED_LIVE_PAGE_COUNT + Object.keys(BACKEND_CANONICAL_PAGE_TYPES).length) fail('LIVE_PAGE_COUNT_MISMATCH');
const sourceDigest = createHash('sha256').update([
  objectBody(source, 'DDR_PRODUCTS'),
  objectBody(source, 'DDR_PAGE_TOOL_TYPES'),
  objectBody(source, 'DDR_PAGE_ALLOWED_TIERS'),
  objectBody(source, 'DDR_SHARED_EVENTS'),
  objectBody(source, 'DDR_COMMERCE_EVENTS'),
  defaultPrices.join(','),
  premiumPrices.join(','),
].join('\n---\n')).digest('hex');
const output = render({
  products,
  pages,
  allowedTiers,
  sharedEvents,
  commerceEvents,
  funnelVersion: quotedConstant(source, 'DDR_FUNNEL_VERSION'),
  offerVariant: quotedConstant(source, 'DDR_OFFER_VARIANT'),
  sourceDigest,
});

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== output) fail('DRIFT_DETECTED');
} else {
  await writeFile(outputPath, output, 'utf8');
}
