import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';
import {
  deliveryRetry,
  funnelStore,
  workerEnvironment,
  type DeliveryJobRow,
  type LifecycleEmailJobRow,
  type WebhookQueueRow,
} from '@/lib/worker-env';
import readingsWorker, {
  deliverDueReadings,
  readingDeliveryDelayMinutes,
  sweepMemberships,
} from '@/lib/legacy-worker.mjs';
import {
  hasAuthoritativeDeliveredOrderEvidence,
  hasConfirmedReadingFulfillment,
  readingIntentPropertiesMatch,
} from '@/lib/reading-delivery-guards.mjs';
import {
  freeTarotPaidPackageAuthority,
  paidReadingDeliveryJobInput,
  shopifyFinancialStatusAllowsReadingFulfillment,
} from '@/lib/free-tarot-payment-contract.mjs';
import { validateNumerologyCompatibilityOrder } from '@/lib/numerology-compatibility-order.mjs';
import { validateNumerologyLifePathOrder } from '@/lib/numerology-life-path-order.mjs';
import {
  checkoutIntentSignatureMatches,
  hashCheckoutIntentSnapshot,
  signCheckoutIntent,
  type CheckoutIntentCanonical,
} from '@/lib/reading-intents';
import { customerLocaleContext, storefrontPath } from '@/lib/customer-locale.mjs';
import {
  SHARED_TOOL_FUNNEL_VERSION,
  SHARED_TOOL_PAGE_TOOL_TYPES,
  SHARED_TOOL_VARIANT_IDS,
} from '@/lib/generated/shared-tool-manifest.mjs';
import { verifySharedToolPaidOrder } from '@/lib/shared-tool-order-contract.mjs';
import { paidQuestionLengthLimit } from '@/lib/personal-direct-reading.mjs';
import {
  ANGEL_NUMBER_FUNNEL_VERSION,
  ANGEL_NUMBER_LIFE_AREAS,
  ANGEL_NUMBER_PACKAGE_SCOPE,
  ANGEL_NUMBER_PAGE,
  ANGEL_NUMBER_SNAPSHOT_VERSION,
  PERSONAL_777_FUNNEL_VERSION,
  PERSONAL_777_PACKAGE_SCOPE,
  angelNumberEvidence,
  isPersonal777Snapshot,
  personal777SupportiveCards,
  safeAngelNumberSnapshot,
} from '@/lib/angel-number';
import {
  BIG_THREE_FOCUSES,
  BIG_THREE_FUNNEL_VERSION,
  BIG_THREE_PACKAGE_SCOPE,
  BIG_THREE_PAGE,
  BIG_THREE_SNAPSHOT_VERSION,
  bigThreeEvidence,
  isBigThreeFocus,
  safeBigThreeSnapshot,
} from '@/lib/big-three';
import {
  BIRTH_CHART_FUNNEL_VERSION,
  BIRTH_CHART_INTENTS,
  BIRTH_CHART_PACKAGE_SCOPE,
  BIRTH_CHART_PAGE,
  BIRTH_CHART_SNAPSHOT_VERSION,
  birthChartQueueSignals,
  birthChartEvidence,
  isBirthChartIntent,
  safeBirthChartSnapshot,
  safeSignedPersistedBirthChartSnapshot,
} from '@/lib/birth-chart';
import {
  DAILY_TAROT_CARD_NAMES,
  DAILY_TAROT_FOCUSES,
  DAILY_TAROT_FUNNEL_VERSION,
  DAILY_TAROT_PACKAGE_SCOPE,
  DAILY_TAROT_PAGE,
  dailyCardForDateKey,
  isDailyTarotFocus,
} from '@/lib/daily-tarot';
import {
  DAILY_HOROSCOPE_FOCUSES,
  DAILY_HOROSCOPE_FUNNEL_VERSION,
  DAILY_HOROSCOPE_PACKAGE_SCOPE,
  DAILY_HOROSCOPE_PAGE,
  DAILY_HOROSCOPE_SNAPSHOT_VERSION,
  dailyHoroscopeEvidence,
  safeDailyHoroscopeSnapshot,
} from '@/lib/daily-horoscope';
import {
  ZODIAC_COMPATIBILITY_FUNNEL_VERSION,
  ZODIAC_COMPATIBILITY_PACKAGE_SCOPE,
  ZODIAC_COMPATIBILITY_PAGE,
  ZODIAC_COMPATIBILITY_SNAPSHOT_VERSION,
  zodiacCompatibilityEvidence,
  safeZodiacCompatibilitySnapshot,
} from '@/lib/zodiac-compatibility';
import {
  MOON_LUNAR_FUNNEL_VERSION,
  MOON_LUNAR_PACKAGE_SCOPE,
  MOON_LUNAR_PAGE,
  MOON_LUNAR_SNAPSHOT_VERSION,
  moonLunarEvidence,
  safeMoonLunarSnapshot,
} from '@/lib/moon-lunar';
import {
  NUMEROLOGY_COMPATIBILITY_FUNNEL_VERSION,
  NUMEROLOGY_COMPATIBILITY_PACKAGE_SCOPE,
  NUMEROLOGY_COMPATIBILITY_PAGE,
  NUMEROLOGY_COMPATIBILITY_SNAPSHOT_VERSION,
  numerologyCompatibilityEvidence,
  safeNumerologyCompatibilitySnapshot,
} from '@/lib/numerology-compatibility';
import {
  LOVE_TAROT_FUNNEL_VERSION,
  LOVE_TAROT_INTENTS,
  LOVE_TAROT_PAGE,
  isLoveRelationshipStatus,
  isLoveTarotIntent,
  isSupportedCheckoutFunnelVersion,
  isValidShopifyLinePrice,
  belongsToDedicatedReadingPipeline,
  shopifyPayloadForLegacyReplay,
  readingPackage,
  readingPackageByVariant,
  loveTarotCardTitle,
  type ReadingTier,
  type YesNoCategory,
} from '@/lib/reading-products';

const WEBHOOK_LEASE_SECONDS = 180;
const DELIVERY_LEASE_SECONDS = 90;
const DELIVERY_HEARTBEAT_MS = 30_000;
const DELIVERY_HEARTBEAT_RETRY_MS = 5_000;
const DEFAULT_WEBHOOK_LIMIT = 20;
const DEFAULT_DELIVERY_LIMIT = 2;
const DEFAULT_MEMBERSHIP_SWEEP_LIMIT = 5;
const MIN_DELIVERY_START_MS = 120_000;
const MIN_MEMBERSHIP_SWEEP_START_MS = 20_000;
const POST_QUEUE_RESERVE_MS = 8_000;
const DEFAULT_LIFECYCLE_EMAIL_LIMIT = 10;
const LIFECYCLE_EMAIL_LEASE_SECONDS = 90;
const MIN_LIFECYCLE_EMAIL_START_MS = 15_000;
const READING_SNAPSHOT_VERSION = 'reading-snapshot-v2';

type JsonObject = Record<string, unknown>;
type WorkerEnvironment = ReturnType<typeof workerEnvironment>;

type PaidDraft = {
  accessToken?: string;
  originalQuestion?: string;
  question?: string;
  name?: string;
  status?: string;
  editCount?: number;
  reviewUntil?: number;
  missingQuestion?: boolean;
  confirmedAt?: number;
  tier?: ReadingTier;
  shopifyVariantId?: string;
  shopifySku?: string;
  verifiedFields?: JsonObject;
  numerology?: JsonObject;
};

type QueueCounters = {
  claimed: number;
  completed: number;
  retryScheduled: number;
  deadLettered: number;
  completionRejected: number;
  ignored: number;
};

export type ReadingQueueRunResult = {
  recoveredWebhooks: number;
  webhooks: QueueCounters;
  deliveries: QueueCounters;
  lifecycleEmails: QueueCounters;
  legacyPostPurchase: JsonObject;
  membershipSweep: JsonObject;
  elapsedMs: number;
  deadlineReached: boolean;
};

class QueueOperationError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = 'QueueOperationError';
    this.code = code;
  }
}

function counters(): QueueCounters {
  return {
    claimed: 0,
    completed: 0,
    retryScheduled: 0,
    deadLettered: 0,
    completionRejected: 0,
    ignored: 0,
  };
}

function positiveInteger(value: unknown, fallback: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function operationalErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'QUEUE_OPERATION_FAILED';
  const candidate = String((error as { code?: unknown; name?: unknown }).code
    || (error as { name?: unknown }).name
    || 'QUEUE_OPERATION_FAILED');
  return candidate.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 96) || 'QUEUE_OPERATION_FAILED';
}

function safeQueueLog(
  event: string,
  error: unknown,
  jobType?: string,
  identifiers: { orderId?: unknown; jobId?: unknown; webhookId?: unknown } = {},
) {
  const orderId = text(identifiers.orderId, 96).replace(/[^A-Za-z0-9_-]/g, '');
  const jobId = text(identifiers.jobId, 96).replace(/[^A-Za-z0-9_-]/g, '');
  const webhookId = text(identifiers.webhookId, 160).replace(/[^A-Za-z0-9_.:-]/g, '');
  console.error({
    event,
    errorCode: operationalErrorCode(error),
    ...(jobType ? { jobType } : {}),
    ...(orderId ? { orderId } : {}),
    ...(jobId ? { jobId } : {}),
    ...(webhookId ? { webhookId } : {}),
  });
}

function startDeliveryLeaseHeartbeat(job: DeliveryJobRow) {
  const leaseToken = job.lease_token;
  if (!leaseToken) throw new QueueOperationError('DELIVERY_LEASE_TOKEN_MISSING');
  let stopped = false;
  let leaseLost = false;
  const initialExpiry = new Date(job.lease_expires_at || 0).getTime();
  let leaseExpiresAtMs = Number.isFinite(initialExpiry) && initialExpiry > Date.now()
    ? initialExpiry
    : Date.now() + DELIVERY_LEASE_SECONDS * 1_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const run = () => {
    if (stopped || leaseLost) return;
    let nextDelayMs = DELIVERY_HEARTBEAT_MS;
    inFlight = (async () => {
      try {
        const result = await deliveryRetry.extendDeliveryLease(
          job.id,
          leaseToken,
          DELIVERY_LEASE_SECONDS,
        );
        if (result.allowed !== true) {
          leaseLost = true;
          safeQueueLog(
            'reading_delivery_lease_lost',
            new QueueOperationError(`DELIVERY_LEASE_${String(result.reason || 'REJECTED').toUpperCase()}`),
            job.job_type,
            { orderId: job.order_id, jobId: job.id },
          );
          return;
        }
        const databaseExpiry = Date.parse(String(result.leaseExpiresAt || ''));
        leaseExpiresAtMs = Number.isFinite(databaseExpiry)
          ? databaseExpiry
          : Date.now() + DELIVERY_LEASE_SECONDS * 1_000;
      } catch (error) {
        if (Date.now() + DELIVERY_HEARTBEAT_RETRY_MS < leaseExpiresAtMs) {
          nextDelayMs = DELIVERY_HEARTBEAT_RETRY_MS;
          safeQueueLog('reading_delivery_heartbeat_retry', error, job.job_type, {
            orderId: job.order_id,
            jobId: job.id,
          });
        } else {
          leaseLost = true;
          safeQueueLog('reading_delivery_heartbeat_failed', error, job.job_type, {
            orderId: job.order_id,
            jobId: job.id,
          });
        }
      }
    })().finally(() => {
      if (!stopped && !leaseLost) {
        const safeDelay = Math.max(1_000, Math.min(nextDelayMs, leaseExpiresAtMs - Date.now() - 5_000));
        timer = setTimeout(run, safeDelay);
      }
    });
  };

  timer = setTimeout(run, DELIVERY_HEARTBEAT_MS);
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await inFlight;
    return !leaseLost && Date.now() < leaseExpiresAtMs;
  };
}

function text(value: unknown, maximum = 400) {
  return String(value ?? '').trim().slice(0, maximum);
}

function validAccessToken(value: unknown) {
  return /^[a-f0-9]{32}$/i.test(String(value || ''));
}

function readingItems(payload: JsonObject) {
  const items = Array.isArray(payload.line_items) ? payload.line_items : [];
  return items.filter((item): item is JsonObject => {
    // Human Design owns its own signed checkout intent, chart audit, report,
    // email, retry, and SLA tables. Its variants deliberately reuse the shared
    // READING-* SKUs, so SKU prefix alone must never duplicate those orders.
    return Boolean(item && typeof item === 'object'
      && /^READING-/.test(text((item as JsonObject).sku, 80).toUpperCase())
      && !belongsToDedicatedReadingPipeline(item));
  });
}

function itemProperty(item: JsonObject, wanted: string[]) {
  const properties = Array.isArray(item.properties) ? item.properties : [];
  for (const property of properties) {
    if (!property || typeof property !== 'object') continue;
    const record = property as JsonObject;
    const key = text(record.name, 100).toLowerCase().replace(/^_/, '');
    if (wanted.includes(key) && record.value != null) return text(record.value, 400);
  }
  return '';
}

function linePresentmentMoney(item: JsonObject, payload: JsonObject) {
  const priceSet = item.price_set && typeof item.price_set === 'object' && !Array.isArray(item.price_set)
    ? item.price_set as JsonObject
    : {};
  const presentment = priceSet.presentment_money && typeof priceSet.presentment_money === 'object' && !Array.isArray(priceSet.presentment_money)
    ? priceSet.presentment_money as JsonObject
    : {};
  return {
    amount: text(presentment.amount, 40),
    currency: text(presentment.currency_code || payload.presentment_currency, 3).toUpperCase(),
  };
}

function orderCountryCode(payload: JsonObject) {
  const shipping = payload.shipping_address && typeof payload.shipping_address === 'object'
    ? payload.shipping_address as JsonObject
    : {};
  const billing = payload.billing_address && typeof payload.billing_address === 'object'
    ? payload.billing_address as JsonObject
    : {};
  return text(shipping.country_code || billing.country_code, 2);
}

function verifiedCustomerContext(snapshot: JsonObject, payload: JsonObject, item: JsonObject) {
  const signed = snapshot.localeContext && typeof snapshot.localeContext === 'object'
    && !Array.isArray(snapshot.localeContext)
    ? snapshot.localeContext as JsonObject
    : null;
  const fallback = {
    locale: payload.customer_locale || itemProperty(item, ['locale', 'language']),
    country: orderCountryCode(payload) || itemProperty(item, ['country']),
    currency: payload.presentment_currency || payload.currency || itemProperty(item, ['currency']),
    market: itemProperty(item, ['market']),
  };
  const context = customerLocaleContext(signed || fallback);
  if (signed) {
    const suppliedLocale = itemProperty(item, ['locale', 'language']);
    const suppliedCountry = itemProperty(item, ['country']);
    const suppliedCurrency = itemProperty(item, ['currency']);
    const suppliedMarket = itemProperty(item, ['market']);
    const localeLanguage = customerLocaleContext({ locale: suppliedLocale }).language;
    if ((suppliedLocale && localeLanguage !== context.language)
      || (suppliedCountry && suppliedCountry.toUpperCase() !== context.country)
      || (suppliedCurrency && suppliedCurrency.toUpperCase() !== context.currency)
      || (suppliedMarket && suppliedMarket.toLowerCase() !== context.market)) {
      throw new QueueOperationError('CHECKOUT_INTENT_LOCALE_MISMATCH');
    }
  }
  return context;
}

const TAROT_PACKAGES = Object.freeze({
  standard: Object.freeze({ variantId: '53782500606225', sku: 'READING-DEEP', price: 5.99, clarifierCount: 2 }),
  medium: Object.freeze({ variantId: '53782500638993', sku: 'READING-MEDIUM', price: 9.99, clarifierCount: 2 }),
  premium: Object.freeze({ variantId: '53782500671761', sku: 'READING-PREMIUM', price: 16.99, clarifierCount: 4 }),
});

type TarotPackageTier = keyof typeof TAROT_PACKAGES;

type VerifiedCheckoutContext = {
  contextId: string;
  tier: TarotPackageTier;
  variantId: string;
  sku: string;
  clarifiers: Array<{ id: number; name: string; isReversed: boolean; position: string }>;
  verifiedFields: JsonObject;
};

type VerifiedReadingIntent = {
  intentId: string;
  tier: ReadingTier;
  variantId: string;
  sku: string;
  price: number;
  category: YesNoCategory;
  intentKind: 'big_three' | 'birth_chart' | 'love_tarot' | 'daily_tarot' | 'daily_horoscope' | 'angel_number' | 'zodiac_compatibility' | 'moon_lunar' | 'numerology_compatibility' | 'shared_tool' | 'yes_no';
  verifiedFields: JsonObject;
};

function packageTierForLineItem(item: JsonObject): TarotPackageTier | null {
  const variantId = text(item.variant_id, 64);
  const sku = text(item.sku, 80).toUpperCase();
  const match = (Object.entries(TAROT_PACKAGES) as Array<[TarotPackageTier, typeof TAROT_PACKAGES.standard]>)
    .find(([, definition]) => definition.variantId === variantId);
  if (!match) return null;
  const [tier, definition] = match;
  if (variantId !== definition.variantId || sku !== definition.sku) {
    throw new QueueOperationError('SHOPIFY_PACKAGE_VARIANT_SKU_MISMATCH');
  }
  const quantity = Math.max(0, Number.parseInt(String(item.quantity || 0), 10) || 0);
  if (quantity !== 1) throw new QueueOperationError('SHOPIFY_PACKAGE_QUANTITY_INVALID');
  // Shopify Markets can convert, round, or explicitly override a variant's
  // catalog price. The signed Shopify webhook is the source of truth for the
  // amount paid; package authorization comes from variant + SKU and, for this
  // funnel, the server-signed checkout context below.
  if (!isValidShopifyLinePrice(item.price)) {
    throw new QueueOperationError('SHOPIFY_PACKAGE_PRICE_MISMATCH');
  }
  const selectedTier = itemProperty(item, ['selected package']);
  if (selectedTier && selectedTier !== tier) throw new QueueOperationError('SHOPIFY_SELECTED_PACKAGE_MISMATCH');
  return tier;
}

function checkoutIntentCanonicalFromRow(row: JsonObject): CheckoutIntentCanonical {
  const expiry = row.expires_at instanceof Date
    ? row.expires_at.toISOString()
    : new Date(String(row.expires_at || '')).toISOString();
  return {
    id: text(row.id, 64),
    expiresAt: expiry,
    page: text(row.page, 160),
    funnelVersion: text(row.funnel_version, 128),
    readingId: text(row.reading_id, 80),
    readingType: text(row.reading_type, 80),
    category: text(row.category, 20),
    deck: text(row.deck, 32),
    question: text(row.question, 400),
    answer: text(row.answer, 20),
    cardName: text(row.card_name, 80),
    cardId: Number(row.card_id),
    tier: text(row.tier, 20),
    variantId: text(row.shopify_variant_id, 64),
    sku: text(row.sku, 80),
    price: Number(row.price),
    intentKind: text(row.intent_kind, 32) || null,
    snapshotHash: text(row.snapshot_hash, 64) || null,
  };
}

async function verifiedReadingIntent(
  items: JsonObject[],
  payload: JsonObject,
): Promise<VerifiedReadingIntent | null> {
  const relevant = items.filter((item) => {
    const variantId = text(item.variant_id, 64);
    const funnelVersion = itemProperty(item, ['funnel version']);
    return Boolean(
      readingPackageByVariant(variantId) && isSupportedCheckoutFunnelVersion(funnelVersion)
      || SHARED_TOOL_VARIANT_IDS.includes(variantId) && funnelVersion === SHARED_TOOL_FUNNEL_VERSION,
    );
  });
  const candidates = items.filter((item) => itemProperty(item, ['checkout intent']));
  if (!candidates.length) {
    if (relevant.length) throw new QueueOperationError('CHECKOUT_INTENT_REQUIRED');
    return null;
  }
  if (candidates.length !== 1) throw new QueueOperationError('CHECKOUT_INTENT_COUNT_INVALID');
  const item = candidates[0];
  const intentId = itemProperty(item, ['checkout intent']);
  const suppliedSignature = itemProperty(item, ['checkout signature']).toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(intentId) || !/^[a-f0-9]{64}$/.test(suppliedSignature)) {
    throw new QueueOperationError('CHECKOUT_INTENT_REFERENCE_INVALID');
  }

  const sql = db();
  const rows = await sql<JsonObject[]>`
    select id, expires_at, order_id, page, funnel_version, reading_id,
           reading_type, category, deck, question, answer, card_name, card_id,
           tier, shopify_variant_id, sku, price, snapshot, signature, status,
           intent_kind, snapshot_hash
      from deckaura.checkout_intents
     where id = ${intentId}::uuid
     limit 1
  `;
  const row = rows[0];
  if (!row) throw new QueueOperationError('CHECKOUT_INTENT_NOT_FOUND');
  if (!isSupportedCheckoutFunnelVersion(row.funnel_version)
    && text(row.funnel_version, 128) !== SHARED_TOOL_FUNNEL_VERSION) {
    throw new QueueOperationError('CHECKOUT_INTENT_VERSION_INVALID');
  }
  const expiresAt = new Date(String(row.expires_at || '')).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new QueueOperationError('CHECKOUT_INTENT_EXPIRED');
  }

  const secret = text(
    process.env.ENTITLEMENT_PEPPER
      || process.env.FREE_ENTITLEMENT_SALT
      || process.env.SHOPIFY_WEBHOOK_SECRET,
    512,
  );
  if (!secret) throw new QueueOperationError('CHECKOUT_INTENT_SECRET_MISSING');
  const snapshot = row.snapshot && typeof row.snapshot === 'object' && !Array.isArray(row.snapshot)
    ? row.snapshot as JsonObject
    : {};
  const intentKind = text(row.intent_kind, 32);
  const knownIntentKind = intentKind === 'big_three' || intentKind === 'birth_chart'
    || intentKind === 'love_tarot' || intentKind === 'daily_tarot'
    || intentKind === 'daily_horoscope' || intentKind === 'angel_number'
    || intentKind === 'zodiac_compatibility' || intentKind === 'moon_lunar'
    || intentKind === 'numerology_compatibility' || intentKind === 'shared_tool';
  if (intentKind && !knownIntentKind) {
    throw new QueueOperationError('CHECKOUT_INTENT_KIND_INVALID');
  }
  let persistedSnapshotHashVerified = false;
  if (knownIntentKind || text(row.snapshot_hash, 64)) {
    const snapshotHash = hashCheckoutIntentSnapshot(snapshot);
    if (!checkoutIntentSignatureMatches(snapshotHash, text(row.snapshot_hash, 64))) {
      throw new QueueOperationError('CHECKOUT_INTENT_SNAPSHOT_INVALID');
    }
    persistedSnapshotHashVerified = true;
  }
  const localeContext = verifiedCustomerContext(snapshot, payload, item);
  const expectedSignature = signCheckoutIntent(checkoutIntentCanonicalFromRow(row), secret);
  const persistedIntentSignatureVerified = checkoutIntentSignatureMatches(expectedSignature, suppliedSignature)
    && checkoutIntentSignatureMatches(text(row.signature, 64), suppliedSignature);
  if (!persistedIntentSignatureVerified) {
    throw new QueueOperationError('CHECKOUT_INTENT_SIGNATURE_INVALID');
  }

  const sharedOrderVerification = intentKind === 'shared_tool'
    ? (() => {
      const presentmentMoney = linePresentmentMoney(item, payload);
      return verifySharedToolPaidOrder({
      row: {
        id: row.id,
        page: row.page,
        funnelVersion: row.funnel_version,
        readingId: row.reading_id,
        readingType: row.reading_type,
        question: row.question,
        tier: row.tier,
        variantId: row.shopify_variant_id,
        sku: row.sku,
        price: row.price,
        snapshotHash: row.snapshot_hash,
      },
      snapshot,
      line: {
        intentKind: itemProperty(item, ['intent kind']),
        toolPage: itemProperty(item, ['tool page']),
        toolType: itemProperty(item, ['tool type']),
        snapshotVersion: itemProperty(item, ['snapshot version']),
        snapshotHash: itemProperty(item, ['snapshot hash']),
        presentmentAmount: presentmentMoney.amount,
        presentmentCurrency: presentmentMoney.currency,
      },
      });
    })()
    : null;
  if (sharedOrderVerification && 'reason' in sharedOrderVerification) {
    throw new QueueOperationError(sharedOrderVerification.reason);
  }
  const sharedProduct: {
    productKey: 'shared_tool';
    tier: ReadingTier;
    storefrontTier: 'essential' | 'deeper' | 'indepth';
    variantId: string;
    sku: string;
    price: number;
  } | null = sharedOrderVerification && 'product' in sharedOrderVerification
    ? sharedOrderVerification.product as {
      productKey: 'shared_tool';
      tier: ReadingTier;
      storefrontTier: 'essential' | 'deeper' | 'indepth';
      variantId: string;
      sku: string;
      price: number;
    }
    : null;
  const product = intentKind === 'shared_tool'
    ? sharedProduct
    : intentKind === 'numerology_compatibility'
    ? readingPackage('numerology_compatibility', text(row.tier, 20) as ReadingTier)
    : intentKind === 'moon_lunar'
    ? readingPackage('moon_lunar', text(row.tier, 20) as ReadingTier)
    : intentKind === 'zodiac_compatibility'
    ? readingPackage('zodiac_compatibility', text(row.tier, 20) as ReadingTier)
    : intentKind === 'daily_horoscope'
    ? readingPackage('daily_horoscope', text(row.tier, 20) as ReadingTier)
    : intentKind === 'angel_number'
    ? readingPackage('angel_number', text(row.tier, 20) as ReadingTier)
    : intentKind === 'big_three'
    ? readingPackage('big_three', text(row.tier, 20) as ReadingTier)
    : intentKind === 'daily_tarot'
    ? readingPackage('daily_tarot', text(row.tier, 20) as ReadingTier)
    : intentKind === 'birth_chart'
      ? readingPackage('birth_chart', text(row.tier, 20) as ReadingTier)
      : readingPackageByVariant(row.shopify_variant_id);
  if (!product
    || product.tier !== text(row.tier, 20)
    || product.sku !== text(row.sku, 80).toUpperCase()
    || Math.abs(product.price - Number(row.price)) > 0.001) {
    throw new QueueOperationError('CHECKOUT_INTENT_PACKAGE_INVALID');
  }
  if (intentKind === 'love_tarot' && product.productKey !== 'yes_no_love') {
    throw new QueueOperationError('CHECKOUT_INTENT_LOVE_PACKAGE_INVALID');
  }
  if (intentKind === 'daily_tarot' && product.productKey !== 'daily_tarot') {
    throw new QueueOperationError('CHECKOUT_INTENT_DAILY_PACKAGE_INVALID');
  }
  if (intentKind === 'daily_horoscope' && product.productKey !== 'daily_horoscope') {
    throw new QueueOperationError('CHECKOUT_INTENT_DAILY_HOROSCOPE_PACKAGE_INVALID');
  }
  if (intentKind === 'birth_chart' && product.productKey !== 'birth_chart') {
    throw new QueueOperationError('CHECKOUT_INTENT_BIRTH_CHART_PACKAGE_INVALID');
  }
  if (intentKind === 'big_three' && product.productKey !== 'big_three') {
    throw new QueueOperationError('CHECKOUT_INTENT_BIG_THREE_PACKAGE_INVALID');
  }
  if (intentKind === 'angel_number' && product.productKey !== 'angel_number') {
    throw new QueueOperationError('CHECKOUT_INTENT_ANGEL_NUMBER_PACKAGE_INVALID');
  }
  if (intentKind === 'zodiac_compatibility' && product.productKey !== 'zodiac_compatibility') {
    throw new QueueOperationError('CHECKOUT_INTENT_ZODIAC_COMPATIBILITY_PACKAGE_INVALID');
  }
  if (intentKind === 'moon_lunar' && product.productKey !== 'moon_lunar') {
    throw new QueueOperationError('CHECKOUT_INTENT_MOON_LUNAR_PACKAGE_INVALID');
  }
  if (intentKind === 'numerology_compatibility' && product.productKey !== 'numerology_compatibility') {
    throw new QueueOperationError('CHECKOUT_INTENT_NUMEROLOGY_COMPATIBILITY_PACKAGE_INVALID');
  }
  const quantity = Math.max(0, Number.parseInt(String(item.quantity || 0), 10) || 0);
  if (text(item.variant_id, 64) !== product.variantId
      || text(item.sku, 80).toUpperCase() !== product.sku
      || quantity !== 1
      || !isValidShopifyLinePrice(item.price)) {
    throw new QueueOperationError('SHOPIFY_INTENT_PACKAGE_MISMATCH');
  }

  const category = text(row.category, 20) as YesNoCategory;
  if (!readingIntentPropertiesMatch({
    knownIntentKind,
    actual: {
      funnelVersion: itemProperty(item, ['funnel version']),
      readingId: itemProperty(item, ['reading id']),
      readingType: itemProperty(item, ['reading type']),
      category: itemProperty(item, ['reading category']),
      answer: itemProperty(item, ['answer']),
      cardName: itemProperty(item, ['card name']),
      question: itemProperty(item, ['question', 'your question']),
      tier: itemProperty(item, ['selected package']),
    },
    expected: {
      funnelVersion: text(row.funnel_version, 128),
      readingId: text(row.reading_id, 80),
      readingType: text(row.reading_type, 80),
      category,
      answer: text(row.answer, 20),
      cardName: text(row.card_name, 80),
      question: text(row.question, 400),
      tier: product.tier,
    },
  })) {
    throw new QueueOperationError('CHECKOUT_INTENT_READING_MISMATCH');
  }

  let loveVerifiedFields: JsonObject = {};
  if (intentKind === 'love_tarot') {
    const loveIntent = text(snapshot.intent, 40).toLowerCase();
    const relationshipStatus = text(snapshot.relationshipStatus, 32).toLowerCase();
    const direction = text(snapshot.direction, 80);
    const cards = Array.isArray(snapshot.cards)
      ? snapshot.cards.slice(0, 3).map((value) => {
        const card = value && typeof value === 'object' ? value as JsonObject : {};
        return {
          id: Number(card.id),
          name: text(card.name, 80),
          position: text(card.position, 80),
          angle: text(card.angle, 500),
        };
      })
      : [];
    if (text(row.page, 160) !== LOVE_TAROT_PAGE
      || text(row.funnel_version, 128) !== LOVE_TAROT_FUNNEL_VERSION
      || !isLoveTarotIntent(loveIntent)
      || !isLoveRelationshipStatus(relationshipStatus)
      || cards.length !== 3
      || cards.some((card, index) => card.name !== loveTarotCardTitle(card.id)
        || card.position !== LOVE_TAROT_INTENTS[loveIntent].positions[index]
        || !card.angle)
      || itemProperty(item, ['love intent']) !== loveIntent
      || itemProperty(item, ['relationship status']) !== relationshipStatus) {
      throw new QueueOperationError('CHECKOUT_INTENT_LOVE_READING_MISMATCH');
    }
    const cardEvidence = cards
      .map((card) => `${card.position}: ${card.name} · Upright`)
      .join('; ');
    const signalEvidence = cards
      .map((card) => `${card.position}: ${card.name} · Upright · ${card.angle}`)
      .concat([
        `Overall lean: ${direction}`,
        `Relationship situation: ${relationshipStatus}`,
        `Reading focus: ${LOVE_TAROT_INTENTS[loveIntent].label}`,
      ])
      .join('; ');
    const unresolved = Array.isArray(snapshot.unresolved)
      ? snapshot.unresolved.map((value) => text(value, 320)).filter(Boolean)
      : [];
    loveVerifiedFields = {
      type: 'Love Tarot',
      readingType: 'Love Tarot',
      tool: `${LOVE_TAROT_PAGE} · Intent-specific 3-card spread`,
      question: text(row.question, 400),
      freeQuestion: text(row.question, 400),
      context: `${text(snapshot.synthesis, 1_400)} Next grounded step: ${text(snapshot.groundedStep, 700)}`,
      freeContext: text(snapshot.synthesis, 1_400),
      cards: cardEvidence,
      spread: LOVE_TAROT_INTENTS[loveIntent].positions.join(' · '),
      signals: signalEvidence,
      scope: `Three-card intent-specific love tarot spread for ${LOVE_TAROT_INTENTS[loveIntent].label}.`,
      confidence: 'Symbolic three-card pattern for reflective guidance, not proof of another person’s private thoughts.',
      focus: LOVE_TAROT_INTENTS[loveIntent].label,
      readingId: text(row.reading_id, 80),
      snapshotVersion: READING_SNAPSHOT_VERSION,
      snapshotFingerprint: '',
      freeToken: '',
      curiosityQuestion: unresolved[0] || 'What concrete action would bring the clearest next step?',
      loveIntent,
      relationshipStatus,
      directionalLean: direction,
    };
  }

  let dailyVerifiedFields: JsonObject = {};
  if (intentKind === 'daily_tarot') {
    const focus = text(snapshot.focus, 40).toLowerCase();
    const dateKey = text(snapshot.dateKey, 16);
    const situation = text(snapshot.situation, 400);
    const scope = DAILY_TAROT_PACKAGE_SCOPE[product.tier];
    const sharedCard = dailyCardForDateKey(dateKey);
    const cards = Array.isArray(snapshot.cards)
      ? snapshot.cards.slice(0, scope.positions.length).map((value) => {
        const card = value && typeof value === 'object' ? value as JsonObject : {};
        return {
          id: Number(card.id),
          name: text(card.name, 80),
          orientation: text(card.orientation, 16),
          position: text(card.position, 100),
        };
      })
      : [];
    const cardIds = cards.map((card) => card.id);
    if (text(row.page, 160) !== DAILY_TAROT_PAGE
      || text(row.funnel_version, 128) !== DAILY_TAROT_FUNNEL_VERSION
      || !isDailyTarotFocus(focus)
      || situation !== text(row.question, 400)
      || text(snapshot.focusLabel, 80) !== DAILY_TAROT_FOCUSES[focus].label
      || text(snapshot.packageTitle, 100) !== scope.title
      || Number(snapshot.days) !== scope.days
      || !sharedCard
      || cards.length !== scope.positions.length
      || new Set(cardIds).size !== cards.length
      || cards.some((card, index) => card.id < 1
        || card.id > DAILY_TAROT_CARD_NAMES.length
        || card.name !== DAILY_TAROT_CARD_NAMES[card.id - 1]
        || !['Upright', 'Reversed'].includes(card.orientation)
        || card.position !== scope.positions[index])
      || cards[0].id !== sharedCard.id
      || cards[0].name !== sharedCard.name
      || cards[0].orientation !== sharedCard.orientation
      || itemProperty(item, ['daily focus']) !== focus
      || itemProperty(item, ['daily date']) !== dateKey
      || itemProperty(item, ['daily orientation']) !== sharedCard.orientation) {
      throw new QueueOperationError('CHECKOUT_INTENT_DAILY_READING_MISMATCH');
    }
    const cardEvidence = cards
      .map((card) => `${card.position}: ${card.name} · ${card.orientation}`)
      .join('; ');
    dailyVerifiedFields = {
      type: 'Daily Tarot',
      readingType: 'Daily Tarot',
      tool: `${DAILY_TAROT_PAGE} · ${scope.title}`,
      question: situation,
      freeQuestion: situation,
      context: `The visitor selected ${DAILY_TAROT_FOCUSES[focus].label} and supplied this exact situation: “${situation}”`,
      freeContext: situation,
      cards: cardEvidence,
      spread: scope.positions.join(' · '),
      signals: cardEvidence,
      scope: `${scope.title}: ${cards.length} verified cards covering ${scope.days} day${scope.days === 1 ? '' : 's'}.`,
      confidence: 'A symbolic, reflective tarot reading grounded in the visitor-supplied situation; conditional, not predictive.',
      focus: DAILY_TAROT_FOCUSES[focus].label,
      readingId: text(row.reading_id, 80),
      snapshotVersion: READING_SNAPSHOT_VERSION,
      snapshotFingerprint: '',
      freeToken: '',
      dailyTarotSnapshotVersion: 'daily-tarot-snapshot-v1',
      curiosityQuestion: scope.positions[scope.positions.length - 1],
      dailyFocus: focus,
      dailyDate: dateKey,
      packageTitle: scope.title,
      deliveryWindowMinutes: 90,
      cardCount: cards.length,
      coverageDays: scope.days,
      cardsDetailed: cards,
    };
  }

  let birthChartVerifiedFields: JsonObject = {};
  let dailyHoroscopeVerifiedFields: JsonObject = {};
  if (intentKind === 'daily_horoscope') {
    const horoscopeSnapshot = safeDailyHoroscopeSnapshot(snapshot);
    if (!horoscopeSnapshot
      || text(row.page, 160) !== DAILY_HOROSCOPE_PAGE
      || text(row.funnel_version, 128) !== DAILY_HOROSCOPE_FUNNEL_VERSION
      || text(row.category, 20) !== DAILY_HOROSCOPE_FOCUSES[horoscopeSnapshot.focus].category
      || text(row.deck, 32) !== 'natal_transits'
      || text(row.card_name, 80) !== `${horoscopeSnapshot.sign} natal transits`
      || Number(row.card_id) !== 0
      || itemProperty(item, ['horoscope focus']) !== horoscopeSnapshot.focus
      || itemProperty(item, ['forecast date']) !== horoscopeSnapshot.forecastDate
      || itemProperty(item, ['sun sign']) !== horoscopeSnapshot.sign
      || itemProperty(item, ['birth time status']) !== horoscopeSnapshot.birth.status) {
      throw new QueueOperationError('CHECKOUT_INTENT_DAILY_HOROSCOPE_READING_MISMATCH');
    }
    const scope = DAILY_HOROSCOPE_PACKAGE_SCOPE[product.tier];
    if (scope.title !== horoscopeSnapshot.packageTitle
      || scope.days !== horoscopeSnapshot.coverageDays
      || scope.transitCount !== horoscopeSnapshot.transits.length) {
      throw new QueueOperationError('CHECKOUT_INTENT_DAILY_HOROSCOPE_SCOPE_MISMATCH');
    }
    const evidence = dailyHoroscopeEvidence(horoscopeSnapshot);
    const transitSignals = horoscopeSnapshot.transits.map((transit) => (
      `${transit.movingPlanet} ${transit.aspect} natal ${transit.natalPlanet} · ${transit.orb.toFixed(2)}° orb · ${transit.tone} · peak ${transit.peakAt}`
    )).join('; ');
    dailyHoroscopeVerifiedFields = {
      type: 'Personal Horoscope',
      readingType: 'Personal Horoscope',
      tool: `${DAILY_HOROSCOPE_PAGE} · Western Tropical natal transits`,
      question: text(row.question, 400),
      freeQuestion: text(row.question, 400),
      context: `${evidence}. Paid package contract: ${scope.title}. ${scope.instruction}`,
      freeContext: `${horoscopeSnapshot.sign} daily horoscope · ${horoscopeSnapshot.focusLabel}`,
      cards: '',
      spread: `${scope.title} · ${scope.transitCount} verified natal transits · ${scope.days}-day timing window`,
      signals: transitSignals,
      scope: `${scope.title}. Use only the supplied verified transit snapshot. ${scope.instruction}`,
      confidence: horoscopeSnapshot.calculation.confidence,
      focus: horoscopeSnapshot.focusLabel,
      readingId: text(row.reading_id, 80),
      snapshotVersion: READING_SNAPSHOT_VERSION,
      snapshotFingerprint: '',
      freeToken: '',
      dailyHoroscopeSnapshotVersion: DAILY_HOROSCOPE_SNAPSHOT_VERSION,
      curiosityQuestion: `What is the clearest action for ${horoscopeSnapshot.focusLabel.toLowerCase()} in this timing window?`,
      horoscopeFocus: horoscopeSnapshot.focus,
      forecastDate: horoscopeSnapshot.forecastDate,
      birthTimeStatus: horoscopeSnapshot.birth.status,
      packageTitle: scope.title,
      deliveryWindowMinutes: 90,
      transitCount: scope.transitCount,
      coverageDays: scope.days,
      dailyHoroscope: horoscopeSnapshot,
    };
  }

  if (intentKind === 'birth_chart') {
    const birthSnapshot = safeSignedPersistedBirthChartSnapshot(snapshot, {
      integrityVerified: persistedSnapshotHashVerified && persistedIntentSignatureVerified,
    });
    const focus = text(snapshot.focus, 40).toLowerCase();
    if (!birthSnapshot
      || text(row.page, 160) !== BIRTH_CHART_PAGE
      || text(row.funnel_version, 128) !== BIRTH_CHART_FUNNEL_VERSION
      || !isBirthChartIntent(focus)
      || birthSnapshot.focus !== focus
      || text(row.category, 20) !== BIRTH_CHART_INTENTS[focus].category
      || text(row.deck, 32) !== 'natal_chart'
      || text(row.card_name, 80) !== 'Natal chart'
      || Number(row.card_id) !== 0
      || itemProperty(item, ['birth focus']) !== focus
      || itemProperty(item, ['birth time status']) !== birthSnapshot.birth.status) {
      throw new QueueOperationError('CHECKOUT_INTENT_BIRTH_CHART_READING_MISMATCH');
    }
    const scope = BIRTH_CHART_PACKAGE_SCOPE[product.tier];
    const chartEvidence = birthChartEvidence(birthSnapshot);
    birthChartVerifiedFields = {
      type: 'Astrology Birth Chart',
      readingType: 'Astrology Birth Chart',
      tool: `${BIRTH_CHART_PAGE} · Western Tropical · Whole Sign houses`,
      question: text(row.question, 400),
      freeQuestion: text(row.question, 400),
      context: `${chartEvidence} Paid package contract: ${scope.title}. ${scope.instruction}`,
      freeContext: chartEvidence,
      cards: '',
      spread: 'Verified natal placements · reliable major aspects · selected life-area focus',
      signals: birthChartQueueSignals(birthSnapshot),
      scope: `${scope.title}. Use only the verified supplied chart. ${scope.instruction}`,
      confidence: birthSnapshot.birth.status === 'exact'
        ? 'Exact birth time and historical timezone supplied. Use the verified angles and Whole Sign houses.'
        : birthSnapshot.birth.status === 'approximate'
          ? 'Approximate birth time. Clearly mark angles and houses as time-sensitive and never present them as certain.'
          : 'Birth time unknown. Do not infer an Ascendant, Midheaven or houses; preserve every time-sensitive range exactly as supplied.',
      focus: birthSnapshot.focusLabel,
      readingId: text(row.reading_id, 80),
      snapshotVersion: READING_SNAPSHOT_VERSION,
      snapshotFingerprint: '',
      freeToken: '',
      birthChartSnapshotVersion: BIRTH_CHART_SNAPSHOT_VERSION,
      curiosityQuestion: text(row.question, 400),
      birthChartFocus: focus,
      birthTimeStatus: birthSnapshot.birth.status,
      packageTitle: scope.title,
      deliveryWindowMinutes: 90,
      birthChart: birthSnapshot,
    };
  }

  let bigThreeVerifiedFields: JsonObject = {};
  if (intentKind === 'big_three') {
    const bigThreeSnapshot = safeBigThreeSnapshot(snapshot);
    const focus = text(snapshot.focus, 40).toLowerCase();
    if (!bigThreeSnapshot
      || text(row.page, 160) !== BIG_THREE_PAGE
      || text(row.funnel_version, 128) !== BIG_THREE_FUNNEL_VERSION
      || !isBigThreeFocus(focus)
      || bigThreeSnapshot.focus !== focus
      || text(row.category, 20) !== BIG_THREE_FOCUSES[focus].category
      || text(row.deck, 32) !== 'big_three'
      || text(row.card_name, 80) !== 'Big Three'
      || Number(row.card_id) !== 0
      || itemProperty(item, ['big three focus']) !== focus
      || itemProperty(item, ['birth time status']) !== bigThreeSnapshot.birth.status) {
      throw new QueueOperationError('CHECKOUT_INTENT_BIG_THREE_READING_MISMATCH');
    }
    const scope = BIG_THREE_PACKAGE_SCOPE[product.tier];
    const evidence = bigThreeEvidence(bigThreeSnapshot);
    const sun = bigThreeSnapshot.placements.sun;
    const moon = bigThreeSnapshot.placements.moon;
    const rising = bigThreeSnapshot.placements.rising;
    const signalEvidence = [
      `Sun: ${sun.degree.toFixed(2)}° ${sun.sign}`,
      `Moon: ${moon.ambiguous ? moon.possibleSigns.join(' or ') : `${moon.degree.toFixed(2)}° ${moon.sign}`}`,
      `Rising: ${rising ? `${rising.degree.toFixed(2)}° ${rising.sign}` : 'not calculated — birth time unknown'}`,
      `Dominant element: ${bigThreeSnapshot.balance.dominantElement}`,
      `Dominant modality: ${bigThreeSnapshot.balance.dominantModality}`,
    ].join('; ');
    bigThreeVerifiedFields = {
      type: 'Sun Moon Rising (Big 3)',
      readingType: 'Sun Moon Rising (Big 3)',
      tool: `${BIG_THREE_PAGE} · deterministic Sun, Moon and Ascendant calculation`,
      question: text(row.question, 400),
      freeQuestion: text(row.question, 400),
      context: `${evidence} Paid package contract: ${scope.title}. ${scope.instruction}`,
      freeContext: evidence,
      cards: '',
      spread: 'Sun ↔ Moon · Sun ↔ Rising · Moon ↔ Rising · three-way synthesis',
      signals: signalEvidence,
      scope: `${scope.title}. Use only the verified Big Three snapshot. ${scope.instruction}`,
      confidence: bigThreeSnapshot.birth.status === 'exact'
        ? 'Exact birth time, birthplace and historical timezone verified. Use the supplied Sun, Moon and Rising degrees.'
        : bigThreeSnapshot.birth.status === 'approximate'
          ? 'Approximate birth time. The Rising degree is time-sensitive; preserve that caveat while using the verified snapshot.'
          : 'Birth time unknown. Rising was not calculated. Preserve any two-sign Moon range and never infer an Ascendant.',
      focus: bigThreeSnapshot.focusLabel,
      readingId: text(row.reading_id, 80),
      snapshotVersion: READING_SNAPSHOT_VERSION,
      snapshotFingerprint: '',
      freeToken: '',
      bigThreeSnapshotVersion: BIG_THREE_SNAPSHOT_VERSION,
      curiosityQuestion: text(row.question, 400),
      bigThreeFocus: focus,
      birthTimeStatus: bigThreeSnapshot.birth.status,
      packageTitle: scope.title,
      deliveryWindowMinutes: 90,
      bigThree: bigThreeSnapshot,
    };
  }

  let angelNumberVerifiedFields: JsonObject = {};
  if (intentKind === 'angel_number') {
    const angelSnapshot = safeAngelNumberSnapshot(snapshot);
    const personal777 = Boolean(angelSnapshot && isPersonal777Snapshot(angelSnapshot));
    const expectedFunnel = personal777 ? PERSONAL_777_FUNNEL_VERSION : ANGEL_NUMBER_FUNNEL_VERSION;
    if (!angelSnapshot
      || text(row.page, 160) !== ANGEL_NUMBER_PAGE
      || text(row.funnel_version, 128) !== expectedFunnel
      || text(row.category, 20) !== ANGEL_NUMBER_LIFE_AREAS[angelSnapshot.lifeArea].category
      || text(row.deck, 32) !== 'angel_number'
      || text(row.card_name, 80) !== `Angel number ${angelSnapshot.number}`
      || Number(row.card_id) !== 0
      || itemProperty(item, ['angel number']) !== angelSnapshot.number
      || itemProperty(item, ['life area']) !== angelSnapshot.lifeArea
      || itemProperty(item, ['angel situation']) !== (angelSnapshot.situation || '')) {
      throw new QueueOperationError('CHECKOUT_INTENT_ANGEL_NUMBER_READING_MISMATCH');
    }
    if (personal777
      && (product.tier === 'standard'
        || text(row.reading_type, 80) !== 'Personal 777'
        || itemProperty(item, ['reading mode']) !== 'personal_777'
        || itemProperty(item, ['article source']) !== angelSnapshot.sourcePage
        || itemProperty(item, ['article topic']) !== angelSnapshot.articleTopic)) {
      throw new QueueOperationError('CHECKOUT_INTENT_PERSONAL_777_READING_MISMATCH');
    }
    if (product.tier === 'premium' && !personal777 && !angelSnapshot.additionalNumbers.length && !angelSnapshot.birthDate) {
      throw new QueueOperationError('CHECKOUT_INTENT_ANGEL_NUMBER_PATTERN_REQUIRED');
    }
    if (personal777 && product.tier === 'premium') {
      const expectedCards = personal777SupportiveCards({
        intentId,
        readingId: text(row.reading_id, 80),
        question: text(row.question, 400),
        secret,
      });
      if (!expectedCards || JSON.stringify(expectedCards) !== JSON.stringify(angelSnapshot.supportiveCards)) {
        throw new QueueOperationError('CHECKOUT_INTENT_PERSONAL_777_CARDS_INVALID');
      }
    }
    if (personal777 && product.tier === 'medium' && angelSnapshot.supportiveCards.length) {
      throw new QueueOperationError('CHECKOUT_INTENT_PERSONAL_777_CARDS_INVALID');
    }
    const scope = personal777
      ? PERSONAL_777_PACKAGE_SCOPE[product.tier as 'medium' | 'premium']
      : ANGEL_NUMBER_PACKAGE_SCOPE[product.tier];
    const evidence = angelNumberEvidence(angelSnapshot);
    const patternInputs = [angelSnapshot.number, ...angelSnapshot.additionalNumbers];
    const supportiveCards = personal777 && product.tier === 'premium'
      ? angelSnapshot.supportiveCards.map((card) => `${card.position}: ${card.name} (${card.orientation})`).join('; ')
      : '';
    angelNumberVerifiedFields = {
      type: personal777 ? 'Personal 777' : 'Angel Number',
      readingType: personal777 ? 'Personal 777' : 'Angel Number',
      tool: personal777 ? `${angelSnapshot.sourcePage} · paid-only personal 777 answer` : `${ANGEL_NUMBER_PAGE} · situational angel-number decoder`,
      question: text(row.question, 400),
      freeQuestion: text(row.question, 400),
      context: personal777
        ? `${evidence}. Pre-payment context contains no personal result. Verified paid package contract: ${scope.title}. ${scope.instruction}`
        : `${evidence}. Free contextual preview: ${angelSnapshot.preview}. Paid package contract: ${scope.title}. ${scope.instruction}`,
      freeContext: personal777 ? '' : angelSnapshot.preview,
      cards: supportiveCards,
      spread: supportiveCards
        ? 'Three-card supportive spread · What 777 is highlighting now · The hidden pattern or block · The most supportive next direction'
        : patternInputs.length > 1
          ? `Main number ${angelSnapshot.number} ↔ supplied pattern ${angelSnapshot.additionalNumbers.join(' · ')}`
          : `Main number ${angelSnapshot.number} · ${angelSnapshot.lifeAreaLabel}`,
      signals: [
        `Core symbolism: ${angelSnapshot.coreTitle}`,
        `Support: ${angelSnapshot.support}`,
        `Caution: ${angelSnapshot.caution}`,
        `Grounded next step: ${angelSnapshot.nextStep}`,
      ].join('; '),
      scope: personal777
        ? `${scope.title}. Use only 777, the exact customer question, the selected topic${supportiveCards ? ' and the three server-verified supportive cards' : ''}. ${scope.instruction}`
        : `${scope.title}. Use only the exact supplied numbers, context and optional birth date. ${scope.instruction}`,
      confidence: 'Angel-number symbolism is a reflective framework, not proof of a supernatural message, a prediction, or access to another person’s private thoughts.',
      focus: angelSnapshot.lifeAreaLabel,
      readingId: text(row.reading_id, 80),
      snapshotVersion: READING_SNAPSHOT_VERSION,
      snapshotFingerprint: '',
      freeToken: '',
      angelNumberSnapshotVersion: ANGEL_NUMBER_SNAPSHOT_VERSION,
      curiosityQuestion: text(row.question, 400),
      angelNumber: angelSnapshot.number,
      angelNumberCore: angelSnapshot.coreNumber,
      angelNumberLifeArea: angelSnapshot.lifeArea,
      angelNumberSituation: angelSnapshot.situation || '',
      packageTitle: scope.title,
      deliveryWindowMinutes: 90,
      readingMode: angelSnapshot.readingMode || '',
      articleSource: angelSnapshot.sourcePage || '',
      articleTopic: angelSnapshot.articleTopic || '',
      followupCredits: personal777 && product.tier === 'premium' ? 1 : 0,
      supportiveCardCount: angelSnapshot.supportiveCards.length,
      angelNumberSnapshot: angelSnapshot,
    };
  }

  let numerologyCompatibilityVerifiedFields: JsonObject = {};
  if (intentKind === 'numerology_compatibility') {
    const numerologySnapshot = safeNumerologyCompatibilitySnapshot(snapshot, product.tier);
    const expectedDimensions = numerologySnapshot ? JSON.stringify(numerologySnapshot.dimensions) : '';
    if (!numerologySnapshot
      || text(row.page, 160) !== NUMEROLOGY_COMPATIBILITY_PAGE
      || text(row.funnel_version, 128) !== NUMEROLOGY_COMPATIBILITY_FUNNEL_VERSION
      || text(row.category, 20) !== 'general'
      || text(row.deck, 32) !== 'numerology'
      || text(row.card_name, 80) !== 'Numerology compatibility'
      || Number(row.card_id) !== 0
      || text(row.question, 400) !== numerologySnapshot.question
      || itemProperty(item, ['connection type']) !== numerologySnapshot.connectionType
      || itemProperty(item, ['compatibility focus']) !== numerologySnapshot.compatibilityFocus
      || itemProperty(item, ['premium focus']) !== numerologySnapshot.premiumFocus
      || itemProperty(item, ['person a birth date']) !== numerologySnapshot.personA.birthDate
      || itemProperty(item, ['person b birth date']) !== numerologySnapshot.personB.birthDate
      || Number(itemProperty(item, ['person a life path'])) !== numerologySnapshot.personA.lifePath
      || Number(itemProperty(item, ['person b life path'])) !== numerologySnapshot.personB.lifePath
      || Number(itemProperty(item, ['pattern score'])) !== numerologySnapshot.score
      || itemProperty(item, ['dimension scores']) !== expectedDimensions
      || itemProperty(item, ['person a name']) !== numerologySnapshot.personA.fullBirthName
      || itemProperty(item, ['person b name']) !== numerologySnapshot.personB.fullBirthName) {
      throw new QueueOperationError('CHECKOUT_INTENT_NUMEROLOGY_COMPATIBILITY_READING_MISMATCH');
    }
    const scope = NUMEROLOGY_COMPATIBILITY_PACKAGE_SCOPE[product.tier];
    const evidence = numerologyCompatibilityEvidence(numerologySnapshot);
    numerologyCompatibilityVerifiedFields = {
      type: 'Numerology Compatibility',
      readingType: 'Numerology Compatibility',
      tool: `${NUMEROLOGY_COMPATIBILITY_PAGE} · deterministic two-person numerology calculator`,
      question: numerologySnapshot.question,
      freeQuestion: numerologySnapshot.question,
      context: `${evidence} Paid package contract: ${scope.title}. ${scope.instruction}`,
      freeContext: `Life Path ${numerologySnapshot.personA.lifePath} + ${numerologySnapshot.personB.lifePath} · ${numerologySnapshot.score}/100`,
      dob: `Person A ${numerologySnapshot.personA.birthDate}; Person B ${numerologySnapshot.personB.birthDate}`,
      name: numerologySnapshot.personA.fullBirthName || numerologySnapshot.personA.firstName,
      cards: '',
      spread: 'Verified Life Path pair · five pattern dimensions · relationship context · exact customer question',
      signals: [
        `Pair score: ${numerologySnapshot.score}/100`,
        `Attraction: ${numerologySnapshot.dimensions.attraction}`,
        `Communication: ${numerologySnapshot.dimensions.communication}`,
        `Emotional rhythm: ${numerologySnapshot.dimensions.emotionalRhythm}`,
        `Commitment pace: ${numerologySnapshot.dimensions.commitmentPace}`,
        `Growth potential: ${numerologySnapshot.dimensions.growthPotential}`,
      ].join('; '),
      scope: `${scope.title}. Use only the server-recalculated dates, Life Paths, optional name numbers and exact question. ${scope.instruction}`,
      confidence: 'Dates, Life Paths, pair score, dimensions and any Pythagorean name numbers were recalculated server-side. Numerology is a reflective framework, not scientific prediction.',
      focus: `${numerologySnapshot.compatibilityFocusLabel}; ${numerologySnapshot.premiumFocusLabel}`,
      readingId: text(row.reading_id, 80),
      snapshotVersion: READING_SNAPSHOT_VERSION,
      snapshotFingerprint: '',
      freeToken: '',
      numerologyCompatibilitySnapshotVersion: NUMEROLOGY_COMPATIBILITY_SNAPSHOT_VERSION,
      curiosityQuestion: numerologySnapshot.question,
      connectionType: numerologySnapshot.connectionType,
      compatibilityFocus: numerologySnapshot.compatibilityFocus,
      premiumFocus: numerologySnapshot.premiumFocus,
      packageTitle: scope.title,
      deliveryWindowMinutes: 90,
      numerologyCompatibility: numerologySnapshot,
    };
  }

  let zodiacCompatibilityVerifiedFields: JsonObject = {};
  if (intentKind === 'zodiac_compatibility') {
    const compatibilitySnapshot = safeZodiacCompatibilitySnapshot(snapshot);
    if (!compatibilitySnapshot
      || text(row.page, 160) !== ZODIAC_COMPATIBILITY_PAGE
      || text(row.funnel_version, 128) !== ZODIAC_COMPATIBILITY_FUNNEL_VERSION
      || text(row.category, 20) !== 'love'
      || text(row.deck, 32) !== 'natal_chart'
      || text(row.card_name, 80) !== 'Sun-sign compatibility'
      || Number(row.card_id) !== 0
      || text(row.question, 400) !== compatibilitySnapshot.question
      || itemProperty(item, ['relationship stage']) !== compatibilitySnapshot.relationshipStage
      || itemProperty(item, ['relationship focus']) !== compatibilitySnapshot.focus
      || itemProperty(item, ['pair']) !== `${compatibilitySnapshot.personA.sign} + ${compatibilitySnapshot.personB.sign}`) {
      throw new QueueOperationError('CHECKOUT_INTENT_ZODIAC_COMPATIBILITY_READING_MISMATCH');
    }
    const scope = ZODIAC_COMPATIBILITY_PACKAGE_SCOPE[product.tier];
    const evidence = zodiacCompatibilityEvidence(compatibilitySnapshot);
    zodiacCompatibilityVerifiedFields = {
      type: 'Zodiac Compatibility',
      readingType: 'Zodiac Compatibility',
      tool: `${ZODIAC_COMPATIBILITY_PAGE} · deterministic Sun-sign compatibility calculator`,
      question: compatibilitySnapshot.question,
      freeQuestion: compatibilitySnapshot.question,
      context: `${evidence}. Paid package contract: ${scope.title}. ${scope.instruction}`,
      freeContext: `${compatibilitySnapshot.personA.sign} + ${compatibilitySnapshot.personB.sign} · ${compatibilitySnapshot.scores.overall}% overall`,
      cards: '',
      spread: 'Verified Sun-sign pair · four score dimensions · relationship stage · exact customer question',
      signals: [
        `Overall match: ${compatibilitySnapshot.scores.overall}%`,
        `Love and attraction: ${compatibilitySnapshot.scores.love}%`,
        `Communication: ${compatibilitySnapshot.scores.communication}%`,
        `Trust: ${compatibilitySnapshot.scores.trust}%`,
        `Emotional bond: ${compatibilitySnapshot.scores.emotion}%`,
        `Strongest dimension: ${compatibilitySnapshot.strongest}`,
        `Dimension needing most care: ${compatibilitySnapshot.needsCare}`,
      ].join('; '),
      scope: `${scope.title}. This is a Sun-sign relationship-pattern reading, not full synastry. Use only the verified scores, selected relationship stage, focus and exact question. ${scope.instruction}`,
      confidence: 'Sun-sign pair only. No Moon, Mercury, Venus, Mars, house or aspect placements were supplied; do not infer them or claim access to another person\'s private feelings.',
      focus: compatibilitySnapshot.focusLabel,
      readingId: text(row.reading_id, 80),
      snapshotVersion: READING_SNAPSHOT_VERSION,
      snapshotFingerprint: '',
      freeToken: '',
      zodiacCompatibilitySnapshotVersion: ZODIAC_COMPATIBILITY_SNAPSHOT_VERSION,
      curiosityQuestion: compatibilitySnapshot.question,
      relationshipStage: compatibilitySnapshot.relationshipStage,
      relationshipStageLabel: compatibilitySnapshot.relationshipStageLabel,
      relationshipFocus: compatibilitySnapshot.focus,
      pair: `${compatibilitySnapshot.personA.sign} + ${compatibilitySnapshot.personB.sign}`,
      packageTitle: scope.title,
      deliveryWindowMinutes: 90,
      zodiacCompatibility: compatibilitySnapshot,
    };
  }

  let moonLunarVerifiedFields: JsonObject = {};
  if (intentKind === 'moon_lunar') {
    const lunarSnapshot = safeMoonLunarSnapshot(snapshot);
    const expectedNatalMoon = lunarSnapshot?.natalMoon.ambiguous
      ? lunarSnapshot.natalMoon.possibleSigns.join(' or ')
      : lunarSnapshot?.natalMoon.sign || '';
    if (!lunarSnapshot
      || text(row.page, 160) !== MOON_LUNAR_PAGE
      || text(row.funnel_version, 128) !== MOON_LUNAR_FUNNEL_VERSION
      || text(row.category, 20) !== lunarSnapshot.category
      || text(row.deck, 32) !== 'lunar_transits'
      || text(row.card_name, 80) !== lunarSnapshot.card.name
      || Number(row.card_id) !== lunarSnapshot.card.id
      || text(row.question, 400) !== lunarSnapshot.situation
      || itemProperty(item, ['lunar focus']) !== lunarSnapshot.focus
      || itemProperty(item, ['moon date']) !== lunarSnapshot.current.dateKey
      || itemProperty(item, ['moon phase']) !== lunarSnapshot.current.phase
      || itemProperty(item, ['moon sign']) !== lunarSnapshot.current.moonSign
      || itemProperty(item, ['next lunar phase']) !== lunarSnapshot.current.nextPhase.name
      || itemProperty(item, ['birth date']) !== lunarSnapshot.birth.date
      || itemProperty(item, ['birth time status']) !== lunarSnapshot.birth.status
      || itemProperty(item, ['natal moon']) !== expectedNatalMoon) {
      throw new QueueOperationError('CHECKOUT_INTENT_MOON_LUNAR_READING_MISMATCH');
    }
    const scope = MOON_LUNAR_PACKAGE_SCOPE[product.tier];
    if (lunarSnapshot.packageTier !== product.tier
      || lunarSnapshot.packageTitle !== scope.title
      || lunarSnapshot.coverageDays !== scope.days) {
      throw new QueueOperationError('CHECKOUT_INTENT_MOON_LUNAR_SCOPE_MISMATCH');
    }
    const evidence = moonLunarEvidence(lunarSnapshot);
    moonLunarVerifiedFields = {
      type: 'Moon & Lunar Reading',
      readingType: 'Moon & Lunar Reading',
      tool: `${MOON_LUNAR_PAGE} Â· verified current Moon and natal Moon calculation`,
      question: lunarSnapshot.situation,
      freeQuestion: lunarSnapshot.situation,
      context: `${evidence}. Paid package contract: ${scope.title}. ${scope.instruction}`,
      freeContext: `${lunarSnapshot.current.phase} in ${lunarSnapshot.current.moonSign} Â· ${lunarSnapshot.card.name} for ${lunarSnapshot.focusLabel}`,
      cards: `${lunarSnapshot.card.position}: ${lunarSnapshot.card.name} Â· ${lunarSnapshot.card.orientation}`,
      spread: `${scope.title} Â· current Moon â†” natal Moon â†” lunar card â†” exact question`,
      signals: evidence,
      scope: `${scope.title}. Use only the verified lunar and birth snapshot. ${scope.instruction}`,
      confidence: `${lunarSnapshot.natalMoon.confidence} Spiritual language is a reflective framework, not a guaranteed prediction.`,
      focus: lunarSnapshot.focusLabel,
      readingId: text(row.reading_id, 80),
      snapshotVersion: READING_SNAPSHOT_VERSION,
      snapshotFingerprint: '',
      freeToken: '',
      moonLunarSnapshotVersion: MOON_LUNAR_SNAPSHOT_VERSION,
      curiosityQuestion: lunarSnapshot.situation,
      lunarFocus: lunarSnapshot.focus,
      moonPhase: lunarSnapshot.current.phase,
      moonSign: lunarSnapshot.current.moonSign,
      natalMoon: expectedNatalMoon,
      birthTimeStatus: lunarSnapshot.birth.status,
      packageTitle: scope.title,
      deliveryWindowMinutes: 90,
      coverageDays: scope.days,
      moonLunar: lunarSnapshot,
    };
  }

  let sharedToolVerifiedFields: JsonObject = {};
  if (intentKind === 'shared_tool') {
    if (!sharedOrderVerification || !('verifiedFields' in sharedOrderVerification)) {
      throw new QueueOperationError('CHECKOUT_INTENT_SHARED_TOOL_READING_MISMATCH');
    }
    sharedToolVerifiedFields = sharedOrderVerification.verifiedFields as JsonObject;
  }

  const orderId = text(payload.id, 96);
  const consumed = await sql<{ id: string }[]>`
    update deckaura.checkout_intents
       set status = 'paid',
           consumed_at = coalesce(consumed_at, clock_timestamp()),
           order_id = coalesce(order_id, ${orderId})
     where id = ${intentId}::uuid
       and expires_at > clock_timestamp()
       and (status = 'pending' or (status = 'paid' and order_id = ${orderId}))
    returning id::text as id
  `;
  if (!consumed[0]) throw new QueueOperationError('CHECKOUT_INTENT_ALREADY_CONSUMED');
  return {
    intentId,
    tier: product.tier,
    variantId: product.variantId,
    sku: product.sku,
    price: product.price,
    category,
    intentKind: intentKind === 'love_tarot'
      ? 'love_tarot'
      : intentKind === 'daily_tarot'
        ? 'daily_tarot'
        : intentKind === 'daily_horoscope'
          ? 'daily_horoscope'
        : intentKind === 'birth_chart'
          ? 'birth_chart'
          : intentKind === 'big_three'
            ? 'big_three'
            : intentKind === 'angel_number'
              ? 'angel_number'
              : intentKind === 'zodiac_compatibility'
                ? 'zodiac_compatibility'
                : intentKind === 'moon_lunar'
                  ? 'moon_lunar'
                  : intentKind === 'numerology_compatibility'
                    ? 'numerology_compatibility'
                    : intentKind === 'shared_tool' ? 'shared_tool' : 'yes_no',
    verifiedFields: {
      checkoutIntentId: intentId,
      lang: localeContext.language,
      locale: localeContext.locale,
      country: localeContext.country,
      currency: localeContext.currency,
      market: localeContext.market,
      question: text(row.question, 400),
      readingType: text(row.reading_type, 80),
      category,
      deck: text(row.deck, 32),
      answer: text(row.answer, 20),
      cardName: text(row.card_name, 80),
      cardId: Number(row.card_id),
      why: text(snapshot.why, 700),
      control: text(snapshot.control, 700),
      reflection: text(snapshot.reflection, 500),
      ...loveVerifiedFields,
      ...dailyVerifiedFields,
      ...dailyHoroscopeVerifiedFields,
      ...birthChartVerifiedFields,
      ...bigThreeVerifiedFields,
      ...angelNumberVerifiedFields,
      ...numerologyCompatibilityVerifiedFields,
      ...zodiacCompatibilityVerifiedFields,
      ...moonLunarVerifiedFields,
      ...sharedToolVerifiedFields,
    },
  };
}

function checkoutContextCanonical(record: JsonObject) {
  const clarifiers = Array.isArray(record.clarifiers) ? record.clarifiers : [];
  const cards = clarifiers.map((value) => {
    const card = value && typeof value === 'object' ? value as JsonObject : {};
    return `${Number(card.id)}:${card.isReversed === true ? 'r' : 'u'}:${text(card.position, 120)}`;
  }).join('|');
  return [
    text(record.contextId, 64),
    text(record.previewToken, 64),
    text(record.conversationId, 64),
    text(record.readingId, 128),
    text(record.paidQuestion, 400),
    text(record.tier, 20),
    text(record.variantId, 64),
    text(record.sku, 80),
    cards,
  ].join('\u001f');
}

function secureHexEqual(expected: string, supplied: string) {
  if (!/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(supplied, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

async function verifiedTarotCheckoutContext(items: JsonObject[], env: WorkerEnvironment): Promise<VerifiedCheckoutContext | null> {
  const candidates = items.map((item) => ({ item, tier: packageTierForLineItem(item) })).filter((entry) => entry.tier);
  if (!candidates.length) return null;
  if (candidates.length !== 1) throw new QueueOperationError('SHOPIFY_READING_PACKAGE_COUNT_INVALID');
  const { item, tier } = candidates[0] as { item: JsonObject; tier: TarotPackageTier };
  const contextId = itemProperty(item, ['checkout context']);
  const suppliedSignature = itemProperty(item, ['checkout signature']).toLowerCase();
  const funnelVersion = itemProperty(item, ['funnel version']);
  const contextRequired = funnelVersion === 'clarifier-checkout-2026-08-v40' || Boolean(contextId || suppliedSignature);
  if (!contextRequired) return null;
  if (!/^[0-9a-f-]{36}$/i.test(contextId) || !/^[a-f0-9]{64}$/.test(suppliedSignature)) {
    throw new QueueOperationError('CHECKOUT_CONTEXT_REFERENCE_INVALID');
  }
  const record = await env.READINGS_CACHE.get(`checkout-context:${contextId}`, 'json') as JsonObject | null;
  if (!record || text(record.contextVersion, 64) !== 'clarifier-checkout-v1') {
    throw new QueueOperationError('CHECKOUT_CONTEXT_NOT_FOUND');
  }
  if (Number(record.expiresAt || 0) <= Date.now()) throw new QueueOperationError('CHECKOUT_CONTEXT_EXPIRED');
  const secret = text(
    process.env.ENTITLEMENT_PEPPER
      || process.env.FREE_ENTITLEMENT_SALT
      || process.env.SHOPIFY_WEBHOOK_SECRET,
    512,
  );
  if (!secret) throw new QueueOperationError('CHECKOUT_CONTEXT_SECRET_MISSING');
  const expectedSignature = createHmac('sha256', secret).update(checkoutContextCanonical(record), 'utf8').digest('hex');
  if (!secureHexEqual(expectedSignature, suppliedSignature) || !secureHexEqual(text(record.signature, 64), suppliedSignature)) {
    throw new QueueOperationError('CHECKOUT_CONTEXT_SIGNATURE_INVALID');
  }
  const definition = TAROT_PACKAGES[tier];
  if (text(record.contextId, 64) !== contextId
    || text(record.tier, 20) !== tier
    || text(record.variantId, 64) !== definition.variantId
    || text(record.sku, 80).toUpperCase() !== definition.sku) {
    throw new QueueOperationError('CHECKOUT_CONTEXT_PACKAGE_MISMATCH');
  }
  const freeToken = itemProperty(item, ['free_token', 'freetoken']);
  const readingId = itemProperty(item, ['reading id']);
  const conversationId = itemProperty(item, ['conversation id']);
  const paidQuestion = itemProperty(item, ['question', 'your question']);
  if (freeToken !== text(record.previewToken, 64)
    || (readingId && readingId !== text(record.readingId, 128))
    || (conversationId && conversationId !== text(record.conversationId, 64))
    || paidQuestion !== text(record.paidQuestion, 400)) {
    throw new QueueOperationError('CHECKOUT_CONTEXT_READING_MISMATCH');
  }
  const rawClarifiers = Array.isArray(record.clarifiers) ? record.clarifiers : [];
  if (rawClarifiers.length !== definition.clarifierCount) throw new QueueOperationError('CHECKOUT_CONTEXT_CLARIFIER_COUNT_INVALID');
  const clarifiers = rawClarifiers.map((value) => {
    const card = value && typeof value === 'object' ? value as JsonObject : {};
    return {
      id: Number(card.id),
      name: text(card.name, 80),
      isReversed: card.isReversed === true,
      position: text(card.position, 120),
    };
  });
  if (clarifiers.some((card) => !Number.isInteger(card.id) || !card.name || !card.position)) {
    throw new QueueOperationError('CHECKOUT_CONTEXT_CLARIFIER_INVALID');
  }
  const clarifierCards = clarifiers.map((card) => `${card.position}: ${card.name} · ${card.isReversed ? 'Reversed' : 'Upright'}`).join('; ');
  return {
    contextId,
    tier,
    variantId: definition.variantId,
    sku: definition.sku,
    clarifiers,
    verifiedFields: {
      checkoutContextId: contextId,
      tier,
      question: text(record.paidQuestion, 400),
      clarifierCards,
      clarifierSpread: clarifiers.map((card) => card.position).join(' · '),
    },
  };
}

function readingAttribution(item: JsonObject) {
  const conversationId = itemProperty(item, ['conversation id']);
  const readingId = itemProperty(item, ['reading id']);
  const funnelVersion = itemProperty(item, ['funnel version']);
  const snapshotVersion = itemProperty(item, ['snapshot version']);
  const recommendedPackage = itemProperty(item, ['recommended package']);
  const selectedPackage = itemProperty(item, ['selected package']);
  const experimentKey = itemProperty(item, ['experiment key']);
  const experimentVariant = itemProperty(item, ['experiment variant']);
  const sourcePage = itemProperty(item, ['source page']);
  const toolPage = itemProperty(item, ['tool page']);
  const intentKind = itemProperty(item, ['intent kind']);
  const readingMode = itemProperty(item, ['reading mode']) || (intentKind === 'shared_tool' ? 'shared_tool' : '');
  const validExperiment = experimentKey === 'reading_email_capture_v1' && ['after_result', 'after_limit'].includes(experimentVariant)
    || experimentKey === 'free_answer_model_v1' && ['flash_control', 'pro_full'].includes(experimentVariant);
  const answersUsed = Math.max(0, Math.min(10, Number.parseInt(itemProperty(item, ['free answers used']), 10) || 0));
  const claimedPage = sourcePage || toolPage;
  const page = ['/pages/free-tarot-reading', '/pages/7-card-tarot-reading', '/pages/career-tarot-reading', '/pages/numerology-calculator', '/pages/yes-or-no-tarot', LOVE_TAROT_PAGE, DAILY_TAROT_PAGE, DAILY_HOROSCOPE_PAGE, BIRTH_CHART_PAGE, BIG_THREE_PAGE, ANGEL_NUMBER_PAGE, ZODIAC_COMPATIBILITY_PAGE, MOON_LUNAR_PAGE, ...Object.keys(SHARED_TOOL_PAGE_TOOL_TYPES)].includes(claimedPage)
    ? claimedPage
    : /seven|7-card/i.test(`${funnelVersion} ${itemProperty(item, ['tool'])}`)
      ? '/pages/7-card-tarot-reading'
      : '/pages/free-tarot-reading';
  return {
    conversationId: /^[0-9a-f-]{36}$/i.test(conversationId) ? conversationId : '',
    readingId,
    funnelVersion,
    snapshotVersion,
    recommendedPackage: ['standard', 'medium', 'premium'].includes(recommendedPackage) ? recommendedPackage : '',
    selectedPackage: ['standard', 'medium', 'premium'].includes(selectedPackage) ? selectedPackage : '',
    experimentKey: validExperiment ? experimentKey : '',
    experimentVariant: validExperiment ? experimentVariant : '',
    page,
    readingMode,
    answersUsed,
  };
}

function shopifyMarketingConsent(payload: JsonObject) {
  if (payload.buyer_accepts_marketing === true) return true;
  const customer = payload.customer && typeof payload.customer === 'object'
    ? payload.customer as JsonObject
    : {};
  if (customer.accepts_marketing === true) return true;
  const consent = customer.email_marketing_consent && typeof customer.email_marketing_consent === 'object'
    ? customer.email_marketing_consent as JsonObject
    : {};
  return ['subscribed', 'confirmed_opt_in'].includes(text(consent.state || consent.marketing_state, 40).toLowerCase());
}

function deterministicUuid(value: string) {
  const hex = createHash('sha256').update(value, 'utf8').digest('hex');
  const variant = (Number.parseInt(hex[16], 16) & 0x3 | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function lifecycleEmailHash(email: string) {
  const secret = text(
    process.env.ENTITLEMENT_PEPPER
      || process.env.FREE_ENTITLEMENT_SALT
      || process.env.SHOPIFY_WEBHOOK_SECRET,
    512,
  );
  if (!secret) throw new QueueOperationError('LIFECYCLE_HASH_SECRET_MISSING');
  return createHash('sha256').update(`${secret}|lead-email|${email.toLowerCase()}`, 'utf8').digest('hex');
}

function readingRevenue(items: JsonObject[]) {
  return items.reduce((total, item) => {
    const price = Number.parseFloat(String(item.price || 0));
    const quantity = Math.max(1, Number.parseInt(String(item.quantity || 1), 10) || 1);
    return total + (Number.isFinite(price) && price > 0 ? price * quantity : 0);
  }, 0);
}

function paidTier(sku: string): 'standard' | 'medium' | 'premium' {
  if (sku === 'READING-PREMIUM') return 'premium';
  if (sku === 'READING-MEDIUM') return 'medium';
  return 'standard';
}

function paidPackageAuthority(item: JsonObject) {
  const variantId = text(item.variant_id, 64);
  const sku = text(item.sku, 80).toUpperCase();
  const freeTarotAuthority = freeTarotPaidPackageAuthority({ variantId, sku });
  if (freeTarotAuthority?.ok === false) throw new QueueOperationError(freeTarotAuthority.reason);
  if (freeTarotAuthority?.ok === true) return freeTarotAuthority;
  const tier = paidTier(sku);
  const catalog = readingPackageByVariant(variantId);
  const sharedVariant = SHARED_TOOL_VARIANT_IDS.includes(variantId);
  if (!catalog && !sharedVariant && /^READING-(?:DEEP|MEDIUM|PREMIUM)$/.test(sku)) {
    throw new QueueOperationError('SHOPIFY_PACKAGE_VARIANT_INVALID');
  }
  if (catalog && catalog.sku !== sku) throw new QueueOperationError('SHOPIFY_PACKAGE_VARIANT_SKU_MISMATCH');
  if (catalog && catalog.tier !== tier) throw new QueueOperationError('SHOPIFY_PACKAGE_TIER_MISMATCH');
  return {
    variantId,
    sku,
    tier: catalog?.tier || tier,
  };
}

function assertPaidDraftPackageAuthority(draft: PaidDraft, authority: ReturnType<typeof paidPackageAuthority>) {
  if (draft.tier && draft.tier !== authority.tier) throw new QueueOperationError('PAID_DRAFT_TIER_MISMATCH');
  if (draft.shopifyVariantId && draft.shopifyVariantId !== authority.variantId) {
    throw new QueueOperationError('PAID_DRAFT_VARIANT_MISMATCH');
  }
  if (draft.shopifySku && draft.shopifySku.toUpperCase() !== authority.sku) {
    throw new QueueOperationError('PAID_DRAFT_SKU_MISMATCH');
  }
}

function readingCredits(items: JsonObject[]) {
  return items.reduce((total, item) => {
    const sku = text(item.sku, 80).toUpperCase();
    const quantity = Math.max(1, Number.parseInt(String(item.quantity || 1), 10) || 1);
    return total + quantity * (sku === 'READING-3PACK' ? 3 : 1);
  }, 0);
}

function payloadCreatedAt(payload: JsonObject) {
  const parsed = Date.parse(text(payload.created_at, 80));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizedReviewStatus(draft: PaidDraft): 'pending' | 'confirmed' | 'auto_locked' {
  if (draft.status === 'confirmed') return 'confirmed';
  if (draft.status === 'auto_locked') return 'auto_locked';
  if (Number(draft.reviewUntil || 0) <= Date.now()) return 'auto_locked';
  return 'pending';
}

async function replayShopifyWebhook(row: WebhookQueueRow, env: WorkerEnvironment) {
  const topic = text(row.topic, 128).toLowerCase().replace(/_/g, '/');
  if (topic !== 'orders/paid') return { ignored: true };

  // Treat Shopify as the payment authority, but never treat browser-created
  // line-item properties as calculation authority. Compatibility orders are
  // checked against the allow-listed variant/SKU pair and recalculated before
  // the legacy delivery pipeline sees them.
  const replayPayload = shopifyPayloadForLegacyReplay(row.payload || {});
  const paidReadingItems = readingItems(replayPayload);
  validateNumerologyCompatibilityOrder(replayPayload, paidReadingItems);
  validateNumerologyLifePathOrder(replayPayload, paidReadingItems);

  const secret = text(process.env.INTERNAL_ORDER_REPLAY_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET, 512);
  if (!secret) throw new QueueOperationError('ORDER_REPLAY_SECRET_MISSING');
  const raw = JSON.stringify(replayPayload);
  const signature = createHmac('sha256', secret).update(raw, 'utf8').digest('base64');
  const request = new Request('https://reading.deckaura.internal/webhook/orders-paid', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': signature,
      'x-shopify-webhook-id': row.webhook_id,
      'x-shopify-topic': row.topic,
      ...(row.event_id ? { 'x-shopify-event-id': row.event_id } : {}),
    },
    body: raw,
  });
  const response = await readingsWorker.fetch(request, { ...env, SHOPIFY_WEBHOOK_SECRET: secret });
  if (!response.ok) throw new QueueOperationError(`LEGACY_WEBHOOK_HTTP_${response.status}`);
  return { ignored: false };
}

async function paidDraftForOrder(orderId: string, env: WorkerEnvironment) {
  return await env.READINGS_CACHE.get(`paid-draft:${orderId}`, 'json') as PaidDraft | null;
}

async function hasPreviouslyDeliveredOrderAuthority(row: WebhookQueueRow) {
  const payload = row.payload || {};
  const queuedOrderId = text(row.order_id, 96);
  const payloadOrderId = text(payload.id, 96);
  if (!queuedOrderId || !payloadOrderId || queuedOrderId !== payloadOrderId) {
    throw new QueueOperationError('SHOPIFY_ORDER_ID_MISMATCH');
  }
  const items = readingItems(payload);
  if (!items.length) return false;

  const sql = db();
  const rows = await sql<Array<{
    order_id: string;
    financial_status: string | null;
    status: string;
    delivered_at: Date | null;
    fulfillment_id: string | null;
    sku: string | null;
    job_order_id: string | null;
    job_type: string | null;
    job_status: string | null;
    completed_at: Date | null;
    idempotency_key: string | null;
  }>>`
    select paid.order_id, paid.financial_status, paid.status, paid.delivered_at,
           paid.fulfillment_id, paid.sku,
           job.order_id as job_order_id, job.job_type, job.status as job_status,
           job.completed_at, job.idempotency_key
      from deckaura.paid_orders as paid
      left join lateral (
        select candidate.order_id, candidate.job_type, candidate.status,
               candidate.completed_at, candidate.idempotency_key, candidate.created_at
          from deckaura.delivery_jobs as candidate
         where candidate.order_id = paid.order_id
           and candidate.job_type = 'paid_reading'
         order by (candidate.status = 'completed') desc,
                  candidate.completed_at desc nulls last,
                  candidate.created_at desc
         limit 1
      ) as job on true
     where paid.order_id = ${payloadOrderId}
     limit 1
  `;
  const evidence = rows[0];
  return hasAuthoritativeDeliveredOrderEvidence({
    queuedOrderId,
    payloadOrderId,
    readingSkus: items.map((item) => item.sku),
    paidOrder: evidence || null,
    deliveryJob: evidence ? {
      order_id: evidence.job_order_id,
      job_type: evidence.job_type,
      status: evidence.job_status,
      completed_at: evidence.completed_at,
      idempotency_key: evidence.idempotency_key,
    } : null,
  });
}

async function queueDraftForOrder(
  payload: JsonObject,
  items: JsonObject[],
  env: WorkerEnvironment,
  numerology: JsonObject | null = null,
  checkout: VerifiedCheckoutContext | null = null,
  intent: VerifiedReadingIntent | null = null,
) {
  const orderId = text(payload.id, 96);
  const existing = await paidDraftForOrder(orderId, env);
  const verifiedVariantId = intent?.variantId || checkout?.variantId || '';
  const first = verifiedVariantId
    ? items.find((item) => text(item.variant_id, 64) === verifiedVariantId) || items[0] || {}
    : items[0] || {};
  const packageAuthority = paidPackageAuthority(first);
  const createdAt = payloadCreatedAt(payload);
  const checkoutQuestion = itemProperty(first, ['question', 'your question']);
  const mergedVerifiedFields = {
    ...(existing?.verifiedFields || {}),
    ...(checkout?.verifiedFields || {}),
    ...((numerology?.verifiedFields && typeof numerology.verifiedFields === 'object')
      ? numerology.verifiedFields as JsonObject
      : {}),
    // The HMAC-bound server snapshot is the highest-authority source when a
    // numerology order also passes the legacy line-property validator.
    ...(intent?.verifiedFields || {}),
  };
  if (existing && validAccessToken(existing.accessToken)) {
    const verifiedFields = Object.keys(mergedVerifiedFields).length ? mergedVerifiedFields : existing.verifiedFields;
    const questionLimit = paidQuestionLengthLimit(verifiedFields);
    const verifiedQuestion = text(verifiedFields?.question, questionLimit);
    const fallbackQuestion = 'General guidance for the path ahead';
    const existingRealQuestion = text(existing.question || existing.originalQuestion, questionLimit);
    const knownQuestion = verifiedQuestion || checkoutQuestion
      || (existing.status === 'confirmed' || (existingRealQuestion && existingRealQuestion !== fallbackQuestion) ? existingRealQuestion : '');
    // A property-less direct purchase carries no question at all. Locking it
    // at second zero buries the customer's real question behind a generic
    // reading, so the emailed review link keeps a real window instead.
    if (!knownQuestion && existing.status !== 'confirmed') {
      const reviewUntil = Math.max(Number(existing.reviewUntil) || 0, createdAt + 40 * 60_000);
      const pendingDraft: PaidDraft = {
        ...existing,
        originalQuestion: fallbackQuestion,
        question: fallbackQuestion,
        name: text(verifiedFields?.name, 80) || itemProperty(first, ['name', 'your name']) || existing.name,
        status: 'pending',
        missingQuestion: true,
        reviewUntil,
        tier: packageAuthority.tier,
        shopifyVariantId: packageAuthority.variantId,
        shopifySku: packageAuthority.sku,
        verifiedFields,
        numerology: numerology || existing.numerology,
      };
      await env.READINGS_CACHE.put(`paid-draft:${orderId}`, JSON.stringify({ ...pendingDraft, orderId }), {
        expirationTtl: 60 * 60 * 24 * 365,
      });
      return { draft: pendingDraft };
    }
    const draft: PaidDraft = {
      ...existing,
      originalQuestion: text(verifiedQuestion || existing.originalQuestion || existing.question || checkoutQuestion, questionLimit)
        || fallbackQuestion,
      question: knownQuestion || fallbackQuestion,
      name: text(verifiedFields?.name, 80) || itemProperty(first, ['name', 'your name']) || existing.name,
      status: 'auto_locked',
      reviewUntil: createdAt,
      confirmedAt: createdAt,
      tier: packageAuthority.tier,
      shopifyVariantId: packageAuthority.variantId,
      shopifySku: packageAuthority.sku,
      verifiedFields,
      numerology: numerology || existing.numerology,
    };
    await env.READINGS_CACHE.put(`paid-draft:${orderId}`, JSON.stringify({ ...draft, orderId }), {
      expirationTtl: 60 * 60 * 24 * 365,
    });
    return { draft };
  }

  // A legacy free-result unlock returns early after attaching the already
  // generated reading. Give that order a stable secure reference so it can use
  // the same durable fulfillment queue without exposing the numeric order ID.
  const reading = await env.READINGS_CACHE.get(`reading:${orderId}`, 'json') as JsonObject | null;
  if (!reading || (!reading.html && !Array.isArray(reading.readings))) {
    throw new QueueOperationError('PAID_DRAFT_NOT_READY');
  }
  const question = itemProperty(first, ['question', 'your question']) || 'General guidance for the path ahead';
  const secret = text(
    process.env.ENTITLEMENT_PEPPER
      || process.env.INTERNAL_ORDER_REPLAY_SECRET
      || process.env.SHOPIFY_WEBHOOK_SECRET,
    512,
  );
  if (!secret) throw new QueueOperationError('PAID_ACCESS_SECRET_MISSING');
  const accessToken = createHmac('sha256', secret)
    .update(`paid-access:${orderId}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  const draft: PaidDraft = {
    accessToken,
    originalQuestion: question,
    question,
    name: itemProperty(first, ['name', 'your name']),
    status: 'auto_locked',
    editCount: 0,
    reviewUntil: createdAt,
    confirmedAt: createdAt,
    tier: packageAuthority.tier,
    shopifyVariantId: packageAuthority.variantId,
    shopifySku: packageAuthority.sku,
    verifiedFields: Object.keys(mergedVerifiedFields).length ? mergedVerifiedFields : undefined,
    numerology: numerology || undefined,
  };
  await Promise.all([
    env.READINGS_CACHE.put(`paid-draft:${orderId}`, JSON.stringify({ ...draft, orderId }), {
      expirationTtl: 60 * 60 * 24 * 365,
    }),
    env.READINGS_CACHE.put(`paid-access:${accessToken}`, orderId, {
      expirationTtl: 60 * 60 * 24 * 365,
    }),
  ]);
  return { draft };
}

async function validateMembershipActivation(payload: JsonObject, env: WorkerEnvironment) {
  const items = Array.isArray(payload.line_items) ? payload.line_items : [];
  const hasMembership = items.some((item) => item && typeof item === 'object'
    && text((item as JsonObject).sku, 80).toUpperCase() === 'MEMBER-PREMIUM');
  if (!hasMembership) return;
  const customer = payload.customer && typeof payload.customer === 'object'
    ? payload.customer as JsonObject
    : null;
  const customerId = text(customer?.id, 96);
  if (!customerId) throw new QueueOperationError('MEMBERSHIP_CUSTOMER_REQUIRED');
  const membershipExpiry = await env.READINGS_CACHE.get(`memberexp:${customerId}`);
  if (!membershipExpiry) throw new QueueOperationError('MEMBERSHIP_ACTIVATION_NOT_CONFIRMED');
}

async function persistPaidOrder(
  payload: JsonObject,
  items: JsonObject[],
  draft: PaidDraft,
  dueAt: Date,
  numerology: JsonObject | null = null,
  checkout: VerifiedCheckoutContext | null = null,
  intent: VerifiedReadingIntent | null = null,
) {
  const orderId = text(payload.id, 96);
  const verifiedVariantId = intent?.variantId || checkout?.variantId || '';
  const first = verifiedVariantId
    ? items.find((item) => text(item.variant_id, 64) === verifiedVariantId) || items[0] || {}
    : items[0] || {};
  const sku = text(first.sku, 80).toUpperCase();
  const packageAuthority = paidPackageAuthority(first);
  assertPaidDraftPackageAuthority(draft, packageAuthority);
  const questionLimit = paidQuestionLengthLimit(draft.verifiedFields);
  const originalQuestion = text(draft.originalQuestion || itemProperty(first, ['question', 'your question']), questionLimit)
    || 'General guidance for the path ahead';
  const confirmedQuestion = text(draft.question || originalQuestion, questionLimit) || originalQuestion;
  const reviewStatus = normalizedReviewStatus(draft);
  const verifiedFollowupCredits = intent?.intentKind === 'angel_number'
    ? Math.max(0, Math.min(1, Number(intent.verifiedFields.followupCredits) || 0))
    : 0;
  const totalReadingCredits = Math.max(1, readingCredits(items) + verifiedFollowupCredits);
  const attribution = readingAttribution(first);
  const customerContext = customerLocaleContext({
    locale: draft.verifiedFields?.locale || draft.verifiedFields?.lang || payload.customer_locale,
    country: draft.verifiedFields?.country || orderCountryCode(payload),
    currency: draft.verifiedFields?.currency || payload.presentment_currency || payload.currency,
    market: draft.verifiedFields?.market,
  });
  const sourceContext = {
    source: 'shopify_orders_paid',
    page: attribution.page,
    readingMode: attribution.readingMode || null,
    conversationId: attribution.conversationId || null,
    readingId: attribution.readingId || null,
    funnelVersion: attribution.funnelVersion || null,
    snapshotVersion: attribution.snapshotVersion || null,
    recommendedPackage: attribution.recommendedPackage || null,
    selectedPackage: packageAuthority.tier,
    experimentKey: attribution.experimentKey || null,
    experimentVariant: attribution.experimentVariant || null,
    answersUsed: attribution.answersUsed,
    locale: customerContext.locale,
    language: customerContext.language,
    country: customerContext.country || null,
    currency: customerContext.currency || null,
    market: customerContext.market || null,
    ...(checkout ? {
      checkout: {
        contextId: checkout.contextId,
        tier: checkout.tier,
        variantId: checkout.variantId,
        sku: checkout.sku,
        clarifierCards: checkout.clarifiers.map((card) => ({
          id: card.id,
          name: card.name,
          isReversed: card.isReversed,
          position: card.position,
        })),
        verifiedServerSide: true,
      },
    } : {}),
    ...(intent ? {
      checkoutIntent: {
        id: intent.intentId,
        tier: intent.tier,
        variantId: intent.variantId,
        sku: intent.sku,
        price: intent.price,
        category: intent.category,
        kind: intent.intentKind,
        verifiedServerSide: true,
      },
    } : {}),
    ...(numerology ? {
      numerology: {
        kind: numerology.kind || 'compatibility',
        variantId: numerology.variantId,
        packageLabel: numerology.packageLabel,
        ...(numerology.kind === 'life_path' ? {
          focus: numerology.focus,
          reportYear: numerology.reportYear,
          profile: numerology.profile,
        } : {
          connection: numerology.connectionKey,
          compatibilityFocus: numerology.compatibilityFocusKey,
          premiumFocus: numerology.premiumFocusKey,
          score: numerology.score,
          archetype: numerology.archetype,
          dimensions: numerology.dimensions,
          first: numerology.first,
          second: numerology.second,
        }),
        verifiedServerSide: true,
      },
    } : {}),
  };
  const reviewUntilMs = Number(draft.reviewUntil) || payloadCreatedAt(payload) + 20 * 60 * 1000;
  const confirmedAtMs = Number(draft.confirmedAt) || 0;
  const sql = db();
  await sql`
    insert into deckaura.paid_orders(
      order_id, order_name, access_token, email, customer_name,
      financial_status, sku, tier, quantity, original_question,
      confirmed_question, source_context, promised_deliverables,
      review_status, edit_count, review_until, confirmed_at, due_at, status
    ) values (
      ${orderId}, ${text(payload.name, 40) || null}, ${String(draft.accessToken)},
      ${text(payload.email || payload.contact_email, 320) || null}, ${text(draft.name, 80) || null},
      ${text(payload.financial_status, 40) || null}, ${sku || null}, ${packageAuthority.tier},
      ${totalReadingCredits}, ${originalQuestion}, ${confirmedQuestion},
      ${sql.json(sourceContext as never)},
      ${sql.json({
        readingCredits: totalReadingCredits,
        tier: packageAuthority.tier,
        ...(intent ? {
          checkoutIntentVerified: true,
          answer: text(intent.verifiedFields.answer, 20),
          cardName: text(intent.verifiedFields.cardName, 80),
          category: intent.category,
          slaMinutes: 90,
          ...(intent.intentKind === 'daily_tarot' ? {
            packageTitle: text(intent.verifiedFields.packageTitle, 100),
            cardCount: Number(intent.verifiedFields.cardCount),
            spread: text(intent.verifiedFields.spread, 1_000),
            coverageDays: Number(intent.verifiedFields.coverageDays),
            dailyTarotSnapshotVersion: text(intent.verifiedFields.dailyTarotSnapshotVersion, 64),
          } : {}),
          ...(intent.intentKind === 'daily_horoscope' ? {
            packageTitle: text(intent.verifiedFields.packageTitle, 100),
            focus: text(intent.verifiedFields.focus, 100),
            birthTimeStatus: text(intent.verifiedFields.birthTimeStatus, 20),
            transitCount: Number(intent.verifiedFields.transitCount),
            coverageDays: Number(intent.verifiedFields.coverageDays),
            horoscopeSnapshotVersion: text(intent.verifiedFields.dailyHoroscopeSnapshotVersion, 64),
          } : {}),
          ...(intent.intentKind === 'birth_chart' ? {
            packageTitle: text(intent.verifiedFields.packageTitle, 100),
            focus: text(intent.verifiedFields.focus, 100),
            birthTimeStatus: text(intent.verifiedFields.birthTimeStatus, 20),
            chartSnapshotVersion: text(intent.verifiedFields.birthChartSnapshotVersion, 64),
          } : {}),
          ...(intent.intentKind === 'big_three' ? {
            packageTitle: text(intent.verifiedFields.packageTitle, 100),
            focus: text(intent.verifiedFields.focus, 100),
            birthTimeStatus: text(intent.verifiedFields.birthTimeStatus, 20),
            bigThreeSnapshotVersion: text(intent.verifiedFields.bigThreeSnapshotVersion, 64),
          } : {}),
          ...(intent.intentKind === 'angel_number' ? {
            packageTitle: text(intent.verifiedFields.packageTitle, 100),
            focus: text(intent.verifiedFields.focus, 100),
            angelNumber: text(intent.verifiedFields.angelNumber, 16),
            angelNumberCore: text(intent.verifiedFields.angelNumberCore, 16),
            angelNumberSnapshotVersion: text(intent.verifiedFields.angelNumberSnapshotVersion, 64),
            readingMode: text(intent.verifiedFields.readingMode, 40),
            articleSource: text(intent.verifiedFields.articleSource, 160),
            articleTopic: text(intent.verifiedFields.articleTopic, 40),
            supportiveCardCount: Number(intent.verifiedFields.supportiveCardCount),
            followupCredits: Number(intent.verifiedFields.followupCredits),
          } : {}),
          ...(intent.intentKind === 'numerology_compatibility' ? {
            packageTitle: text(intent.verifiedFields.packageTitle, 100),
            focus: text(intent.verifiedFields.focus, 160),
            numerologyCompatibilitySnapshotVersion: text(intent.verifiedFields.numerologyCompatibilitySnapshotVersion, 64),
          } : {}),
          ...(intent.intentKind === 'zodiac_compatibility' ? {
            packageTitle: text(intent.verifiedFields.packageTitle, 100),
            pair: text(intent.verifiedFields.pair, 80),
            focus: text(intent.verifiedFields.focus, 100),
            relationshipStage: text(intent.verifiedFields.relationshipStage, 40),
            zodiacCompatibilitySnapshotVersion: text(intent.verifiedFields.zodiacCompatibilitySnapshotVersion, 64),
          } : {}),
          ...(intent.intentKind === 'moon_lunar' ? {
            packageTitle: text(intent.verifiedFields.packageTitle, 100),
            focus: text(intent.verifiedFields.focus, 100),
            moonPhase: text(intent.verifiedFields.moonPhase, 40),
            moonSign: text(intent.verifiedFields.moonSign, 24),
            natalMoon: text(intent.verifiedFields.natalMoon, 48),
            birthTimeStatus: text(intent.verifiedFields.birthTimeStatus, 20),
            coverageDays: Number(intent.verifiedFields.coverageDays),
            moonLunarSnapshotVersion: text(intent.verifiedFields.moonLunarSnapshotVersion, 64),
          } : {}),
        } : {}),
        ...(checkout ? {
          checkoutContextVerified: true,
          clarifierCount: checkout.clarifiers.length,
          clarifierPositions: checkout.clarifiers.map((card) => card.position),
          slaMinutes: 90,
        } : {}),
        ...(numerology ? { deliverables: numerology.deliverables, slaMinutes: 90 } : {}),
      } as never)},
      ${reviewStatus}, ${Math.max(0, Math.min(Number(draft.editCount) || 0, 1))},
      ${new Date(reviewUntilMs)}, ${confirmedAtMs ? new Date(confirmedAtMs) : null},
      ${dueAt}, ${reviewStatus === 'pending' ? 'review_pending' : 'queued'}
    )
    on conflict (order_id) do update
      set order_name = coalesce(excluded.order_name, deckaura.paid_orders.order_name),
          email = coalesce(excluded.email, deckaura.paid_orders.email),
          customer_name = coalesce(excluded.customer_name, deckaura.paid_orders.customer_name),
          financial_status = coalesce(excluded.financial_status, deckaura.paid_orders.financial_status),
          sku = coalesce(excluded.sku, deckaura.paid_orders.sku),
          tier = excluded.tier,
          quantity = excluded.quantity,
          original_question = excluded.original_question,
          confirmed_question = excluded.confirmed_question,
          source_context = excluded.source_context,
          promised_deliverables = excluded.promised_deliverables,
          review_status = excluded.review_status,
          edit_count = excluded.edit_count,
          review_until = excluded.review_until,
          confirmed_at = coalesce(excluded.confirmed_at, deckaura.paid_orders.confirmed_at),
          due_at = least(deckaura.paid_orders.due_at, excluded.due_at),
          status = case
            when deckaura.paid_orders.status in ('generating', 'generated', 'delivering', 'delivered')
              then deckaura.paid_orders.status
            else excluded.status
          end,
          updated_at = clock_timestamp()
  `;
}

async function enqueueReadingFromWebhook(row: WebhookQueueRow, env: WorkerEnvironment) {
  const payload = row.payload || {};
  const items = readingItems(payload);
  if (!items.length) return { queued: false };

  const orderId = text(payload.id, 96);
  if (!orderId || (row.order_id && row.order_id !== orderId)) {
    throw new QueueOperationError('SHOPIFY_ORDER_ID_MISMATCH');
  }
  if (!shopifyFinancialStatusAllowsReadingFulfillment(payload.financial_status)) {
    throw new QueueOperationError('SHOPIFY_PAYMENT_NOT_CAPTURED');
  }
  const compatibilityNumerology = validateNumerologyCompatibilityOrder(payload, items) as JsonObject | null;
  const lifePathNumerology = validateNumerologyLifePathOrder(payload, items) as JsonObject | null;
  if (compatibilityNumerology && lifePathNumerology) throw new QueueOperationError('NUMEROLOGY_REPORT_TYPE_AMBIGUOUS');
  const numerology = compatibilityNumerology || lifePathNumerology;
  const checkout = await verifiedTarotCheckoutContext(items, env);
  const intent = await verifiedReadingIntent(items, payload);
  if (checkout && intent) throw new QueueOperationError('CHECKOUT_AUTHORITY_AMBIGUOUS');
  const { draft } = await queueDraftForOrder(payload, items, env, numerology, checkout, intent);
  const requestedNumerologyDelay = Number(numerology?.deliveryDelayMinutes);
  const delayMinutes = Number.isFinite(requestedNumerologyDelay) && requestedNumerologyDelay > 0
    ? requestedNumerologyDelay
    : readingDeliveryDelayMinutes(orderId, env);
  const reviewHoldMs = normalizedReviewStatus(draft) === 'pending' ? (Number(draft.reviewUntil) || 0) + 5 * 60_000 : 0;
  const dueAt = new Date(Math.max(payloadCreatedAt(payload) + delayMinutes * 60_000, reviewHoldMs));
  await persistPaidOrder(payload, items, draft, dueAt, numerology, checkout, intent);
  const verifiedVariantId = intent?.variantId || checkout?.variantId || '';
  const first = verifiedVariantId
    ? items.find((item) => text(item.variant_id, 64) === verifiedVariantId) || items[0] || {}
    : items[0] || {};
  const packageAuthority = paidPackageAuthority(first);
  const attribution = readingAttribution(first);
  const customerContext = customerLocaleContext({
    locale: draft.verifiedFields?.locale || draft.verifiedFields?.lang || payload.customer_locale,
    country: draft.verifiedFields?.country || orderCountryCode(payload),
    currency: draft.verifiedFields?.currency || payload.presentment_currency || payload.currency,
    market: draft.verifiedFields?.market,
  });
  const email = text(payload.email || payload.contact_email, 320).toLowerCase();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await funnelStore.enqueuePostPurchase({
      orderId,
      email,
      emailHash: lifecycleEmailHash(email),
      name: text(draft.name, 80) || null,
      accessToken: text(draft.accessToken, 96) || null,
      orderCreatedAt: new Date(payloadCreatedAt(payload)),
      payload: {
        page: attribution.page,
        readingMode: attribution.readingMode || '',
        conversationId: attribution.conversationId || '',
        readingId: attribution.readingId || '',
        funnelVersion: attribution.funnelVersion || '',
        selectedPackage: packageAuthority.tier,
        checkoutContextVerified: Boolean(checkout),
        checkoutIntentVerified: Boolean(intent),
        experimentKey: attribution.experimentKey || '',
        experimentVariant: attribution.experimentVariant || '',
        locale: customerContext.locale,
        language: customerContext.language,
        country: customerContext.country,
        currency: customerContext.currency,
        market: customerContext.market,
        marketingConsent: shopifyMarketingConsent(payload),
      },
    });
  }
  await funnelStore.recordEvents(null, [{
    eventId: deterministicUuid(`shopify-purchase:${orderId}`),
    eventName: attribution.page === LOVE_TAROT_PAGE
      ? 'love_purchase_completed'
      : attribution.page === ANGEL_NUMBER_PAGE
      ? 'purchase_completed'
      : attribution.page === DAILY_HOROSCOPE_PAGE
      ? 'horoscope_purchase'
      : attribution.page === DAILY_TAROT_PAGE
      ? 'daily_purchase_completed'
      : attribution.page === BIRTH_CHART_PAGE
      ? 'birth_chart_purchase_completed'
      : attribution.page === BIG_THREE_PAGE
      ? 'smr_purchase'
      : attribution.page === ZODIAC_COMPATIBILITY_PAGE
      ? 'zodiac_compatibility_purchase_completed'
      : attribution.page === MOON_LUNAR_PAGE
      ? 'moon_purchase_completed'
      : attribution.page === '/pages/career-tarot-reading'
      ? 'career_purchase'
      : numerology?.kind === 'life_path'
      ? 'life_path_purchase_completed'
      : numerology ? 'purchase_completed' : 'reading_purchase_completed',
    conversationId: attribution.conversationId || null,
    readingId: attribution.readingId || null,
    page: attribution.page,
    readingMode: attribution.readingMode || null,
    funnelVersion: attribution.funnelVersion || 'shopify-orders-paid',
    experimentKey: attribution.experimentKey || null,
    experimentVariant: attribution.experimentVariant || null,
    recommendedTier: attribution.recommendedPackage || null,
    selectedTier: packageAuthority.tier,
    shopifyVariantId: text(first.variant_id, 64) || null,
    orderId,
    revenue: readingRevenue(items),
    currency: text(payload.currency, 3).toUpperCase() || null,
    metadata: { source: 'verified_shopify_webhook', answers_used: attribution.answersUsed },
    occurredAt: new Date(payloadCreatedAt(payload)).toISOString(),
  }]).catch((error) => safeQueueLog('purchase_attribution_record_failed', error, 'shopify_orders_paid'));
  const job = await deliveryRetry.enqueueDelivery(paidReadingDeliveryJobInput(orderId, dueAt));
  if (!job) throw new QueueOperationError('DELIVERY_ENQUEUE_FAILED');
  return { queued: true };
}

async function updatePaidOrderBeforeDelivery(orderId: string, env: WorkerEnvironment) {
  const draft = await paidDraftForOrder(orderId, env);
  const confirmedQuestion = text(draft?.question, paidQuestionLengthLimit(draft?.verifiedFields));
  const reviewStatus = draft ? normalizedReviewStatus(draft) : 'auto_locked';
  const draftTier = draft?.tier || '';
  const sql = db();
  const rows = await sql<Array<{ tier: ReadingTier }>>`
    update deckaura.paid_orders
       set confirmed_question = case when ${confirmedQuestion} <> '' then ${confirmedQuestion} else confirmed_question end,
           review_status = ${reviewStatus},
           edit_count = ${Math.max(0, Math.min(Number(draft?.editCount) || 0, 1))},
           confirmed_at = coalesce(${draft?.confirmedAt ? new Date(Number(draft.confirmedAt)) : null}, confirmed_at),
           status = 'generating',
           updated_at = clock_timestamp()
     where order_id = ${orderId}
       and (${draftTier} = '' or tier::text = ${draftTier})
     returning tier
  `;
  if (!rows[0]) {
    throw new QueueOperationError(draftTier ? 'PAID_ORDER_TIER_MISMATCH' : 'PAID_ORDER_NOT_FOUND');
  }
}

async function updatePaidOrderAfterDelivery(orderId: string, fulfillmentId = '') {
  const sql = db();
  const rows = await sql<Array<{
    created_at: Date;
    delivered_at: Date;
    source_context: JsonObject;
    tier: ReadingTier;
  }>>`
    update deckaura.paid_orders
       set status = 'delivered',
           generated_at = coalesce(generated_at, clock_timestamp()),
           delivered_at = coalesce(delivered_at, clock_timestamp()),
           fulfillment_id = case when ${fulfillmentId} <> '' then ${fulfillmentId} else fulfillment_id end,
           updated_at = clock_timestamp()
     where order_id = ${orderId}
    returning created_at, delivered_at, source_context, tier
  `;
  return rows[0] || null;
}

async function recordDeliverySlaEvent(orderId: string, delivered: {
  created_at: Date;
  delivered_at: Date;
  source_context: JsonObject;
  tier: ReadingTier;
} | null) {
  if (!delivered) return;
  const source = delivered.source_context && typeof delivered.source_context === 'object'
    ? delivered.source_context
    : {};
  const sourcePage = text(source.page, 160);
  if (sourcePage !== LOVE_TAROT_PAGE
    && sourcePage !== ANGEL_NUMBER_PAGE
    && sourcePage !== DAILY_HOROSCOPE_PAGE
    && sourcePage !== DAILY_TAROT_PAGE
    && sourcePage !== BIRTH_CHART_PAGE
    && sourcePage !== BIG_THREE_PAGE
    && sourcePage !== ZODIAC_COMPATIBILITY_PAGE
    && sourcePage !== MOON_LUNAR_PAGE) return;
  const createdAt = new Date(delivered.created_at).getTime();
  const deliveredAt = new Date(delivered.delivered_at).getTime();
  const deliveryMinutes = Number.isFinite(createdAt) && Number.isFinite(deliveredAt)
    ? Math.max(0, (deliveredAt - createdAt) / 60_000)
    : 0;
  const metSla = deliveryMinutes <= 90;
  await funnelStore.recordEvents(null, [{
    eventId: deterministicUuid(`${sourcePage === ANGEL_NUMBER_PAGE ? 'angel-number' : sourcePage === DAILY_HOROSCOPE_PAGE ? 'daily-horoscope' : sourcePage === DAILY_TAROT_PAGE ? 'daily' : sourcePage === BIRTH_CHART_PAGE ? 'birth-chart' : sourcePage === BIG_THREE_PAGE ? 'big-three' : sourcePage === ZODIAC_COMPATIBILITY_PAGE ? 'zodiac-compatibility' : sourcePage === MOON_LUNAR_PAGE ? 'moon-lunar' : 'love'}-delivery-sla:${orderId}`),
    eventName: sourcePage === DAILY_HOROSCOPE_PAGE
      ? (metSla ? 'horoscope_delivery_under_90' : 'horoscope_delivery_late')
      : sourcePage === DAILY_TAROT_PAGE
      ? (metSla ? 'daily_delivery_under_90' : 'daily_delivery_late')
      : sourcePage === ANGEL_NUMBER_PAGE
        ? (metSla ? 'reading_delivered' : 'reading_delivery_late')
      : sourcePage === BIRTH_CHART_PAGE
        ? (metSla ? 'birth_chart_delivery_under_90' : 'birth_chart_delivery_late')
        : sourcePage === BIG_THREE_PAGE
          ? (metSla ? 'smr_delivery_under_90' : 'smr_delivery_late')
        : sourcePage === ZODIAC_COMPATIBILITY_PAGE
          ? (metSla ? 'zodiac_compatibility_delivery_under_90' : 'zodiac_compatibility_delivery_late')
        : sourcePage === MOON_LUNAR_PAGE
          ? (metSla ? 'moon_delivery_under_90' : 'moon_delivery_late')
        : (metSla ? 'love_delivery_under_90' : 'love_delivery_late'),
    page: sourcePage,
    readingId: text(source.readingId, 128) || null,
    readingMode: text(source.readingMode, 64) || 'intent_first',
    funnelVersion: text(source.funnelVersion, 128)
      || (sourcePage === DAILY_TAROT_PAGE
        ? DAILY_TAROT_FUNNEL_VERSION
        : sourcePage === DAILY_HOROSCOPE_PAGE
          ? DAILY_HOROSCOPE_FUNNEL_VERSION
        : sourcePage === ANGEL_NUMBER_PAGE
          ? ANGEL_NUMBER_FUNNEL_VERSION
        : sourcePage === BIRTH_CHART_PAGE
          ? BIRTH_CHART_FUNNEL_VERSION
          : sourcePage === BIG_THREE_PAGE
            ? BIG_THREE_FUNNEL_VERSION
            : sourcePage === ZODIAC_COMPATIBILITY_PAGE
              ? ZODIAC_COMPATIBILITY_FUNNEL_VERSION
              : sourcePage === MOON_LUNAR_PAGE ? MOON_LUNAR_FUNNEL_VERSION : LOVE_TAROT_FUNNEL_VERSION),
    selectedTier: delivered.tier,
    orderId,
    metadata: {
      source: 'verified_delivery_completion',
      deliveryMinutes: Math.round(deliveryMinutes * 100) / 100,
      slaMinutes: 90,
      metSla,
    },
    occurredAt: new Date(deliveredAt).toISOString(),
  }]);
}

async function updatePaidOrderAfterFailure(orderId: string) {
  const sql = db();
  await sql`
    update deckaura.paid_orders
       set status = case when status = 'delivered' then status else 'failed' end,
           updated_at = clock_timestamp()
     where order_id = ${orderId}
  `;
}

async function markDeliveryManualReview(job: DeliveryJobRow, error: unknown) {
  const errorCode = operationalErrorCode(error);
  const sql = db();
  await sql.begin(async (transaction) => {
    await transaction`
      update deckaura.delivery_jobs
         set result_metadata = coalesce(result_metadata, '{}'::jsonb) || jsonb_build_object(
               'manualReview', true,
               'manualReviewReason', ${errorCode}::text,
               'manualReviewAt', clock_timestamp()
             ),
             updated_at = clock_timestamp()
       where id = ${job.id}::uuid
         and order_id = ${job.order_id}
         and status = 'failed'
         and dead_lettered_at is not null
    `;
    await transaction`
      update deckaura.paid_orders
         set result_metadata = coalesce(result_metadata, '{}'::jsonb) || jsonb_build_object(
               'manualReview', true,
               'manualReviewReason', ${errorCode}::text,
               'manualReviewAt', clock_timestamp()
             ),
             updated_at = clock_timestamp()
       where order_id = ${job.order_id}
         and status <> 'delivered'
    `;
  });
}

function legacyDeliveryFailureCode(value: unknown, explicitCode?: unknown) {
  const code = text(explicitCode, 96).toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  if (code && code !== 'ERROR' && code !== 'RUNTIME_ERROR') return code;
  const message = String(value || '').toLowerCase();
  if (message.includes('order not found')) return 'SHOPIFY_ORDER_NOT_FOUND';
  if (message.includes('fulfillment_orders')) return 'SHOPIFY_FULFILLMENT_ORDERS_FAILED';
  if (message.includes('fulfillment')) return 'SHOPIFY_FULFILLMENT_FAILED';
  if (message.includes('semantic')) return 'PAID_READING_SEMANTIC_REVIEW_FAILED';
  if (message.includes('shopify')) return 'SHOPIFY_ORDER_FETCH_FAILED';
  return 'PAID_READING_DELIVERY_FAILED';
}

async function processPaidReading(job: DeliveryJobRow, env: WorkerEnvironment) {
  await updatePaidOrderBeforeDelivery(job.order_id, env);
  const results = await deliverDueReadings(env, { onlyOrderId: job.order_id });
  const result = Array.isArray(results) ? results[0] as JsonObject | undefined : undefined;
  if (!result) throw new QueueOperationError('PAID_READING_DELIVERY_EMPTY_RESULT');
  if (result.error) throw new QueueOperationError(legacyDeliveryFailureCode(result.error, result.errorCode));
  if (!hasConfirmedReadingFulfillment(result)) {
    throw new QueueOperationError('PAID_READING_FULFILLMENT_EVIDENCE_MISSING');
  }
  const delivered = await updatePaidOrderAfterDelivery(job.order_id, text(result.fulfillmentId, 160));
  await recordDeliverySlaEvent(job.order_id, delivered).catch((error) => {
    safeQueueLog('delivery_sla_event_record_failed', error, job.job_type);
  });
  return result.fulfilled === true ? 'fulfilled' : 'already_fulfilled';
}

async function processWebhookClaim(row: WebhookQueueRow, env: WorkerEnvironment, state: QueueCounters) {
  state.claimed += 1;
  if (!row.lease_token) throw new QueueOperationError('WEBHOOK_LEASE_TOKEN_MISSING');
  try {
    const topic = text(row.topic, 128).toLowerCase().replace(/_/g, '/');
    if (topic === 'orders/paid'
      && !shopifyFinancialStatusAllowsReadingFulfillment(row.payload?.financial_status)) {
      throw new QueueOperationError('SHOPIFY_PAYMENT_NOT_CAPTURED');
    }
    const alreadyDelivered = topic === 'orders/paid'
      ? await hasPreviouslyDeliveredOrderAuthority(row)
      : false;
    if (alreadyDelivered) {
      // Completing the duplicate webhook is the only allowed side effect. In
      // particular, do not replay the legacy worker, re-email, re-fulfill, or
      // enqueue another paid-reading job for an authoritatively delivered order.
      state.ignored += 1;
    } else {
      const replay = await replayShopifyWebhook(row, env);
      if (replay.ignored) state.ignored += 1;
      else {
        await validateMembershipActivation(row.payload || {}, env);
        await enqueueReadingFromWebhook(row, env);
      }
    }
    const completion = await deliveryRetry.completeShopifyWebhook(row.webhook_id, row.lease_token);
    if (completion.allowed === true) state.completed += 1;
    else state.completionRejected += 1;
  } catch (error) {
    safeQueueLog('reading_webhook_processing_failed', error, undefined, {
      orderId: row.order_id,
      webhookId: row.webhook_id,
    });
    const failure = await deliveryRetry.failShopifyWebhook(row.webhook_id, row.lease_token, error);
    if (failure.allowed !== true) state.completionRejected += 1;
    else if (failure.terminal === true) {
      state.deadLettered += 1;
      safeQueueLog('reading_webhook_manual_review_required', error, undefined, {
        orderId: row.order_id,
        webhookId: row.webhook_id,
      });
    }
    else state.retryScheduled += 1;
  }
}

async function processDeliveryClaim(job: DeliveryJobRow, env: WorkerEnvironment, state: QueueCounters) {
  state.claimed += 1;
  if (!job.lease_token) throw new QueueOperationError('DELIVERY_LEASE_TOKEN_MISSING');
  let stopHeartbeat: (() => Promise<boolean>) | null = null;
  try {
    if (job.job_type !== 'paid_reading') throw new QueueOperationError('UNSUPPORTED_JOB_TYPE');
    stopHeartbeat = startDeliveryLeaseHeartbeat(job);
    const outcome = await processPaidReading(job, env);
    const leaseStillHeld = await stopHeartbeat();
    stopHeartbeat = null;
    if (!leaseStillHeld) throw new QueueOperationError('DELIVERY_LEASE_LOST');
    const completion = await deliveryRetry.completeDelivery(job.id, job.lease_token, undefined, {
      outcome,
      jobType: job.job_type,
      attempt: job.attempts,
    });
    if (completion.allowed === true) state.completed += 1;
    else state.completionRejected += 1;
  } catch (error) {
    if (stopHeartbeat) {
      await stopHeartbeat();
      stopHeartbeat = null;
    }
    await updatePaidOrderAfterFailure(job.order_id).catch((statusError) => {
      safeQueueLog('paid_order_status_update_failed', statusError, job.job_type, {
        orderId: job.order_id,
        jobId: job.id,
      });
    });
    safeQueueLog('reading_delivery_processing_failed', error, job.job_type, {
      orderId: job.order_id,
      jobId: job.id,
    });
    const failure = await deliveryRetry.failDelivery(job.id, job.lease_token, error);
    if (failure.allowed !== true) state.completionRejected += 1;
    else if (failure.terminal === true) {
      state.deadLettered += 1;
      await markDeliveryManualReview(job, error).catch((reviewError) => {
        safeQueueLog('reading_delivery_manual_review_mark_failed', reviewError, job.job_type, {
          orderId: job.order_id,
          jobId: job.id,
        });
      });
      safeQueueLog('reading_delivery_manual_review_required', error, job.job_type, {
        orderId: job.order_id,
        jobId: job.id,
      });
    }
    else state.retryScheduled += 1;
  } finally {
    if (stopHeartbeat) await stopHeartbeat();
  }
}

function escapeEmailHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] || character));
}

function emailParagraphs(value: unknown) {
  const clean = text(value, 5_000);
  return clean.split(/\n{2,}/).filter(Boolean).slice(0, 8)
    .map((paragraph) => `<p>${escapeEmailHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function lifecycleButton(href: string, label: string) {
  return `<p style="text-align:center;margin:24px 0"><a href="${escapeEmailHtml(href)}" style="display:inline-block;background:#261a36;color:#fff8e8;text-decoration:none;font:700 14px Arial,Helvetica,sans-serif;padding:13px 24px;border-radius:999px">${escapeEmailHtml(label)}</a></p>`;
}

function lifecycleText(locale: string, english: string, spanish: string, german: string) {
  const language = customerLocaleContext({ locale }).language;
  return language === 'es' ? spanish : language === 'de' ? german : english;
}

function lifecycleEmailShell(inner: string, unsubscribeToken: string, locale: string) {
  const unsubscribeUrl = `https://reading.deckaura.com/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  const signoff = lifecycleText(locale,
    `With warmth,<br><strong>Deckaura</strong><br><span style="color:#6f679a;font-size:14px">Using Selin's interpretation framework</span>`,
    `Con cariño,<br><strong>Deckaura</strong><br><span style="color:#6f679a;font-size:14px">Con el método de interpretación de Selin</span>`,
    `Herzlich,<br><strong>Deckaura</strong><br><span style="color:#6f679a;font-size:14px">Nach Selins Deutungsrahmen</span>`,
  );
  const footer = lifecycleText(locale,
    `You received this because you asked Deckaura to email a saved reading or purchased a personalized reading. <a href="${unsubscribeUrl}" style="color:#6f4f12">Stop optional follow-up emails</a>. Order and delivery emails are not affected.`,
    `Has recibido este mensaje porque pediste a Deckaura que guardara una lectura por correo o compraste una lectura personalizada. <a href="${unsubscribeUrl}" style="color:#6f4f12">Dejar de recibir seguimientos opcionales</a>. Los correos de pedido y entrega no se verán afectados.`,
    `Du erhältst diese Nachricht, weil du Deckaura gebeten hast, eine gespeicherte Deutung per E-Mail zu senden, oder weil du eine persönliche Deutung gekauft hast. <a href="${unsubscribeUrl}" style="color:#6f4f12">Optionale Folge-E-Mails abbestellen</a>. Bestell- und Liefer-E-Mails bleiben davon unberührt.`,
  );
  return `<!doctype html><html lang="${customerLocaleContext({ locale }).language}"><body style="margin:0;padding:0;background:#faf6ee"><div style="max-width:620px;margin:0 auto;padding:36px 22px;font-family:Georgia,'Times New Roman',serif;color:#2a2140;font-size:17px;line-height:1.7"><div style="text-align:center;letter-spacing:.3em;text-transform:uppercase;font:700 12px Arial,Helvetica,sans-serif;color:#a77d2c;margin-bottom:26px">&#10022; Deckaura &#10022;</div>${inner}<p style="margin-top:28px">${signoff}</p><p style="margin-top:30px;padding-top:18px;border-top:1px solid #e7ddc9;color:#766d82;font:12px/1.55 Arial,Helvetica,sans-serif">${footer}</p></div></body></html>`;
}

function lifecycleEmail(job: LifecycleEmailJobRow) {
  const payload = job.payload || {};
  const content = job.content_payload || {};
  const locale = customerLocaleContext({ locale: payload.locale || payload.language }).locale;
  const spanish = customerLocaleContext({ locale }).language === 'es';
  const german = customerLocaleContext({ locale }).language === 'de';
  const localized = (english: string, spanishText: string, germanText: string) => spanish ? spanishText : german ? germanText : english;
  const name = text(payload.name, 80);
  const greeting = name
    ? localized(`Hi ${escapeEmailHtml(name)},`, `Hola, ${escapeEmailHtml(name)}:`, `Hallo ${escapeEmailHtml(name)},`)
    : localized('Hi there,', 'Hola:', 'Hallo,');
  const sourcePage = text(content.page || payload.page, 160);
  const freePath = sourcePage === '/pages/7-card-tarot-reading'
    ? '/pages/7-card-tarot-reading'
    : sourcePage === '/pages/career-tarot-reading'
      ? '/pages/career-tarot-reading'
      : '/pages/free-tarot-reading';
  const freePage = `https://deckaura.com${storefrontPath(locale, freePath)}`;
  const accessToken = text(payload.accessToken, 96);
  const readingLink = accessToken
    ? `https://reading.deckaura.com/r/${encodeURIComponent(accessToken)}`
    : freePage;
  const unsubscribeToken = text(job.unsubscribe_token, 64);

  if (job.email_kind === 'reading_copy') {
    const question = text(content.question, 400);
    const answer = text(content.answerText, 5_000);
    const questionBlock = question
      ? `<p style="margin:20px 0 12px;padding:14px 16px;border-left:3px solid #c8a14a;background:#f5efe2"><strong>${localized('Your question', 'Tu pregunta', 'Deine Frage')}</strong><br>${escapeEmailHtml(question)}</p>`
      : '';
    return {
      subject: localized('Your Deckaura reading, saved', 'Tu lectura de Deckaura guardada', 'Deine gespeicherte Deckaura-Deutung'),
      html: lifecycleEmailShell(`<p>${greeting}</p><p>${localized('Here is the personalized answer you asked Deckaura to save for you.', 'Aquí tienes la respuesta personalizada que pediste guardar en Deckaura.', 'Hier ist die persönliche Antwort, die Deckaura für dich speichern sollte.')}</p>${questionBlock}<div style="margin:18px 0;padding:18px;border-radius:14px;background:#fffdf8;border:1px solid #eadfca">${emailParagraphs(answer)}</div>${lifecycleButton(freePage, localized('Return to my reading', 'Volver a mi lectura', 'Zu meiner Deutung zurückkehren'))}`, unsubscribeToken, locale),
    };
  }

  if (job.email_kind === 'pre_purchase_20h') {
    const curiosity = text(content.curiosityQuestion, 400);
    const unresolved = curiosity
      ? `<p style="padding:14px 16px;border-left:3px solid #c8a14a;background:#f5efe2"><strong>${escapeEmailHtml(curiosity)}</strong></p>`
      : `<p>${localized('Notice which part of the answer still feels unfinished. That is usually the most useful place for your next question.', 'Fíjate en qué parte de la respuesta sigue pareciendo incompleta. Normalmente, ese es el punto más útil para tu siguiente pregunta.', 'Achte darauf, welcher Teil der Antwort sich noch unvollständig anfühlt. Dort liegt meist der hilfreichste Ansatz für deine nächste Frage.')}</p>`;
    return {
      subject: localized('One thread from your reading is still worth noticing', 'Hay un detalle de tu lectura que merece atención', 'Ein Punkt aus deiner Deutung verdient noch Aufmerksamkeit'),
      html: lifecycleEmailShell(`<p>${greeting}</p><p>${localized('You asked us to keep in touch after your free reading. One part may be worth sitting with before you decide whether you need anything more:', 'Nos pediste que siguiéramos en contacto después de tu lectura gratis. Quizá merezca la pena detenerte en este punto antes de decidir si necesitas algo más:', 'Du hast uns gebeten, nach deiner kostenlosen Deutung in Kontakt zu bleiben. Bevor du entscheidest, ob du noch etwas brauchst, lohnt sich vielleicht ein genauerer Blick auf diesen Punkt:')}</p>${unresolved}<p>${localized('You can return to Deckaura, continue if the saved conversation is still active on this device, or simply keep the answer you already received.', 'Puedes volver a Deckaura, continuar si la conversación guardada sigue activa en este dispositivo o quedarte simplemente con la respuesta que ya recibiste.', 'Du kannst zu Deckaura zurückkehren, das gespeicherte Gespräch fortsetzen, solange es auf diesem Gerät aktiv ist, oder einfach die bereits erhaltene Antwort behalten.')}</p>${lifecycleButton(freePage, localized('Return to my reading', 'Volver a mi lectura', 'Zu meiner Deutung zurückkehren'))}`, unsubscribeToken, locale),
    };
  }

  if (job.email_kind === 'pre_purchase_day3') {
    return {
      subject: localized('When your next question is ready', 'Cuando tengas lista tu próxima pregunta', 'Wenn deine nächste Frage bereit ist'),
      html: lifecycleEmailShell(`<p>${greeting}</p><p>${localized('A tarot reading is most useful when it helps you name the choice that is actually yours. If the same question is still circling, you can begin a fresh free reading and ask it in the clearest words you have now.', 'Una lectura de tarot resulta más útil cuando te ayuda a poner nombre a la elección que realmente depende de ti. Si la misma pregunta sigue dando vueltas, puedes empezar una nueva lectura gratis y formularla ahora con la mayor claridad posible.', 'Eine Tarotdeutung ist am hilfreichsten, wenn sie dir hilft, die Entscheidung zu benennen, die wirklich bei dir liegt. Wenn dieselbe Frage weiterkreist, kannst du eine neue kostenlose Deutung beginnen und sie jetzt so klar wie möglich formulieren.')}</p><p>${localized('There is no need to force a decision or purchase. Start free, see whether the cards speak to the real situation, and only go deeper if it feels useful.', 'No hace falta forzar una decisión ni una compra. Empieza gratis, comprueba si las cartas conectan con la situación real y profundiza solo si te resulta útil.', 'Du musst weder eine Entscheidung noch einen Kauf erzwingen. Beginne kostenlos, prüfe, ob die Karten zu deiner realen Situation passen, und vertiefe nur, wenn es für dich hilfreich ist.')}</p>${lifecycleButton(freePage, localized('Start a free reading', 'Empezar una lectura gratis', 'Kostenlose Deutung beginnen'))}`, unsubscribeToken, locale),
    };
  }

  if (job.email_kind === 'post_purchase_day2') {
    return {
      subject: localized(name ? `How did your reading land, ${name}?` : 'How did your reading land?', name ? `¿Qué te pareció tu lectura, ${name}?` : '¿Qué te pareció tu lectura?', name ? `Wie war deine Deutung für dich, ${name}?` : 'Wie war deine Deutung für dich?'),
      html: lifecycleEmailShell(`<p>${greeting}</p><p>${localized('A couple of days have passed since your personalized reading was delivered. Did it bring clarity to where you are right now?', 'Han pasado un par de días desde que entregamos tu lectura personalizada. ¿Te ayudó a ver con más claridad dónde te encuentras ahora?', 'Seit der Zustellung deiner persönlichen Deutung sind ein paar Tage vergangen. Hat sie dir geholfen, deine aktuelle Situation klarer zu sehen?')}</p><p>${localized('If anything felt unclear, reply to this email and tell us which part needs help.', 'Si alguna parte no quedó clara, responde a este correo y dinos en qué podemos ayudarte.', 'Wenn etwas unklar geblieben ist, antworte auf diese E-Mail und teile uns mit, wobei du Unterstützung brauchst.')}</p>${lifecycleButton(readingLink, localized('Reread my reading', 'Volver a leer mi lectura', 'Meine Deutung erneut lesen'))}<p style="font-size:14px;color:#6f679a">${localized('Your secure reading link is yours to keep.', 'Tu enlace privado de lectura es tuyo y puedes conservarlo.', 'Dein privater Link zur Deutung bleibt dauerhaft für dich verfügbar.')}</p>`, unsubscribeToken, locale),
    };
  }

  if (job.email_kind === 'post_purchase_day5') {
    return {
      subject: localized('A small favor from Deckaura', 'Un pequeño favor de Deckaura', 'Eine kleine Bitte von Deckaura'),
      html: lifecycleEmailShell(`<p>${greeting}</p><p>${localized('If your reading brought you clarity, would you leave a short review? It takes about thirty seconds and helps other seekers understand what a Deckaura personalized reading is like.', 'Si tu lectura te aportó claridad, ¿podrías dejar una reseña breve? Solo lleva unos treinta segundos y ayuda a otras personas a saber cómo es una lectura personalizada de Deckaura.', 'Wenn dir deine Deutung Klarheit gebracht hat, würdest du eine kurze Bewertung hinterlassen? Das dauert etwa 30 Sekunden und hilft anderen, sich ein Bild von einer persönlichen Deckaura-Deutung zu machen.')}</p>${lifecycleButton(`https://deckaura.com${storefrontPath(locale, '/products/personalized-deep-tarot-reading')}#judgeme_product_reviews`, localized('Leave a short review', 'Dejar una reseña breve', 'Kurze Bewertung abgeben'))}<p>${localized('If the reading did not land for you, reply and tell us so we can make it right.', 'Si la lectura no conectó contigo, responde y cuéntanoslo para que podamos ayudarte.', 'Wenn die Deutung für dich nicht stimmig war, antworte auf diese E-Mail, damit wir dir helfen können.')}</p>`, unsubscribeToken, locale),
    };
  }

  return {
    subject: localized('When your next question is ready', 'Cuando tengas lista tu próxima pregunta', 'Wenn deine nächste Frage bereit ist'),
    html: lifecycleEmailShell(`<p>${greeting}</p><p>${localized('New week, new questions. Whenever the next one starts circling, Deckaura will be here. As a returning reader, this link takes 20% off one new personalized reading.', 'Nueva semana, nuevas preguntas. Cuando aparezca la siguiente, Deckaura estará aquí. Como ya has leído con nosotros, este enlace aplica un 20 % de descuento a una nueva lectura personalizada.', 'Neue Woche, neue Fragen. Sobald die nächste Frage auftaucht, ist Deckaura für dich da. Als wiederkehrende Kundin oder wiederkehrender Kunde erhältst du über diesen Link 20 % Rabatt auf eine neue persönliche Deutung.')}</p>${lifecycleButton(`https://deckaura.com/discount/RETURN20?redirect=${encodeURIComponent(storefrontPath(locale, '/pages/free-tarot-reading'))}`, localized('Use my returning-reader offer', 'Usar mi oferta por volver', 'Mein Rückkehrangebot nutzen'))}<p style="font-size:14px;color:#6f679a">${localized('You can draw your cards free first and decide afterward whether a deeper reading would be useful.', 'Primero puedes sacar tus cartas gratis y decidir después si te resultaría útil una lectura más profunda.', 'Du kannst zuerst kostenlos Karten ziehen und danach entscheiden, ob eine vertiefte Deutung für dich hilfreich ist.')}</p>`, unsubscribeToken, locale),
  };
}

async function sendLifecycleEmail(job: LifecycleEmailJobRow) {
  const endpoint = text(process.env.NL_SENDONE_URL, 500)
    || 'https://deckaura-newsletter.gokimedia.workers.dev/sendone';
  const secret = text(process.env.NL_SECRET, 512);
  if (!secret) throw new QueueOperationError('NL_SECRET_MISSING');
  if (!job.lease_token) throw new QueueOperationError('LIFECYCLE_EMAIL_LEASE_MISSING');
  const mail = lifecycleEmail(job);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${endpoint}?key=${encodeURIComponent(secret)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        to: job.recipient_email,
        replyTo: 'hello@deckaura.com',
        subject: mail.subject,
        html: mail.html,
        idempotencyKey: job.idempotency_key,
      }),
    });
    const result = await response.json().catch(() => ({})) as JsonObject;
    if (!response.ok || result.ok !== true) throw new QueueOperationError(`LIFECYCLE_EMAIL_HTTP_${response.status}`);
    return text(result.id, 256) || null;
  } finally {
    clearTimeout(timeout);
  }
}

async function processLifecycleEmailClaim(job: LifecycleEmailJobRow, state: QueueCounters) {
  state.claimed += 1;
  const leaseToken = job.lease_token;
  if (!leaseToken) {
    state.completionRejected += 1;
    return;
  }
  try {
    const providerMessageId = await sendLifecycleEmail(job);
    const completed = await funnelStore.completeLifecycleEmail(job.id, leaseToken, providerMessageId);
    if (completed.allowed === true) state.completed += 1;
    else state.completionRejected += 1;
  } catch (error) {
    safeQueueLog('lifecycle_email_failed', error, job.email_kind);
    const failed = await funnelStore.failLifecycleEmail(job.id, leaseToken, error);
    if (failed.allowed !== true) state.completionRejected += 1;
    else if (failed.terminal === true) state.deadLettered += 1;
    else state.retryScheduled += 1;
  }
}

async function migrateLegacyPostPurchase(env: WorkerEnvironment, limit = 25) {
  const listed = await env.READINGS_CACHE.list({ prefix: 'pp:', limit });
  let migrated = 0;
  let invalid = 0;
  for (const key of listed.keys || []) {
    const record = await env.READINGS_CACHE.get(key.name, 'json') as JsonObject | null;
    const email = text(record?.email, 320).toLowerCase();
    const orderId = text(record?.orderId || key.name.slice(3), 96);
    if (!record || !orderId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      invalid += 1;
      continue;
    }
    const at = Number(record.at);
    await funnelStore.enqueuePostPurchase({
      orderId,
      email,
      emailHash: lifecycleEmailHash(email),
      name: text(record.name, 80) || null,
      accessToken: text(record.accessToken, 96) || null,
      orderCreatedAt: new Date(Number.isFinite(at) && at > 0 ? at : Date.now()),
      payload: { source: 'legacy_post_purchase_kv', marketingConsent: false },
    });
    await env.READINGS_CACHE.delete(key.name);
    migrated += 1;
  }
  return { migrated, invalid, remaining: listed.list_complete === false };
}

async function recoverPreFixUnknownTimeBirthChartWebhooks() {
  const sql = db();
  const recovered = await sql<Array<{ webhook_id: string }>>`
    update deckaura.webhook_events as events
       set status = 'received',
           attempts = 0,
           available_at = clock_timestamp(),
           leased_by = null,
           lease_token = null,
           lease_expires_at = null,
           error_message = null,
           dead_lettered_at = null,
           updated_at = clock_timestamp()
     where events.dead_lettered_at is not null
       and events.error_message in (
         'CHECKOUT_INTENT_BIRTH_CHART_READING_MISMATCH',
         'QueueOperationError:CHECKOUT_INTENT_BIRTH_CHART_READING_MISMATCH'
       )
       and events.received_at < ${new Date('2026-08-13T11:15:00.000Z')}
       and exists (
         select 1
           from jsonb_array_elements(events.payload->'line_items') as item,
                jsonb_array_elements(item->'properties') as property
          where lower(trim(leading '_' from property->>'name')) = 'birth time status'
            and property->>'value' = 'unknown'
       )
    returning events.webhook_id
  `;
  if (recovered.length) {
    console.info({ event: 'birth_chart_webhook_dead_letters_recovered', count: recovered.length });
  }
  return recovered.length;
}

export async function processReadingQueues(options: { deadlineMs?: number } = {}): Promise<ReadingQueueRunResult> {
  const startedAt = Date.now();
  const deadlineMs = Math.max(startedAt + 30_000, options.deadlineMs || startedAt + 255_000);
  const env = workerEnvironment();
  const workerId = `vercel:${text(process.env.VERCEL_REGION, 24) || 'region'}:${randomUUID()}`;
  const webhooks = counters();
  const deliveries = counters();
  const lifecycleEmails = counters();
  const webhookLimit = positiveInteger(process.env.CRON_WEBHOOK_LIMIT, DEFAULT_WEBHOOK_LIMIT, 50);
  const deliveryLimit = positiveInteger(process.env.CRON_DELIVERY_LIMIT, DEFAULT_DELIVERY_LIMIT, 10);
  const lifecycleEmailLimit = positiveInteger(
    process.env.CRON_LIFECYCLE_EMAIL_LIMIT,
    DEFAULT_LIFECYCLE_EMAIL_LIMIT,
    25,
  );
  const recoveredWebhooks = await recoverPreFixUnknownTimeBirthChartWebhooks();

  for (let index = 0; index < webhookLimit && Date.now() < deadlineMs - 10_000; index += 1) {
    const claimed = await deliveryRetry.claimShopifyWebhooks(workerId, 1, WEBHOOK_LEASE_SECONDS);
    if (!claimed.length) break;
    await processWebhookClaim(claimed[0], env, webhooks);
  }

  for (let index = 0; index < deliveryLimit && Date.now() < deadlineMs - MIN_DELIVERY_START_MS; index += 1) {
    const claimed = await deliveryRetry.claimDeliveries(workerId, 1, DELIVERY_LEASE_SECONDS);
    if (!claimed.length) break;
    await processDeliveryClaim(claimed[0], env, deliveries);
  }

  let legacyPostPurchase: JsonObject = { skipped: 'time_budget' };
  if (Date.now() < deadlineMs - MIN_LIFECYCLE_EMAIL_START_MS) {
    legacyPostPurchase = await migrateLegacyPostPurchase(env, 25);
  }

  for (let index = 0; index < lifecycleEmailLimit && Date.now() < deadlineMs - MIN_LIFECYCLE_EMAIL_START_MS; index += 1) {
    const claimed = await funnelStore.claimLifecycleEmails(workerId, 1, LIFECYCLE_EMAIL_LEASE_SECONDS);
    if (!claimed.length) break;
    await processLifecycleEmailClaim(claimed[0], lifecycleEmails);
  }

  let membershipSweep: JsonObject = { skipped: 'time_budget' };
  if (Date.now() < deadlineMs - MIN_MEMBERSHIP_SWEEP_START_MS) {
    const membershipLimit = positiveInteger(
      process.env.CRON_MEMBERSHIP_SWEEP_LIMIT,
      DEFAULT_MEMBERSHIP_SWEEP_LIMIT,
      25,
    );
    membershipSweep = await sweepMemberships(env, {
      limit: membershipLimit,
      deadlineMs: deadlineMs - POST_QUEUE_RESERVE_MS,
    }) as JsonObject;
  }

  return {
    recoveredWebhooks,
    webhooks,
    deliveries,
    lifecycleEmails,
    legacyPostPurchase,
    membershipSweep,
    elapsedMs: Date.now() - startedAt,
    deadlineReached: Date.now() >= deadlineMs - 10_000,
  };
}

export function readingQueueHealth(result: ReadingQueueRunResult) {
  const membershipFailures = Number(result.membershipSweep.failed) || 0;
  return {
    ok: result.webhooks.deadLettered === 0
      && result.deliveries.deadLettered === 0
      && result.lifecycleEmails.deadLettered === 0
      && result.webhooks.completionRejected === 0
      && result.deliveries.completionRejected === 0
      && result.lifecycleEmails.completionRejected === 0
      && membershipFailures === 0,
    degraded: result.webhooks.retryScheduled > 0
      || result.deliveries.retryScheduled > 0
      || result.lifecycleEmails.retryScheduled > 0
      || membershipFailures > 0
      || Boolean(result.membershipSweep.skipped)
      || result.deadlineReached,
  };
}

export async function readingSlaHealth() {
  const sql = db();
  const rows = await sql<Array<{
    open_total: number;
    open_45: number;
    open_70: number;
    open_85: number;
    open_90: number;
    delivered_late_24h: number;
    orphaned_webhook_orders: number;
  }>>`
    with paid as (
      select
        (count(*) filter (where status <> 'delivered'))::integer as open_total,
        (count(*) filter (where status <> 'delivered' and created_at <= clock_timestamp() - interval '45 minutes'))::integer as open_45,
        (count(*) filter (where status <> 'delivered' and created_at <= clock_timestamp() - interval '70 minutes'))::integer as open_70,
        (count(*) filter (where status <> 'delivered' and created_at <= clock_timestamp() - interval '85 minutes'))::integer as open_85,
        (count(*) filter (where status <> 'delivered' and created_at <= clock_timestamp() - interval '90 minutes'))::integer as open_90,
        (count(*) filter (
          where status = 'delivered'
            and delivered_at >= clock_timestamp() - interval '24 hours'
            and delivered_at > created_at + interval '90 minutes'
        ))::integer as delivered_late_24h
      from deckaura.paid_orders
      where created_at >= clock_timestamp() - interval '30 days'
    ), orphaned as (
      select count(distinct events.order_id)::integer as orphaned_webhook_orders
      from deckaura.webhook_events as events
      where events.topic = 'orders/paid'
        and events.dead_lettered_at is not null
        and events.received_at >= clock_timestamp() - interval '30 days'
        and not exists (
          select 1 from deckaura.paid_orders as orders where orders.order_id = events.order_id
        )
        and exists (
          select 1
          from jsonb_array_elements(
            case when jsonb_typeof(events.payload -> 'line_items') = 'array'
              then events.payload -> 'line_items'
              else '[]'::jsonb
            end
          ) as item
          where upper(coalesce(item ->> 'sku', '')) like 'READING-%'
        )
    )
    select paid.*, orphaned.orphaned_webhook_orders
    from paid cross join orphaned
  `;
  const row = rows[0] || {} as Record<string, number>;
  return {
    openTotal: Number(row.open_total) || 0,
    openAt45Minutes: Number(row.open_45) || 0,
    openAt70Minutes: Number(row.open_70) || 0,
    openAt85Minutes: Number(row.open_85) || 0,
    openPast90Minutes: Number(row.open_90) || 0,
    deliveredLateLast24Hours: Number(row.delivered_late_24h) || 0,
    orphanedWebhookOrders: Number(row.orphaned_webhook_orders) || 0,
  };
}

export async function cleanupExpiredReadingState(options: { deadlineMs?: number } = {}) {
  const remainingMs = options.deadlineMs ? options.deadlineMs - Date.now() : 5_000;
  if (remainingMs < 2_000) return { skipped: 'time_budget' };
  const statementTimeoutMs = Math.max(500, Math.min(4_000, remainingMs - 1_000));
  const sql = db();
  const readingState = await sql.begin(async (transaction) => {
    await transaction`
      select set_config('statement_timeout', ${`${statementTimeoutMs}ms`}, true)
    `;
    const rows = await transaction<Array<{ result: JsonObject }>>`
      select deckaura.cleanup_expired_state(5000) as result
    `;
    return rows[0]?.result || {};
  });
  const checkoutIntents = !options.deadlineMs || Date.now() < options.deadlineMs - 1_500
    ? await sql.begin(async (transaction) => {
      await transaction`
        select set_config('statement_timeout', ${`${statementTimeoutMs}ms`}, true)
      `;
      const rows = await transaction<Array<{ deleted: number }>>`
        select deckaura.cleanup_checkout_intents(5000) as deleted
      `;
      return { deleted: Number(rows[0]?.deleted) || 0 };
    })
    : { skipped: 'time_budget' };
  const funnelState = !options.deadlineMs || Date.now() < options.deadlineMs - 1_500
    ? await funnelStore.cleanup(5000)
    : { skipped: 'time_budget' };
  return { readingState, checkoutIntents, funnelState };
}
