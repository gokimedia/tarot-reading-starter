import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const PAID_READING_AUTHORITY_RECEIPT_VERSION = 'paid-reading-authority-receipt-v2';
export const PAID_READING_AUTHORITY_RECEIPT_TTL_SECONDS = 60 * 60 * 24 * 365;
export const MAX_PAID_READING_AUTHORITY_RECEIPT_BYTES = 512 * 1024;

const RECEIPT_DOMAIN = 'deckaura:paid-reading-authority-receipt:v2\0';
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const HEX_64_PATTERN = /^[a-f0-9]{64}$/;
const AUTHORITY_KINDS = new Set(['checkout', 'intent', 'preview', 'numerology']);

function boundedText(value, limit) {
  return String(value == null ? '' : value).trim().slice(0, limit);
}

function exactObjectKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

export function canonicalPaidReadingReceiptJson(value) {
  let encoded = '';
  try {
    encoded = JSON.stringify(value);
    if (!encoded || Buffer.byteLength(encoded, 'utf8') > MAX_PAID_READING_AUTHORITY_RECEIPT_BYTES) {
      throw new Error('receipt size');
    }
    return JSON.stringify(canonicalValue(JSON.parse(encoded)));
  } catch {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
  }
}

function canonicalDecimal(value) {
  const raw = boundedText(value, 32);
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(raw)) {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
  }
  const [wholeRaw, fractionRaw = ''] = raw.split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionRaw.replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function canonicalIso(value) {
  const raw = boundedText(value, 80);
  const parsed = Date.parse(raw);
  if (!raw || !Number.isFinite(parsed)) throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
  return new Date(parsed).toISOString();
}

function canonicalLineProperties(line) {
  const properties = Array.isArray(line?.properties) ? line.properties : [];
  return properties.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
    }
    const name = boundedText(entry.name ?? entry.key, 100).toLowerCase();
    const value = boundedText(entry.value, 400);
    if (!name) throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
    return { name, value };
  }).sort((left, right) => left.name.localeCompare(right.name) || left.value.localeCompare(right.value));
}

export function paidReadingAuthorityLineKey(line, index = 0) {
  const lineId = boundedText(line?.id, 96);
  const variantId = boundedText(line?.variant_id, 64);
  const sku = boundedText(line?.sku, 80).toUpperCase();
  return lineId ? `id:${lineId}` : `index:${index}:${variantId}:${sku}`;
}

export function paidReadingAuthorityTransportContext({
  orderId,
  payloadSha256,
  payload,
  line,
  lineIndex = 0,
}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || !line || typeof line !== 'object' || Array.isArray(line)) {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
  }
  const normalizedOrderId = boundedText(orderId, 96);
  const payloadOrderId = boundedText(payload.id, 96);
  const sourcePayloadSha256 = boundedText(payloadSha256, 64).toLowerCase();
  const variantId = boundedText(line.variant_id, 64);
  const sku = boundedText(line.sku, 80).toUpperCase();
  const lineKey = paidReadingAuthorityLineKey(line, lineIndex);
  const quantity = Number(line.quantity);
  const financialStatus = boundedText(payload.financial_status, 32).toLowerCase();
  const currency = boundedText(payload.currency, 3).toUpperCase();
  if (!normalizedOrderId || normalizedOrderId !== payloadOrderId
    || !HEX_64_PATTERN.test(sourcePayloadSha256)
    || !variantId || !sku || !lineKey
    || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100
    || financialStatus !== 'paid' || !/^[A-Z]{3}$/.test(currency)) {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
  }
  const lineProjection = {
    lineKey,
    variantId,
    sku,
    quantity,
    unitPrice: canonicalDecimal(line.price),
    properties: canonicalLineProperties(line),
  };
  const lineDigest = createHash('sha256')
    .update(canonicalPaidReadingReceiptJson(lineProjection), 'utf8')
    .digest('hex');
  const orderProjection = {
    orderId: normalizedOrderId,
    createdAt: canonicalIso(payload.created_at),
    financialStatus,
    currency,
    protectedReadingLines: [lineProjection],
  };
  const orderDigest = createHash('sha256')
    .update(canonicalPaidReadingReceiptJson(orderProjection), 'utf8')
    .digest('hex');
  return {
    orderId: normalizedOrderId,
    sourcePayloadSha256,
    orderDigest,
    lineKey,
    lineDigest,
    variantId,
    sku,
  };
}

function envValue(env, name) {
  return boundedText(env?.[name] ?? process.env[name], name.endsWith('_SECRET') ? 2048 : 128);
}

export function paidReadingAuthorityReceiptKeyring(env = {}) {
  const current = {
    keyId: envValue(env, 'PAID_READING_AUTHORITY_RECEIPT_KEY_ID'),
    secret: envValue(env, 'PAID_READING_AUTHORITY_RECEIPT_SECRET'),
  };
  const previous = {
    keyId: envValue(env, 'PAID_READING_AUTHORITY_RECEIPT_PREVIOUS_KEY_ID'),
    secret: envValue(env, 'PAID_READING_AUTHORITY_RECEIPT_PREVIOUS_SECRET'),
  };
  if (!KEY_ID_PATTERN.test(current.keyId) || !current.secret || current.secret.length < 32) {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_SECRET_MISSING');
  }
  const hasPrevious = Boolean(previous.keyId || previous.secret);
  if (hasPrevious && (!KEY_ID_PATTERN.test(previous.keyId) || previous.secret.length < 32)) {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_KEYRING_INVALID');
  }
  if (hasPrevious && previous.keyId === current.keyId) {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_KEYRING_INVALID');
  }
  return { current, previous: hasPrevious ? previous : null };
}

function receiptSignature(body, secret) {
  return createHmac('sha256', secret)
    .update(RECEIPT_DOMAIN, 'utf8')
    .update(canonicalPaidReadingReceiptJson(body), 'utf8')
    .digest('hex');
}

function secureHexEqual(left, right) {
  if (!HEX_64_PATTERN.test(left) || !HEX_64_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function paidReadingAuthorityReceiptKey(orderId) {
  const normalizedOrderId = boundedText(orderId, 96);
  if (!normalizedOrderId) throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
  const digest = createHash('sha256').update(`paid-reading-authority:${normalizedOrderId}`, 'utf8').digest('hex');
  return `paid-authority-receipt:${digest}`;
}

export function paidReadingAuthorityDigest(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || !receipt.orderId || !receipt.orderDigest || !receipt.lineDigest
    || !receipt.variantId || !receipt.sku || !AUTHORITY_KINDS.has(receipt.authorityKind)
    || !receipt.authorities || typeof receipt.authorities !== 'object' || Array.isArray(receipt.authorities)) {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
  }
  return createHash('sha256').update(canonicalPaidReadingReceiptJson({
    orderId: receipt.orderId,
    orderDigest: receipt.orderDigest,
    lineKey: receipt.lineKey,
    lineDigest: receipt.lineDigest,
    variantId: receipt.variantId,
    sku: receipt.sku,
    accessToken: receipt.accessToken,
    authorityKind: receipt.authorityKind,
    authorities: receipt.authorities,
  }), 'utf8').digest('hex');
}

export function createPaidReadingAuthorityReceipt({ context, authorityKind, authorities, accessToken, issuedAt, expiresAt }, env = {}) {
  const keyring = paidReadingAuthorityReceiptKeyring(env);
  if (!context || !AUTHORITY_KINDS.has(authorityKind)
    || !authorities || typeof authorities !== 'object' || Array.isArray(authorities)
    || !/^[a-f0-9]{32}$/i.test(boundedText(accessToken, 32))) {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
  }
  const issuedAtMs = Number.isSafeInteger(issuedAt) && issuedAt > 0 ? issuedAt : Date.now();
  const expiresAtMs = Number.isSafeInteger(expiresAt) && expiresAt > issuedAtMs
    ? expiresAt
    : issuedAtMs + PAID_READING_AUTHORITY_RECEIPT_TTL_SECONDS * 1_000;
  const body = {
    receiptVersion: PAID_READING_AUTHORITY_RECEIPT_VERSION,
    keyId: keyring.current.keyId,
    issuedAt: issuedAtMs,
    expiresAt: expiresAtMs,
    orderId: context.orderId,
    sourcePayloadSha256: context.sourcePayloadSha256,
    orderDigest: context.orderDigest,
    lineKey: context.lineKey,
    lineDigest: context.lineDigest,
    variantId: context.variantId,
    sku: context.sku,
    accessToken: boundedText(accessToken, 32).toLowerCase(),
    authorityKind,
    authorities,
  };
  const receipt = { ...body, signature: receiptSignature(body, keyring.current.secret) };
  if (Buffer.byteLength(JSON.stringify(receipt), 'utf8') > MAX_PAID_READING_AUTHORITY_RECEIPT_BYTES) {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
  }
  return receipt;
}

export function verifyPaidReadingAuthorityReceipt(raw, context, env = {}) {
  if (typeof raw !== 'string' || !raw
    || Buffer.byteLength(raw, 'utf8') > MAX_PAID_READING_AUTHORITY_RECEIPT_BYTES) {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
  }
  if (!exactObjectKeys(parsed, [
    'receiptVersion', 'keyId', 'issuedAt', 'expiresAt', 'orderId', 'sourcePayloadSha256', 'orderDigest', 'lineKey', 'lineDigest',
    'variantId', 'sku', 'accessToken', 'authorityKind', 'authorities', 'signature',
  ]) || !exactObjectKeys(parsed.authorities, ['numerology', 'checkout', 'intent', 'preview'])) {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
  }
  const body = {
    receiptVersion: parsed.receiptVersion,
    keyId: parsed.keyId,
    issuedAt: parsed.issuedAt,
    expiresAt: parsed.expiresAt,
    orderId: parsed.orderId,
    sourcePayloadSha256: parsed.sourcePayloadSha256,
    orderDigest: parsed.orderDigest,
    lineKey: parsed.lineKey,
    lineDigest: parsed.lineDigest,
    variantId: parsed.variantId,
    sku: parsed.sku,
    accessToken: parsed.accessToken,
    authorityKind: parsed.authorityKind,
    authorities: parsed.authorities,
  };
  const keyring = paidReadingAuthorityReceiptKeyring(env);
  const verificationKey = body.keyId === keyring.current.keyId
    ? keyring.current
    : body.keyId === keyring.previous?.keyId
      ? keyring.previous
      : null;
  const signature = boundedText(parsed.signature, 64).toLowerCase();
  if (!verificationKey
    || body.receiptVersion !== PAID_READING_AUTHORITY_RECEIPT_VERSION
    || !Number.isSafeInteger(body.issuedAt) || body.issuedAt <= 0
    || !Number.isSafeInteger(body.expiresAt) || body.expiresAt <= body.issuedAt
    || body.expiresAt <= Date.now()
    || !AUTHORITY_KINDS.has(body.authorityKind)
    || !/^[a-f0-9]{32}$/.test(boundedText(body.accessToken, 32).toLowerCase())
    || !HEX_64_PATTERN.test(boundedText(body.sourcePayloadSha256, 64).toLowerCase())
    || !secureHexEqual(receiptSignature(body, verificationKey.secret), signature)
    || body.orderId !== context?.orderId
    || body.orderDigest !== context?.orderDigest
    || body.lineKey !== context?.lineKey
    || body.lineDigest !== context?.lineDigest
    || body.variantId !== context?.variantId
    || body.sku !== context?.sku) {
    throw new Error('PAID_READING_AUTHORITY_RECEIPT_INVALID');
  }
  return { ...body, signature };
}

export function paidReadingDraftMatchesReceipt(draft, receipt) {
  return Boolean(draft && receipt
    && draft.orderId === receipt.orderId
    && draft.accessToken === receipt.accessToken
    && draft.authorityReceiptVersion === receipt.receiptVersion
    && draft.authorityReceiptKeyId === receipt.keyId
    && draft.authorityReceiptSignature === receipt.signature
    && draft.authorityReceiptKind === receipt.authorityKind
    && draft.authorityReceiptOrderDigest === receipt.orderDigest
    && draft.authorityReceiptLineDigest === receipt.lineDigest);
}
