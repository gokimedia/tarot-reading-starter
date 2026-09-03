import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { signCheckoutIntent } from '@/lib/reading-intents';
import { checkoutIntentSnapshotHash } from '@/lib/checkout-intent-persistence.mjs';
import { customerLocaleContext } from '@/lib/customer-locale.mjs';
import { workerEnvironment } from '@/lib/worker-env';
import {
  SHARED_TOOL_FUNNEL_VERSION,
  sharedToolVariantContract,
} from '@/lib/generated/shared-tool-manifest.mjs';
import {
  verifyShopifyReadingVariant,
  verifyShopifyReadingVariantQuote,
} from '@/lib/shopify-reading-variant.mjs';
import { validateNewSharedToolSnapshot } from '@/lib/new-shared-tool-evidence.mjs';
import {
  PERSONAL_DIRECT_PAGE,
  PERSONAL_DIRECT_PRESENTATION_VARIANT,
  PERSONAL_DIRECT_PUBLIC_ERROR_CODES,
  PERSONAL_DIRECT_TYPE,
  personalDirectQuestionPolicy,
  validatePersonalDirectSnapshot,
} from '@/lib/personal-direct-reading.mjs';
import {
  SEVEN_CARD_HORSESHOE_PAGE,
  sevenCardHorseshoeCheckoutSnapshotFromPreview,
  sevenCardHorseshoeCheckoutQuestionPolicy,
  sevenCardHorseshoeVisitorAuthority,
  validateSevenCardHorseshoeCompactSnapshot,
} from '@/lib/seven-card-horseshoe-compact.mjs';
import {
  BIRTH_CARD_DIRECT_PAGE,
  CAREER_DIRECT_PAGE,
  LOVE_DIRECT_PAGE,
  YES_NO_DIRECT_PAGE,
  canonicalizeDirectTarotSnapshot,
  directTarotCheckoutSnapshotFromPreview,
  directTarotQuestionPolicy,
  directTarotToolKind,
  isDirectTarotCompactPreview,
  validateDirectTarotToolSnapshot,
} from '@/lib/direct-tarot-tools.mjs';
import {
  ANGEL_NUMBER_FUNNEL_VERSION,
  ANGEL_NUMBER_PAGE,
  PERSONAL_777_FUNNEL_VERSION,
  angelNumberCategory,
  isAngelNumberLifeArea,
  isPersonal777Snapshot,
  personal777SupportiveCards,
  safeAngelNumberSnapshot,
} from '@/lib/angel-number';
import {
  BIG_THREE_FOCUSES,
  BIG_THREE_FUNNEL_VERSION,
  BIG_THREE_PAGE,
  isBigThreeFocus,
  safeBigThreeSnapshot,
} from '@/lib/big-three';
import {
  BIRTH_CHART_FUNNEL_VERSION,
  BIRTH_CHART_INTENTS,
  BIRTH_CHART_PAGE,
  isBirthChartIntent,
  safeBirthChartSnapshot,
} from '@/lib/birth-chart';
import {
  DAILY_TAROT_FOCUSES,
  DAILY_TAROT_FUNNEL_VERSION,
  DAILY_TAROT_PACKAGE_SCOPE,
  DAILY_TAROT_PAGE,
  dailyCardForDateKey,
  dailyDateIsCurrent,
  dailyTarotCards,
  isDailyTarotFocus,
} from '@/lib/daily-tarot';
import {
  DAILY_HOROSCOPE_FOCUSES,
  DAILY_HOROSCOPE_FUNNEL_VERSION,
  DAILY_HOROSCOPE_PAGE,
  buildDailyHoroscopeSnapshot,
  dailyHoroscopeDateIsCurrent,
  isDailyHoroscopeFocus,
} from '@/lib/daily-horoscope';
import {
  ZODIAC_COMPATIBILITY_FUNNEL_VERSION,
  ZODIAC_COMPATIBILITY_PAGE,
  isZodiacRelationshipFocus,
  isZodiacRelationshipStage,
  safeZodiacCompatibilitySnapshot,
} from '@/lib/zodiac-compatibility';
import {
  MOON_LUNAR_FUNNEL_VERSION,
  MOON_LUNAR_PAGE,
  buildMoonLunarSnapshot,
  isMoonLunarFocus,
} from '@/lib/moon-lunar';
import {
  NUMEROLOGY_COMPATIBILITY_FUNNEL_VERSION,
  NUMEROLOGY_COMPATIBILITY_PAGE,
  safeNumerologyCompatibilitySnapshot,
} from '@/lib/numerology-compatibility';
import {
  LOVE_TAROT_DIRECTIONS,
  LOVE_TAROT_FUNNEL_VERSION,
  LOVE_TAROT_FUNNEL_VERSION_I18N,
  LOVE_TAROT_INTENTS,
  LOVE_TAROT_PAGE,
  loveOracleCardBySlug,
  deckForCategory,
  isLoveRelationshipStatus,
  isLoveTarotIntent,
  isSupportedYesNoFunnelVersion,
  isYesNoCategory,
  loveTarotCardTitle,
  normalizeStorefrontTier,
  paidTierForStorefrontTier,
  productKeyForCategory,
  readingPackage,
  readingPackageByVariant,
  readingTypeForCategory,
  type LoveTarotIntent,
} from '@/lib/reading-products';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

const CHECKOUT_INTENT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DIRECT_TAROT_CHECKOUT_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const DIRECT_TAROT_DISPLAYED_QUOTE_INVALID = 'DIRECT_TAROT_DISPLAYED_QUOTE_INVALID';
const DIRECT_TAROT_QUOTE_CHANGED = 'DIRECT_TAROT_QUOTE_CHANGED';
const DIRECT_TAROT_TRANSPORT_FAILURES = new Set(['timeout', 'http_408', 'http_429', 'http_5xx']);

const allowedOrigins = new Set([
  'https://deckaura.com',
  'https://www.deckaura.com',
  'http://127.0.0.1:9292',
  'http://localhost:9292',
]);

function corsHeaders(origin: string) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  });
  if (allowedOrigins.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return headers;
}

function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

function sharedCheckoutRejection(
  status: 409 | 422 | 503,
  reason: string,
  origin: string,
  context: { page?: string; toolType?: string; tier?: string; variantId?: string; upstreamStatus?: number; upstreamCode?: string; publicCode?: string } = {},
) {
  // Catalog identifiers are public contract data. Questions, snapshots, reading
  // IDs, request headers and environment values are intentionally never logged.
  console.warn(JSON.stringify({
    event: 'shared_checkout_intent_rejected',
    status,
    reason,
    page: context.page || '',
    toolType: context.toolType || '',
    tier: context.tier || '',
    variantId: context.variantId || '',
    ...(context.upstreamStatus ? { upstreamStatus: context.upstreamStatus } : {}),
    ...(context.upstreamCode ? { upstreamCode: context.upstreamCode } : {}),
  }));
  const error = status === 409
    ? 'checkout_product_unavailable'
    : status === 503
      ? 'checkout_intent_unavailable'
      : 'invalid_checkout_intent';
  return json({ error, ...(context.publicCode ? { code: context.publicCode } : {}) }, status, origin);
}

function personalDirectQuoteChanged(
  origin: string,
  quote: { variantId: string; sku: string; price: number; priceCents: number; currency: string; country: string },
  tier: string,
) {
  // This event deliberately contains catalog/market data only. The customer's
  // question, context, cards, reading ID and snapshot are never logged.
  console.warn(JSON.stringify({
    event: 'personal_direct_quote_changed',
    status: 409,
    code: PERSONAL_DIRECT_PUBLIC_ERROR_CODES.quoteChanged,
    presentationVariant: PERSONAL_DIRECT_PRESENTATION_VARIANT,
    tier,
    variantId: quote.variantId,
    currency: quote.currency,
    country: quote.country,
  }));
  return json({
    error: 'checkout_price_changed',
    code: PERSONAL_DIRECT_PUBLIC_ERROR_CODES.quoteChanged,
    confirmationRequired: true,
    checkoutQuote: quote,
  }, 409, origin);
}

function directTarotQuoteChanged(
  origin: string,
  quote: { variantId: string; sku: string; price: number; priceCents: number; currency: string; country: string },
  page: string,
  presentationVariant: string,
  tier: string,
) {
  console.warn(JSON.stringify({
    event: 'direct_tarot_quote_changed',
    status: 409,
    code: DIRECT_TAROT_QUOTE_CHANGED,
    page,
    presentationVariant,
    tier,
    variantId: quote.variantId,
    currency: quote.currency,
    country: quote.country,
  }));
  return json({
    error: 'checkout_price_changed',
    code: DIRECT_TAROT_QUOTE_CHANGED,
    confirmationRequired: true,
    checkoutQuote: quote,
  }, 409, origin);
}

function clean(value: unknown, maximum: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

// Storefront reading sessions use both legacy hyphen-only identifiers and
// prefixed identifiers such as `r_<uuid>`. Keep this shared boundary explicit:
// removing `_` breaks checkout before a cart can be created.
const READING_ID_PATTERN = /^[a-z0-9_-]{8,80}$/i;

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeYesNoSnapshot(value: unknown) {
  const source = record(value);
  return {
    why: clean(source.why, 700),
    control: clean(source.control, 700),
    reflection: clean(source.reflection, 500),
  };
}

function safeLoveSnapshot(value: unknown, intent: LoveTarotIntent) {
  const source = record(value);
  const relationshipStatus = clean(source.relationshipStatus, 32).toLowerCase();
  const direction = clean(source.direction, 80);
  const synthesis = clean(source.synthesis, 1_400);
  const groundedStep = clean(source.groundedStep, 700);
  const unresolved = Array.isArray(source.unresolved)
    ? source.unresolved.slice(0, 3).map((entry) => clean(entry, 320)).filter(Boolean)
    : [];
  const positions = LOVE_TAROT_INTENTS[intent].positions;
  // Two canonical decks share this contract: the legacy numeric 26-card deck
  // (v1 funnel) and the shipped 93-card love oracle deck with slug ids
  // (v2-i18n funnel). Card names must match the deck's canonical title.
  const cards = Array.isArray(source.cards)
    ? source.cards.slice(0, 3).map((entry, index) => {
      const card = record(entry);
      const rawId = String(card.id ?? '').trim();
      const legacy = /^\d+$/.test(rawId);
      const oracle = legacy ? null : loveOracleCardBySlug(rawId);
      const legacyId = legacy ? Number.parseInt(rawId, 10) : Number.NaN;
      return {
        id: legacy ? legacyId : rawId.toLowerCase(),
        numericId: oracle ? oracle.numericId : legacyId,
        name: clean(card.name, 80),
        position: clean(card.position, 80),
        angle: clean(card.angle, 500),
        expectedName: oracle ? oracle.title : loveTarotCardTitle(legacyId),
        expectedPosition: positions[index],
      };
    })
    : [];
  const cardIds = cards.map((card) => String(card.id));
  const cardsValid = cards.length === 3
    && new Set(cardIds).size === 3
    && cards.every((card) => Number.isInteger(card.numericId)
      && card.expectedName === card.name
      && card.expectedPosition === card.position
      && card.angle.length >= 8);

  if (!isLoveRelationshipStatus(relationshipStatus)
    || !LOVE_TAROT_DIRECTIONS.includes(direction as typeof LOVE_TAROT_DIRECTIONS[number])
    || synthesis.length < 80
    || groundedStep.length < 24
    || !unresolved.length
    || !cardsValid) return null;

  return {
    intent,
    intentLabel: LOVE_TAROT_INTENTS[intent].label,
    relationshipStatus,
    direction,
    synthesis,
    groundedStep,
    unresolved,
    firstCardNumericId: cards[0].numericId,
    cards: cards.map(({ id, name, position, angle }) => ({ id, name, position, angle })),
  };
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin') || '';
  if (!allowedOrigins.has(origin)) return json({ error: 'origin_not_allowed' }, 403, origin);
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin') || '';
  if (!allowedOrigins.has(origin)) return json({ error: 'origin_not_allowed' }, 403, origin);
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 30_000) return json({ error: 'payload_too_large' }, 413, origin);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, 400, origin);
  }
  const localeContext = customerLocaleContext({
    locale: body.locale || body.language || body.lang,
    country: body.country,
    currency: body.currency,
    market: body.market,
  }, request.headers);
  let intentLocaleContext = localeContext;

  const requestedKind = clean(body.kind, 32).toLowerCase();
  const requestedPersonalDirect = requestedKind === 'shared_tool'
    && clean(body.page, 120) === PERSONAL_DIRECT_PAGE;
  const requestedDirectPage = requestedKind === 'shared_tool' ? clean(body.page, 120) : '';
  const requestedDirectTarot = [
    YES_NO_DIRECT_PAGE,
    LOVE_DIRECT_PAGE,
    CAREER_DIRECT_PAGE,
    BIRTH_CARD_DIRECT_PAGE,
  ].includes(requestedDirectPage);
  const requestedBirthCardDirect = requestedDirectPage === BIRTH_CARD_DIRECT_PAGE;
  const bigThree = requestedKind === 'big_three';
  const birthChart = requestedKind === 'birth_chart';
  const loveTarot = requestedKind === 'love_tarot';
  const dailyTarot = requestedKind === 'daily_tarot';
  const dailyHoroscope = requestedKind === 'daily_horoscope';
  const angelNumber = requestedKind === 'angel_number';
  const zodiacCompatibility = requestedKind === 'zodiac_compatibility';
  const moonLunar = requestedKind === 'moon_lunar';
  const numerologyCompatibility = requestedKind === 'numerology_compatibility';
  const storefrontTier = normalizeStorefrontTier(body.tier);
  const question = clean(body.question, requestedPersonalDirect ? 600 : requestedBirthCardDirect ? 360 : 400);
  const readingId = clean(body.readingId, 80);
  const funnelVersion = clean(body.funnelVersion, 128);
  if (!storefrontTier
    || (!requestedBirthCardDirect && question.length < 6)
    || !READING_ID_PATTERN.test(readingId)) {
    if (requestedPersonalDirect) {
      const publicCode = !storefrontTier
        ? PERSONAL_DIRECT_PUBLIC_ERROR_CODES.tierUnsupported
        : question.length < 6
          ? PERSONAL_DIRECT_PUBLIC_ERROR_CODES.questionInvalid
          : PERSONAL_DIRECT_PUBLIC_ERROR_CODES.requestInvalid;
      return sharedCheckoutRejection(422, publicCode, origin, {
        page: PERSONAL_DIRECT_PAGE,
        toolType: PERSONAL_DIRECT_TYPE,
        tier: clean(body.tier, 20),
        variantId: clean(body.expectedVariantId, 24),
        publicCode,
      });
    }
    if (requestedDirectTarot) {
      return sharedCheckoutRejection(422, 'DIRECT_TAROT_REQUEST_INVALID', origin, {
        page: requestedDirectPage,
        toolType: clean(body.toolType, 80),
        tier: clean(body.tier, 20),
        variantId: clean(body.expectedVariantId, 24),
        publicCode: 'DIRECT_TAROT_REQUEST_INVALID',
      });
    }
    return json({ error: 'invalid_checkout_intent' }, 422, origin);
  }
  const tier = paidTierForStorefrontTier(storefrontTier);
  const secret = clean(
    process.env.ENTITLEMENT_PEPPER
      || process.env.FREE_ENTITLEMENT_SALT
      || process.env.SHOPIFY_WEBHOOK_SECRET,
    512,
  );
  if (!secret) return json({ error: 'checkout_intent_unavailable' }, 503, origin);
  const id = randomUUID();

  let page: string;
  let readingType: string;
  let category: 'love' | 'career' | 'money' | 'personal' | 'general';
  let deck: 'love_oracle' | 'classic_tarot' | 'natal_chart' | 'natal_transits' | 'big_three' | 'angel_number' | 'lunar_transits' | 'numerology';
  let answer: string;
  let cardName: string;
  let cardId: number;
  let intentKind: 'big_three' | 'birth_chart' | 'love_tarot' | 'daily_tarot' | 'daily_horoscope' | 'angel_number' | 'zodiac_compatibility' | 'moon_lunar' | 'numerology_compatibility' | 'shared_tool' | null = null;
  let sharedProduct: { variantId: string; sku: string; price: number } | null = null;
  let sharedCheckoutQuote: {
    intentId: string;
    variantId: string;
    sku: string;
    priceCents: number;
    currency: string;
    country: string;
  } | null = null;
  let snapshot: Record<string, unknown>;

  if (numerologyCompatibility) {
    if (funnelVersion !== NUMEROLOGY_COMPATIBILITY_FUNNEL_VERSION) {
      return json({ error: 'invalid_numerology_compatibility_intent' }, 422, origin);
    }
    const numerologySnapshot = safeNumerologyCompatibilitySnapshot(body.snapshot, tier);
    if (!numerologySnapshot || numerologySnapshot.question !== question) {
      return json({ error: 'invalid_numerology_compatibility_snapshot' }, 422, origin);
    }
    page = NUMEROLOGY_COMPATIBILITY_PAGE;
    readingType = 'Numerology Compatibility';
    category = 'general';
    deck = 'numerology';
    answer = 'CONDITIONAL';
    cardName = 'Numerology compatibility';
    cardId = 0;
    intentKind = 'numerology_compatibility';
    snapshot = numerologySnapshot;
  } else if (moonLunar) {
    const focus = clean(body.focus, 40).toLowerCase();
    if (funnelVersion !== MOON_LUNAR_FUNNEL_VERSION
      || !isMoonLunarFocus(focus)
      || question.length < 12) {
      return json({ error: 'invalid_moon_lunar_intent' }, 422, origin);
    }
    const lunarSnapshot = buildMoonLunarSnapshot({
      value: body.snapshot,
      focus,
      question,
      tier,
    });
    if (!lunarSnapshot) return json({ error: 'invalid_moon_lunar_snapshot' }, 422, origin);
    page = MOON_LUNAR_PAGE;
    readingType = 'Moon & Lunar Reading';
    category = lunarSnapshot.category;
    deck = 'lunar_transits';
    answer = 'CONDITIONAL';
    cardName = lunarSnapshot.card.name;
    cardId = lunarSnapshot.card.id;
    intentKind = 'moon_lunar';
    snapshot = lunarSnapshot;
  } else if (zodiacCompatibility) {
    const relationshipStage = clean(body.relationshipStage, 40).toLowerCase();
    const focus = clean(body.focus, 40).toLowerCase();
    if (funnelVersion !== ZODIAC_COMPATIBILITY_FUNNEL_VERSION
      || !isZodiacRelationshipStage(relationshipStage)
      || !isZodiacRelationshipFocus(focus)) {
      return json({ error: 'invalid_zodiac_compatibility_intent' }, 422, origin);
    }
    const compatibilitySnapshot = safeZodiacCompatibilitySnapshot(body.snapshot);
    if (!compatibilitySnapshot
      || compatibilitySnapshot.relationshipStage !== relationshipStage
      || compatibilitySnapshot.focus !== focus
      || compatibilitySnapshot.question !== question) {
      return json({ error: 'invalid_zodiac_compatibility_snapshot' }, 422, origin);
    }
    page = ZODIAC_COMPATIBILITY_PAGE;
    readingType = 'Zodiac Compatibility';
    category = 'love';
    deck = 'natal_chart';
    answer = 'CONDITIONAL';
    cardName = 'Sun-sign compatibility';
    cardId = 0;
    intentKind = 'zodiac_compatibility';
    snapshot = compatibilitySnapshot;
  } else if (angelNumber) {
    const lifeArea = clean(body.intent, 40).toLowerCase();
    if ((funnelVersion !== ANGEL_NUMBER_FUNNEL_VERSION && funnelVersion !== PERSONAL_777_FUNNEL_VERSION)
      || !isAngelNumberLifeArea(lifeArea)) {
      return json({ error: 'invalid_angel_number_intent' }, 422, origin);
    }
    const angelSnapshot = safeAngelNumberSnapshot(body.snapshot);
    if (!angelSnapshot || angelSnapshot.lifeArea !== lifeArea) {
      return json({ error: 'invalid_angel_number_snapshot' }, 422, origin);
    }
    const personal777 = isPersonal777Snapshot(angelSnapshot);
    if ((funnelVersion === PERSONAL_777_FUNNEL_VERSION) !== personal777
      || (personal777 && (tier === 'standard' || angelSnapshot.userContext !== question))) {
      return json({ error: 'invalid_personal_777_intent' }, 422, origin);
    }
    if (tier === 'premium' && !personal777 && !angelSnapshot.additionalNumbers.length && !angelSnapshot.birthDate) {
      return json({ error: 'angel_number_pattern_input_required' }, 422, origin);
    }
    const supportiveCards = personal777 && tier === 'premium'
      ? personal777SupportiveCards({ intentId: id, readingId, question, secret })
      : [];
    if (personal777 && tier === 'premium' && !supportiveCards) {
      return json({ error: 'personal_777_cards_unavailable' }, 503, origin);
    }
    page = ANGEL_NUMBER_PAGE;
    readingType = personal777 ? 'Personal 777' : 'Angel Number';
    category = angelNumberCategory(lifeArea);
    deck = 'angel_number';
    answer = 'CONDITIONAL';
    cardName = `Angel number ${angelSnapshot.number}`;
    cardId = 0;
    intentKind = 'angel_number';
    snapshot = { ...angelSnapshot, supportiveCards };
  } else if (bigThree) {
    const focus = clean(body.intent, 40).toLowerCase();
    if (funnelVersion !== BIG_THREE_FUNNEL_VERSION || !isBigThreeFocus(focus)) {
      return json({ error: 'invalid_big_three_intent' }, 422, origin);
    }
    const bigThreeSnapshot = safeBigThreeSnapshot(body.snapshot);
    if (!bigThreeSnapshot || bigThreeSnapshot.focus !== focus) {
      return json({ error: 'invalid_big_three_snapshot' }, 422, origin);
    }
    page = BIG_THREE_PAGE;
    readingType = 'Sun Moon Rising (Big 3)';
    category = BIG_THREE_FOCUSES[focus].category;
    deck = 'big_three';
    answer = 'CONDITIONAL';
    cardName = 'Big Three';
    cardId = 0;
    intentKind = 'big_three';
    snapshot = bigThreeSnapshot;
  } else if (birthChart) {
    const focus = clean(body.intent, 40).toLowerCase();
    if (funnelVersion !== BIRTH_CHART_FUNNEL_VERSION || !isBirthChartIntent(focus)) {
      return json({ error: 'invalid_birth_chart_intent' }, 422, origin);
    }
    const chartSnapshot = safeBirthChartSnapshot(body.snapshot);
    if (!chartSnapshot || chartSnapshot.focus !== focus) {
      return json({ error: 'invalid_birth_chart_snapshot' }, 422, origin);
    }
    page = BIRTH_CHART_PAGE;
    readingType = 'Astrology Birth Chart';
    category = BIRTH_CHART_INTENTS[focus].category;
    deck = 'natal_chart';
    answer = 'CONDITIONAL';
    cardName = 'Natal chart';
    cardId = 0;
    intentKind = 'birth_chart';
    snapshot = chartSnapshot;
  } else if (loveTarot) {
    const intentValue = clean(body.intent, 40).toLowerCase();
    if (!isLoveTarotIntent(intentValue)
      || ![LOVE_TAROT_FUNNEL_VERSION, LOVE_TAROT_FUNNEL_VERSION_I18N].includes(funnelVersion)) {
      return json({ error: 'invalid_checkout_intent' }, 422, origin);
    }
    const loveSnapshot = safeLoveSnapshot(body.snapshot, intentValue);
    if (!loveSnapshot) return json({ error: 'invalid_love_snapshot' }, 422, origin);
    const { firstCardNumericId, ...persistedLoveSnapshot } = loveSnapshot;
    page = LOVE_TAROT_PAGE;
    readingType = 'Love Tarot';
    category = 'love';
    deck = 'love_oracle';
    answer = 'CONDITIONAL';
    cardName = loveSnapshot.cards[0].name;
    cardId = firstCardNumericId;
    intentKind = 'love_tarot';
    snapshot = persistedLoveSnapshot;
  } else if (dailyHoroscope) {
    const focus = clean(body.focus, 24).toLowerCase();
    const forecastDate = clean(body.dateKey, 16);
    const sign = clean(record(body.snapshot).sign, 20);
    if (funnelVersion !== DAILY_HOROSCOPE_FUNNEL_VERSION
      || !isDailyHoroscopeFocus(focus)
      || !dailyHoroscopeDateIsCurrent(forecastDate)) {
      return json({ error: 'invalid_daily_horoscope_intent' }, 422, origin);
    }
    const transitSnapshot = buildDailyHoroscopeSnapshot({
      snapshot: body.snapshot,
      focus,
      forecastDate,
      tier,
    });
    if (!transitSnapshot) return json({ error: 'invalid_daily_horoscope_snapshot' }, 422, origin);
    page = DAILY_HOROSCOPE_PAGE;
    readingType = 'Personal Horoscope';
    category = DAILY_HOROSCOPE_FOCUSES[focus].category;
    deck = 'natal_transits';
    answer = 'CONDITIONAL';
    cardName = `${sign} natal transits`;
    cardId = 0;
    intentKind = 'daily_horoscope';
    snapshot = transitSnapshot;
  } else if (dailyTarot) {
    const focus = clean(body.focus, 40).toLowerCase();
    const dateKey = clean(body.dateKey, 16);
    const orientation = clean(body.orientation, 16);
    const submittedCardName = clean(body.cardName, 80);
    const submittedCardId = Number.parseInt(String(body.cardId || ''), 10);
    const sharedCard = dailyCardForDateKey(dateKey);
    if (funnelVersion !== DAILY_TAROT_FUNNEL_VERSION
      || !isDailyTarotFocus(focus)
      || !dailyDateIsCurrent(dateKey)
      || question.length < 12
      || !sharedCard
      || sharedCard.id !== submittedCardId
      || sharedCard.name !== submittedCardName
      || sharedCard.orientation !== orientation) {
      return json({ error: 'invalid_daily_tarot_intent' }, 422, origin);
    }
    const cards = dailyTarotCards({
      dateKey,
      tier,
      readingId,
      intentId: id,
      situation: question,
      secret,
    });
    if (!cards) return json({ error: 'daily_tarot_cards_unavailable' }, 503, origin);
    page = DAILY_TAROT_PAGE;
    readingType = 'Daily Tarot';
    category = DAILY_TAROT_FOCUSES[focus].category;
    deck = 'classic_tarot';
    answer = 'CONDITIONAL';
    cardName = sharedCard.name;
    cardId = sharedCard.id;
    intentKind = 'daily_tarot';
    snapshot = {
      focus,
      focusLabel: DAILY_TAROT_FOCUSES[focus].label,
      situation: question,
      dateKey,
      packageTitle: DAILY_TAROT_PACKAGE_SCOPE[tier].title,
      days: DAILY_TAROT_PACKAGE_SCOPE[tier].days,
      cards,
    };
  } else if (requestedKind === 'shared_tool') {
    const pageValue = clean(body.page, 120);
    const toolType = clean(body.toolType, 80);
    const expectedVariantValue = clean(body.expectedVariantId, 24);
    const submittedSharedSnapshot = record(body.snapshot);
    const submittedPresentationVariant = clean(submittedSharedSnapshot.presentationVariant, 80);
    const exactDirectTarotPage = [
      YES_NO_DIRECT_PAGE,
      LOVE_DIRECT_PAGE,
      CAREER_DIRECT_PAGE,
      BIRTH_CARD_DIRECT_PAGE,
    ].includes(pageValue);
    const directTarotClaimed = exactDirectTarotPage
      || /^(?:yes-no-direct|love-three-card-compact|career-three-card-compact|birth-card-direct)-/i.test(submittedPresentationVariant);
    const personalDirectClaimed = pageValue === PERSONAL_DIRECT_PAGE
      || /^personal-direct-/i.test(submittedPresentationVariant);
    if (personalDirectClaimed && pageValue !== PERSONAL_DIRECT_PAGE) {
      return sharedCheckoutRejection(422, PERSONAL_DIRECT_PUBLIC_ERROR_CODES.canonicalPageInvalid, origin, {
        page: pageValue,
        toolType,
        tier: storefrontTier,
        variantId: expectedVariantValue,
        publicCode: PERSONAL_DIRECT_PUBLIC_ERROR_CODES.canonicalPageInvalid,
      });
    }
    if (directTarotClaimed && !exactDirectTarotPage) {
      return sharedCheckoutRejection(422, 'DIRECT_TAROT_CANONICAL_PAGE_INVALID', origin, {
        page: pageValue,
        toolType,
        tier: storefrontTier,
        variantId: expectedVariantValue,
        publicCode: 'DIRECT_TAROT_CANONICAL_PAGE_INVALID',
      });
    }
    if (funnelVersion !== SHARED_TOOL_FUNNEL_VERSION
      || !/^\/pages\/[a-z0-9-]{3,80}$/.test(pageValue)
      || !toolType
      || !/^[0-9]{8,20}$/.test(expectedVariantValue)) {
      return sharedCheckoutRejection(422, 'SHARED_REQUEST_CONTRACT_INVALID', origin, {
        page: pageValue,
        toolType,
        tier: storefrontTier,
        variantId: expectedVariantValue,
        ...(personalDirectClaimed ? { publicCode: PERSONAL_DIRECT_PUBLIC_ERROR_CODES.requestInvalid } : {}),
      });
    }
    const contract = sharedToolVariantContract(pageValue, toolType, storefrontTier, expectedVariantValue);
    if (!contract) {
      const reason = personalDirectClaimed
        ? PERSONAL_DIRECT_PUBLIC_ERROR_CODES.productContractMismatch
        : 'SHARED_PAGE_TYPE_TIER_VARIANT_MISMATCH';
      return sharedCheckoutRejection(422, reason, origin, {
        page: pageValue,
        toolType,
        tier: storefrontTier,
        variantId: expectedVariantValue,
        ...(personalDirectClaimed ? { publicCode: reason } : {}),
      });
    }
    let sharedSnapshot = submittedSharedSnapshot;
    if (pageValue === SEVEN_CARD_HORSESHOE_PAGE) {
      const questionPolicy = sevenCardHorseshoeCheckoutQuestionPolicy(question);
      if (!questionPolicy.ok) {
        return sharedCheckoutRejection(422, questionPolicy.safetyCategory
          ? 'SHARED_SEVEN_CARD_SAFETY_BLOCKED'
          : 'SHARED_SEVEN_CARD_QUESTION_INVALID', origin, {
          page: pageValue,
          toolType,
          tier: storefrontTier,
          variantId: expectedVariantValue,
        });
      }
      const transportFallback = body.transportFallback === true || submittedSharedSnapshot.transportFallback === true;
      const previewToken = clean(body.freeToken || body.previewToken || submittedSharedSnapshot.freeToken, 64).toLowerCase();
      if (!transportFallback && !/^[a-f0-9]{32}$/.test(previewToken)) {
        return sharedCheckoutRejection(422, 'SHARED_SEVEN_CARD_PREVIEW_TOKEN_INVALID', origin, {
          page: pageValue,
          toolType,
          tier: storefrontTier,
          variantId: expectedVariantValue,
        });
      }
      if (!transportFallback) {
        const visitorAuthority = await sevenCardHorseshoeVisitorAuthority(
          clean(body.visitorId, 96),
          process.env.ENTITLEMENT_PEPPER
            || process.env.FREE_ENTITLEMENT_SALT
            || process.env.SHOPIFY_WEBHOOK_SECRET,
        );
        if (!visitorAuthority.ok) {
          return sharedCheckoutRejection(422, 'SHARED_SEVEN_CARD_VISITOR_AUTHORITY_INVALID', origin, {
            page: pageValue,
            toolType,
            tier: storefrontTier,
            variantId: expectedVariantValue,
          });
        }
        let visitorPreview: unknown;
        let currentVisitorSession: unknown;
        try {
          const cache = workerEnvironment().READINGS_CACHE;
          [visitorPreview, currentVisitorSession] = await Promise.all([
            cache.get(`preview:${previewToken}`, 'json'),
            cache.get(visitorAuthority.sessionKey, 'json'),
          ]);
        } catch {
          return sharedCheckoutRejection(503, 'SHARED_SEVEN_CARD_PREVIEW_LOOKUP_FAILED', origin, {
            page: pageValue,
            toolType,
            tier: storefrontTier,
            variantId: expectedVariantValue,
          });
        }
        const authority = sevenCardHorseshoeCheckoutSnapshotFromPreview(visitorPreview);
        const currentSession = record(currentVisitorSession);
        const currentSessionFields = record(currentSession.fields);
        const currentSessionExpiresAt = Number(currentSession.expiresAt);
        if (!authority.ok
          || !authority.snapshot
          || clean(record(visitorPreview).ownerVisitorHash, 96) !== visitorAuthority.visitorName
          || clean(currentSession.token, 64).toLowerCase() !== previewToken
          || currentSession.approvalStatus !== 'approved'
          || currentSession.offerBlocked === true
          || currentSession.safety === true
          || !Number.isFinite(currentSessionExpiresAt)
          || currentSessionExpiresAt <= Date.now()
          || clean(currentSessionFields.presentationVariant, 80) !== clean(authority.snapshot.presentationVariant, 80)
          || clean(currentSessionFields.readingId, 80) !== clean(authority.snapshot.readingId, 80)) {
          return sharedCheckoutRejection(422, 'SHARED_SEVEN_CARD_PREVIEW_EXPIRED_OR_INVALID', origin, {
            page: pageValue,
            toolType,
            tier: storefrontTier,
            variantId: expectedVariantValue,
          });
        }
        sharedSnapshot = authority.snapshot;
      }
      sharedSnapshot = { ...sharedSnapshot, transportFallback };
    }
    if (exactDirectTarotPage) {
      const rawDirectQuestion = clean(body.question, 10_000);
      const rawDirectContext = clean(submittedSharedSnapshot.context, 10_000);
      const directQuestionLimit = pageValue === YES_NO_DIRECT_PAGE
        ? 240
        : pageValue === BIRTH_CARD_DIRECT_PAGE
          ? 360
          : 400;
      if (rawDirectQuestion.length > directQuestionLimit
        || rawDirectContext.length > (pageValue === LOVE_DIRECT_PAGE || pageValue === CAREER_DIRECT_PAGE ? 500 : 0)) {
        return sharedCheckoutRejection(422, 'DIRECT_TAROT_QUESTION_INVALID', origin, {
          page: pageValue,
          toolType,
          tier: storefrontTier,
          variantId: expectedVariantValue,
          publicCode: 'DIRECT_TAROT_QUESTION_INVALID',
        });
      }
      const directPolicy = directTarotQuestionPolicy(pageValue, question, rawDirectContext);
      if (!directPolicy.ok) {
        const publicCode = directPolicy.safetyCategory
          ? 'DIRECT_TAROT_SAFETY_BLOCKED'
          : 'DIRECT_TAROT_QUESTION_INVALID';
        return sharedCheckoutRejection(422, publicCode, origin, {
          page: pageValue,
          toolType,
          tier: storefrontTier,
          variantId: expectedVariantValue,
          publicCode,
        });
      }
      if (pageValue === BIRTH_CARD_DIRECT_PAGE) {
        if (body.transportFallback === true
          || submittedSharedSnapshot.transportFallback === true
          || clean(body.transportFailure || submittedSharedSnapshot.transportFailure, 24)
          || clean(body.freeToken || body.previewToken || submittedSharedSnapshot.freeToken, 64)) {
          return sharedCheckoutRejection(422, 'DIRECT_TAROT_PREVIEW_NOT_ALLOWED', origin, {
            page: pageValue,
            toolType,
            tier: storefrontTier,
            variantId: expectedVariantValue,
            publicCode: 'DIRECT_TAROT_PREVIEW_NOT_ALLOWED',
          });
        }
        const canonicalBirthSnapshot = canonicalizeDirectTarotSnapshot(submittedSharedSnapshot);
        if (!canonicalBirthSnapshot) {
          return sharedCheckoutRejection(422, 'DIRECT_TAROT_EVIDENCE_MISMATCH', origin, {
            page: pageValue,
            toolType,
            tier: storefrontTier,
            variantId: expectedVariantValue,
            publicCode: 'DIRECT_TAROT_EVIDENCE_MISMATCH',
          });
        }
        sharedSnapshot = canonicalBirthSnapshot;
      } else {
        const transportFallback = body.transportFallback === true || submittedSharedSnapshot.transportFallback === true;
        if (transportFallback) {
          const transportFailure = clean(body.transportFailure || submittedSharedSnapshot.transportFailure, 24).toLowerCase();
          if (!DIRECT_TAROT_TRANSPORT_FAILURES.has(transportFailure)) {
            return sharedCheckoutRejection(422, 'DIRECT_TAROT_TRANSPORT_FALLBACK_INVALID', origin, {
              page: pageValue,
              toolType,
              tier: storefrontTier,
              variantId: expectedVariantValue,
              publicCode: 'DIRECT_TAROT_TRANSPORT_FALLBACK_INVALID',
            });
          }
          const canonicalFallbackSnapshot = canonicalizeDirectTarotSnapshot(submittedSharedSnapshot);
          if (!canonicalFallbackSnapshot) {
            return sharedCheckoutRejection(422, 'DIRECT_TAROT_EVIDENCE_MISMATCH', origin, {
              page: pageValue,
              toolType,
              tier: storefrontTier,
              variantId: expectedVariantValue,
              publicCode: 'DIRECT_TAROT_EVIDENCE_MISMATCH',
            });
          }
          sharedSnapshot = { ...canonicalFallbackSnapshot, transportFallback: true, transportFailure };
        }
        const previewToken = clean(body.freeToken || body.previewToken || submittedSharedSnapshot.freeToken, 64).toLowerCase();
        if (!transportFallback && !/^[a-f0-9]{32}$/.test(previewToken)) {
          return sharedCheckoutRejection(422, 'DIRECT_TAROT_PREVIEW_TOKEN_INVALID', origin, {
            page: pageValue,
            toolType,
            tier: storefrontTier,
            variantId: expectedVariantValue,
            publicCode: 'DIRECT_TAROT_PREVIEW_TOKEN_INVALID',
          });
        }
        if (!transportFallback) {
          const visitorAuthority = await sevenCardHorseshoeVisitorAuthority(
            clean(body.visitorId, 96),
            process.env.ENTITLEMENT_PEPPER
              || process.env.FREE_ENTITLEMENT_SALT
              || process.env.SHOPIFY_WEBHOOK_SECRET,
          );
          if (!visitorAuthority.ok) {
            return sharedCheckoutRejection(422, 'DIRECT_TAROT_VISITOR_AUTHORITY_INVALID', origin, {
              page: pageValue,
              toolType,
              tier: storefrontTier,
              variantId: expectedVariantValue,
              publicCode: 'DIRECT_TAROT_VISITOR_AUTHORITY_INVALID',
            });
          }
          let visitorPreview: unknown;
          let currentVisitorSession: unknown;
          try {
            const cache = workerEnvironment().READINGS_CACHE;
            [visitorPreview, currentVisitorSession] = await Promise.all([
              cache.get(`preview:${previewToken}`, 'json'),
              cache.get(visitorAuthority.sessionKey, 'json'),
            ]);
          } catch {
            return sharedCheckoutRejection(503, 'DIRECT_TAROT_PREVIEW_LOOKUP_FAILED', origin, {
              page: pageValue,
              toolType,
              tier: storefrontTier,
              variantId: expectedVariantValue,
              publicCode: 'DIRECT_TAROT_PREVIEW_LOOKUP_FAILED',
            });
          }
          const authority = directTarotCheckoutSnapshotFromPreview(visitorPreview);
          const currentSession = record(currentVisitorSession);
          const currentSessionFields = record(currentSession.fields);
          const currentSessionExpiresAt = Number(currentSession.expiresAt);
          const authorityLocale = record(authority.localeContext);
          const authorityLocaleValue = clean(authorityLocale.locale, 24);
          const authorityCountry = clean(authorityLocale.country, 2).toUpperCase();
          const authorityCurrency = clean(authorityLocale.currency, 3).toUpperCase();
          const authorityMarket = clean(authorityLocale.market, 64).toLowerCase();
          const submittedLocale = clean(body.locale || body.language || body.lang, 24);
          const submittedCountry = clean(body.country, 2).toUpperCase();
          const submittedCurrency = clean(body.currency, 3).toUpperCase();
          const submittedMarket = clean(body.market, 64).toLowerCase();
          if (!authority.ok
            || !authority.snapshot
            || clean(record(visitorPreview).ownerVisitorHash, 96) !== visitorAuthority.visitorName
            || clean(currentSession.token, 64).toLowerCase() !== previewToken
            || currentSession.approvalStatus !== 'approved'
            || currentSession.offerBlocked === true
            || currentSession.safety === true
            || !Number.isFinite(currentSessionExpiresAt)
            || currentSessionExpiresAt <= Date.now()
            || clean(currentSessionFields.presentationVariant, 80) !== clean(authority.snapshot.presentationVariant, 80)
            || clean(currentSessionFields.readingId, 80) !== clean(authority.snapshot.readingId, 80)
            || clean(authority.snapshot.presentationVariant, 80) !== submittedPresentationVariant
            || clean(authority.snapshot.readingId, 80) !== readingId
            || !authorityLocaleValue
            || !/^[A-Z]{2}$/.test(authorityCountry)
            || !/^[A-Z]{3}$/.test(authorityCurrency)
            || (submittedLocale && customerLocaleContext({ locale: submittedLocale }).locale !== customerLocaleContext({ locale: authorityLocaleValue }).locale)
            || (submittedCountry && submittedCountry !== authorityCountry)
            || (submittedCurrency && submittedCurrency !== authorityCurrency)
            || (submittedMarket && submittedMarket !== authorityMarket)) {
            return sharedCheckoutRejection(422, 'DIRECT_TAROT_PREVIEW_EXPIRED_OR_INVALID', origin, {
              page: pageValue,
              toolType,
              tier: storefrontTier,
              variantId: expectedVariantValue,
              publicCode: 'DIRECT_TAROT_PREVIEW_EXPIRED_OR_INVALID',
            });
          }
          sharedSnapshot = authority.snapshot;
          intentLocaleContext = customerLocaleContext({
            locale: authorityLocaleValue,
            country: authorityCountry,
            currency: authorityCurrency,
            market: authorityMarket,
          }, request.headers);
        }
      }
    }
    const exactPersonalDirectPage = pageValue === PERSONAL_DIRECT_PAGE;
    const personalDirectValidation = validatePersonalDirectSnapshot({
      page: pageValue,
      toolType,
      presentationVariant: submittedPresentationVariant,
      snapshot: sharedSnapshot,
    });
    if (exactPersonalDirectPage) {
      const personalPolicy = personalDirectQuestionPolicy(question, clean(sharedSnapshot.context, 1_500));
      if (!personalPolicy.ok) {
        const publicCode = personalPolicy.safetyCategory
          ? PERSONAL_DIRECT_PUBLIC_ERROR_CODES.safetyBlocked
          : PERSONAL_DIRECT_PUBLIC_ERROR_CODES.questionInvalid;
        return sharedCheckoutRejection(422, publicCode, origin, {
          page: pageValue,
          toolType,
          tier: storefrontTier,
          variantId: expectedVariantValue,
          publicCode,
        });
      }
      if (!personalDirectValidation.applies || !personalDirectValidation.ok) {
        return sharedCheckoutRejection(422, PERSONAL_DIRECT_PUBLIC_ERROR_CODES.evidenceMismatch, origin, {
          page: pageValue,
          toolType,
          tier: storefrontTier,
          variantId: expectedVariantValue,
          publicCode: PERSONAL_DIRECT_PUBLIC_ERROR_CODES.evidenceMismatch,
        });
      }
    } else if (personalDirectValidation.applies && !personalDirectValidation.ok) {
      return sharedCheckoutRejection(422, PERSONAL_DIRECT_PUBLIC_ERROR_CODES.evidenceMismatch, origin, {
        page: pageValue,
        toolType,
        tier: storefrontTier,
        variantId: expectedVariantValue,
        publicCode: PERSONAL_DIRECT_PUBLIC_ERROR_CODES.evidenceMismatch,
      });
    }
    const directTarotValidation = validateDirectTarotToolSnapshot({
      page: pageValue,
      toolType,
      presentationVariant: clean(sharedSnapshot.presentationVariant, 80),
      snapshot: sharedSnapshot,
    });
    if ((exactDirectTarotPage && (!directTarotValidation.applies || !directTarotValidation.ok))
      || (directTarotValidation.applies && !directTarotValidation.ok)) {
      return sharedCheckoutRejection(422, 'DIRECT_TAROT_EVIDENCE_MISMATCH', origin, {
        page: pageValue,
        toolType,
        tier: storefrontTier,
        variantId: expectedVariantValue,
        publicCode: 'DIRECT_TAROT_EVIDENCE_MISMATCH',
      });
    }
    const snapshotVersion = clean(sharedSnapshot.version, 40);
    const snapshotType = clean(sharedSnapshot.type, 80);
    const snapshotQuestion = clean(sharedSnapshot.question, exactPersonalDirectPage ? 600 : pageValue === BIRTH_CARD_DIRECT_PAGE ? 360 : 400);
    const snapshotContext = clean(sharedSnapshot.context, 4000);
    const snapshotSignals = clean(sharedSnapshot.signals, 1500);
    const snapshotCards = clean(sharedSnapshot.cards, 1500);
    const snapshotSpread = clean(sharedSnapshot.spread, 500);
    const snapshotScope = clean(sharedSnapshot.scope, 500);
    const snapshotConfidence = clean(sharedSnapshot.confidence, 200);
    const snapshotFocus = clean(sharedSnapshot.focus, 160);
    const snapshotTool = clean(sharedSnapshot.tool, 120);
    const snapshotPresentationVariant = clean(sharedSnapshot.presentationVariant, 80);
    const snapshotCuriosityQuestion = clean(sharedSnapshot.curiosityQuestion, 400);
    const sevenCardValidation = validateSevenCardHorseshoeCompactSnapshot({
      page: pageValue,
      toolType,
      presentationVariant: snapshotPresentationVariant,
      snapshot: {
        ...sharedSnapshot,
        type: snapshotType,
        signals: snapshotSignals,
        cards: snapshotCards,
        spread: snapshotSpread,
        scope: snapshotScope,
        confidence: snapshotConfidence,
        tool: snapshotTool,
        presentationVariant: snapshotPresentationVariant,
      },
    });
    const exactSevenCardPage = pageValue === SEVEN_CARD_HORSESHOE_PAGE;
    if ((exactSevenCardPage && (!sevenCardValidation.applies || !sevenCardValidation.ok))
      || (sevenCardValidation.applies && !sevenCardValidation.ok)) {
      return sharedCheckoutRejection(422, 'SHARED_SEVEN_CARD_EVIDENCE_MISMATCH', origin, {
        page: pageValue,
        toolType,
        tier: storefrontTier,
        variantId: expectedVariantValue,
      });
    }
    if (snapshotVersion !== 'reading-snapshot-v2'
      || snapshotType !== toolType
      || snapshotQuestion !== question
      || clean(sharedSnapshot.readingId, 80) !== readingId
      || (exactSevenCardPage && question.length < 8)
      || (!snapshotSignals && !snapshotCards)
      || !snapshotScope
      || !snapshotConfidence
      || !snapshotTool
      || (!snapshotCuriosityQuestion
        && !(sevenCardValidation.applies && sevenCardValidation.ok)
        && !(personalDirectValidation.applies && personalDirectValidation.ok)
        && !(directTarotValidation.applies && directTarotValidation.ok))) {
      return sharedCheckoutRejection(422, 'SHARED_SNAPSHOT_CONTRACT_MISMATCH', origin, {
        page: pageValue,
        toolType,
        tier: storefrontTier,
        variantId: expectedVariantValue,
      });
    }
    const typedEvidence = validateNewSharedToolSnapshot({
      page: pageValue,
      toolType,
      snapshot: {
        type: snapshotType,
        context: snapshotContext,
        signals: snapshotSignals,
        scope: snapshotScope,
        confidence: snapshotConfidence,
      },
    });
    if (typedEvidence.applies && !typedEvidence.ok) {
      return sharedCheckoutRejection(422, 'SHARED_TYPED_EVIDENCE_MISMATCH', origin, {
        page: pageValue,
        toolType,
        tier: storefrontTier,
        variantId: expectedVariantValue,
      });
    }
    const byVariant = readingPackageByVariant(expectedVariantValue);
    if (byVariant) {
      if (byVariant.storefrontTier !== storefrontTier
        || byVariant.sku !== contract.sku
        || !Number.isFinite(byVariant.price)
        || byVariant.price <= 0) {
        return sharedCheckoutRejection(422, 'SHARED_STATIC_PRODUCT_CONTRACT_MISMATCH', origin, {
          page: pageValue,
          toolType,
          tier: storefrontTier,
          variantId: expectedVariantValue,
        });
      }
      sharedProduct = { variantId: byVariant.variantId, sku: byVariant.sku, price: byVariant.price };
    } else {
      const lookup = await verifyShopifyReadingVariant({
        variantId: expectedVariantValue,
        expectedSku: contract.sku,
        expectedPrice: contract.price,
        env: process.env,
      });
      if (!('product' in lookup) || !lookup.product) {
        const failure = lookup as {
          status: 409 | 422 | 503;
          reason: string;
          upstreamStatus: number;
          upstreamCode?: string;
        };
        return sharedCheckoutRejection(failure.status, failure.reason, origin, {
          page: pageValue,
          toolType,
          tier: storefrontTier,
          variantId: expectedVariantValue,
          upstreamStatus: failure.upstreamStatus,
          upstreamCode: failure.upstreamCode || '',
        });
      }
      sharedProduct = lookup.product;
    }
    if (!sharedProduct) {
      return sharedCheckoutRejection(503, 'SHOPIFY_VARIANT_LOOKUP_RESULT_INVALID', origin, {
        page: pageValue,
        toolType,
        tier: storefrontTier,
        variantId: expectedVariantValue,
      });
    }
    // Storefront rails that render a live Shopify quote (rune, human-design style
    // funnels, future shared tools) send the quote they displayed. They require a
    // signed checkoutQuote in the response, so run the same verified-quote path as
    // the direct tarot pages instead of silently omitting the quote.
    const signedQuoteRequested = !exactSevenCardPage && !exactPersonalDirectPage && !directTarotValidation.applies
      && clean(record(body.displayedQuote).variantId, 24).length > 0;
    if (exactSevenCardPage || exactPersonalDirectPage || directTarotValidation.applies || signedQuoteRequested) {
      const quoteLookup = await verifyShopifyReadingVariantQuote({
        variantId: sharedProduct.variantId,
        expectedSku: sharedProduct.sku,
        countryCode: intentLocaleContext.country || 'US',
        expectedCurrency: intentLocaleContext.currency || 'USD',
        env: process.env,
      });
      if (!('quote' in quoteLookup) || !quoteLookup.quote) {
        const failure = quoteLookup as {
          status: 409 | 422 | 503;
          reason: string;
          upstreamStatus: number;
          upstreamCode?: string;
        };
        return sharedCheckoutRejection(failure.status, failure.reason, origin, {
          page: pageValue,
          toolType,
          tier: storefrontTier,
          variantId: expectedVariantValue,
          upstreamStatus: failure.upstreamStatus,
          upstreamCode: failure.upstreamCode || '',
        });
      }
      if (exactPersonalDirectPage) {
        const displayedQuote = record(body.displayedQuote);
        const displayedVariantId = clean(displayedQuote.variantId, 24);
        const displayedSku = clean(displayedQuote.sku, 80).toUpperCase();
        const displayedPriceCents = Number(displayedQuote.priceCents);
        const displayedCurrency = clean(displayedQuote.currency, 3).toUpperCase();
        const displayedCountry = clean(displayedQuote.country, 2).toUpperCase();
        if (displayedVariantId !== quoteLookup.quote.variantId || displayedSku !== quoteLookup.quote.sku
          || !Number.isInteger(displayedPriceCents) || displayedPriceCents <= 0
          || !/^[A-Z]{3}$/.test(displayedCurrency)
          || !/^[A-Z]{2}$/.test(displayedCountry)) {
          return sharedCheckoutRejection(422, PERSONAL_DIRECT_PUBLIC_ERROR_CODES.displayedQuoteInvalid, origin, {
            page: pageValue,
            toolType,
            tier: storefrontTier,
            variantId: expectedVariantValue,
            publicCode: PERSONAL_DIRECT_PUBLIC_ERROR_CODES.displayedQuoteInvalid,
          });
        }
        if (displayedPriceCents !== quoteLookup.quote.priceCents
          || displayedCurrency !== quoteLookup.quote.currency
          || displayedCountry !== quoteLookup.quote.country) {
          return personalDirectQuoteChanged(origin, quoteLookup.quote, storefrontTier);
        }
      }
      if (directTarotValidation.applies || signedQuoteRequested) {
        const displayedQuote = record(body.displayedQuote);
        const displayedVariantId = clean(displayedQuote.variantId, 24);
        const displayedSku = clean(displayedQuote.sku, 80).toUpperCase();
        const displayedPriceCents = Number(displayedQuote.priceCents);
        const displayedCurrency = clean(displayedQuote.currency, 3).toUpperCase();
        const displayedCountry = clean(displayedQuote.country, 2).toUpperCase();
        if (displayedVariantId !== quoteLookup.quote.variantId || displayedSku !== quoteLookup.quote.sku
          || !Number.isInteger(displayedPriceCents) || displayedPriceCents <= 0
          || !/^[A-Z]{3}$/.test(displayedCurrency)
          || !/^[A-Z]{2}$/.test(displayedCountry)) {
          return sharedCheckoutRejection(422, DIRECT_TAROT_DISPLAYED_QUOTE_INVALID, origin, {
            page: pageValue,
            toolType,
            tier: storefrontTier,
            variantId: expectedVariantValue,
            publicCode: DIRECT_TAROT_DISPLAYED_QUOTE_INVALID,
          });
        }
        if (displayedPriceCents !== quoteLookup.quote.priceCents
          || displayedCurrency !== quoteLookup.quote.currency
          || displayedCountry !== quoteLookup.quote.country) {
          return directTarotQuoteChanged(origin, quoteLookup.quote, pageValue, snapshotPresentationVariant, storefrontTier);
        }
      }
      sharedCheckoutQuote = {
        intentId: id,
        variantId: quoteLookup.quote.variantId,
        sku: quoteLookup.quote.sku,
        priceCents: quoteLookup.quote.priceCents,
        currency: quoteLookup.quote.currency,
        country: quoteLookup.quote.country,
      };
      if (exactPersonalDirectPage || directTarotValidation.applies) {
        // A missing storefront country/currency intentionally falls back to the
        // US/USD quote above. Bind that effective Markets context into the same
        // signed snapshot returned to checkout; otherwise an accepted intent
        // would fail post-purchase reconciliation against its own quote.
        intentLocaleContext = Object.freeze({
          ...intentLocaleContext,
          country: quoteLookup.quote.country,
          currency: quoteLookup.quote.currency,
        });
      }
    }
    page = pageValue;
    readingType = toolType;
    const sharedCategory = clean(body.category, 20).toLowerCase();
    category = exactPersonalDirectPage
      ? 'personal'
      : pageValue === LOVE_DIRECT_PAGE
        ? 'love'
        : pageValue === CAREER_DIRECT_PAGE
          ? 'career'
          : pageValue === BIRTH_CARD_DIRECT_PAGE
            ? 'personal'
      : sharedCategory === 'love' || sharedCategory === 'career' || sharedCategory === 'money' || sharedCategory === 'personal'
      ? sharedCategory
      : 'general';
    deck = /astro|chart|horoscope|zodiac|moon|rising|lilith|node|saturn|venus/i.test(toolType)
      ? 'natal_chart'
      : /numerolog|angel|life path|biorhythm/i.test(toolType)
        ? 'numerology'
        : 'classic_tarot';
    answer = directTarotValidation.kind === 'yes_no'
      ? clean(record(directTarotValidation.evidence).answer, 20)
      : 'CONDITIONAL';
    const directEvidenceCard = record(record(directTarotValidation.evidence).card);
    cardName = directTarotValidation.kind === 'yes_no'
      ? clean(directEvidenceCard.name, 80)
      : toolType;
    cardId = directTarotValidation.kind === 'yes_no'
      ? Number(directEvidenceCard.id)
      : 0;
    intentKind = 'shared_tool';
    snapshot = {
      version: snapshotVersion,
      type: snapshotType,
      question: snapshotQuestion,
      context: snapshotContext,
      signals: snapshotSignals,
      cards: snapshotCards,
      spread: snapshotSpread,
      scope: snapshotScope,
      confidence: snapshotConfidence,
      focus: snapshotFocus,
      tool: snapshotTool,
      curiosityQuestion: snapshotCuriosityQuestion,
      presentationVariant: snapshotPresentationVariant,
      readingId,
      ...(sharedCheckoutQuote ? { checkoutQuote: sharedCheckoutQuote } : {}),
      ...(exactSevenCardPage ? { transportFallback: sharedSnapshot.transportFallback === true } : {}),
      ...(directTarotValidation.applies && directTarotValidation.kind !== 'birth' ? {
        transportFallback: sharedSnapshot.transportFallback === true,
        ...(sharedSnapshot.transportFallback === true ? { transportFailure: clean(sharedSnapshot.transportFailure, 24) } : {}),
      } : {}),
      ...(directTarotValidation.kind === 'yes_no' ? {
        answer: clean(sharedSnapshot.answer, 20),
        deckVersion: clean(sharedSnapshot.deckVersion, 80),
        card: record(sharedSnapshot.card),
      } : {}),
      ...(directTarotValidation.kind === 'love' || directTarotValidation.kind === 'career' ? {
        cardEvidence: Array.isArray(sharedSnapshot.cardEvidence) ? sharedSnapshot.cardEvidence : [],
      } : {}),
      ...(directTarotValidation.kind === 'birth' ? {
        birthDate: clean(sharedSnapshot.birthDate, 10),
        calculationMethod: clean(sharedSnapshot.calculationMethod, 80),
        calculationTrace: clean(sharedSnapshot.calculationTrace, 300),
        birthCardSequence: Array.isArray(sharedSnapshot.birthCardSequence) ? sharedSnapshot.birthCardSequence : [],
        birthCards: Array.isArray(sharedSnapshot.birthCards) ? sharedSnapshot.birthCards : [],
      } : {}),
    };
  } else {
    const categoryValue = clean(body.category, 20).toLowerCase();
    const answerValue = clean(body.answer, 20).toUpperCase();
    const cardNameValue = clean(body.cardName, 80);
    const cardIdValue = Number.parseInt(String(body.cardId || ''), 10);
    if (!isYesNoCategory(categoryValue)
      || !['YES', 'NO', 'NOT YET', 'IT DEPENDS', 'CONDITIONAL', 'UNCLEAR'].includes(answerValue)
      || !cardNameValue
      || !Number.isInteger(cardIdValue)
      || cardIdValue < 1
      || cardIdValue > 78
      || !isSupportedYesNoFunnelVersion(funnelVersion)) {
      return json({ error: 'invalid_checkout_intent' }, 422, origin);
    }
    page = '/pages/yes-or-no-tarot';
    category = categoryValue;
    readingType = readingTypeForCategory(category);
    deck = deckForCategory(category);
    answer = answerValue;
    cardName = cardNameValue;
    cardId = cardIdValue;
    snapshot = safeYesNoSnapshot(body.snapshot);
  }

  snapshot = { ...snapshot, localeContext: intentLocaleContext };

  const product = requestedKind === 'shared_tool'
    ? sharedProduct
    : readingPackage(
    numerologyCompatibility ? 'numerology_compatibility'
      : moonLunar ? 'moon_lunar'
      : zodiacCompatibility ? 'zodiac_compatibility'
      : angelNumber ? 'angel_number'
      : bigThree ? 'big_three'
        : birthChart ? 'birth_chart'
          : dailyHoroscope ? 'daily_horoscope'
            : dailyTarot ? 'daily_tarot'
              : productKeyForCategory(category),
    tier,
  );
  if (!product) return json({ error: 'package_unavailable' }, 409, origin);

  // Shopify checkouts are frequently resumed from an email or another device.
  // Keep the signed, one-use record long enough for that normal flow while the
  // worker still prevents reuse by binding it to the first paid order.
  const expiresAt = new Date(Date.now() + (
    intentKind === 'shared_tool' && [YES_NO_DIRECT_PAGE, LOVE_DIRECT_PAGE, CAREER_DIRECT_PAGE, BIRTH_CARD_DIRECT_PAGE].includes(page)
      ? DIRECT_TAROT_CHECKOUT_INTENT_TTL_MS
      : CHECKOUT_INTENT_TTL_MS
  ));
  // Legacy Yes/No rows intentionally use the original 16-field signature and
  // the database contract requires both extended columns to remain null.
  const snapshotHash = checkoutIntentSnapshotHash(intentKind, snapshot);
  const canonical = {
    id,
    expiresAt: expiresAt.toISOString(),
    page,
    funnelVersion,
    readingId,
    readingType,
    category,
    deck,
    question,
    answer,
    cardName,
    cardId,
    tier,
    variantId: product.variantId,
    sku: product.sku,
    price: product.price,
    intentKind,
    snapshotHash,
  };
  const signature = signCheckoutIntent(canonical, secret);
  try {
    const sql = db();
    await sql`
      insert into deckaura.checkout_intents(
        id, expires_at, page, funnel_version, reading_id, reading_type,
        category, deck, question, answer, card_name, card_id, tier,
        shopify_variant_id, sku, price, snapshot, signature, intent_kind, snapshot_hash
      ) values (
        ${id}, ${expiresAt}, ${page}, ${funnelVersion}, ${readingId}, ${readingType},
        ${category}, ${deck}, ${question}, ${answer}, ${cardName}, ${cardId}, ${tier},
        ${product.variantId}, ${product.sku}, ${product.price}, ${sql.json(snapshot as never)}, ${signature},
        ${intentKind}, ${snapshotHash}
      )
    `;
  } catch {
    console.error(JSON.stringify({
      event: 'checkout_intent_persist_failed',
      status: 503,
      kind: intentKind || 'yes_no',
      page,
      tier,
      variantId: product.variantId,
    }));
    return json({ error: 'checkout_intent_unavailable' }, 503, origin);
  }

  return json({
    ok: true,
    intentId: id,
    signature,
    expiresAt: expiresAt.toISOString(),
    variantId: product.variantId,
    sku: product.sku,
    price: product.price,
    tier,
    readingType,
    snapshotHash,
    localeContext: intentLocaleContext,
    ...(sharedCheckoutQuote ? {
      checkoutQuote: {
        ...sharedCheckoutQuote,
        snapshotHash,
        expiresAt: expiresAt.toISOString(),
      },
    } : {}),
    ...(intentKind === 'daily_horoscope' ? {
      preview: {
        sign: snapshot.sign,
        focusLabel: snapshot.focusLabel,
        confidence: record(snapshot.calculation).confidence,
        transits: Array.isArray(snapshot.transits)
          ? snapshot.transits.slice(0, 3).map((value) => {
            const transit = record(value);
            return {
              label: `${clean(transit.movingPlanet, 20)} ${clean(transit.aspect, 20)} natal ${clean(transit.natalPlanet, 20)}`,
              peakAt: clean(transit.peakAt, 40),
              tone: clean(transit.tone, 20),
            };
          })
          : [],
      },
    } : {}),
    ...(intentKind === 'moon_lunar' ? {
      preview: {
        phase: snapshot.current && record(snapshot.current).phase,
        moonSign: snapshot.current && record(snapshot.current).moonSign,
        natalMoonSign: snapshot.natalMoon && record(snapshot.natalMoon).sign,
        natalMoon: snapshot.natalMoon && record(snapshot.natalMoon).ambiguous === true
          && Array.isArray(record(snapshot.natalMoon).possibleSigns)
          ? (record(snapshot.natalMoon).possibleSigns as unknown[]).map((value) => clean(value, 24)).join(' or ')
          : snapshot.natalMoon && record(snapshot.natalMoon).sign,
        natalMoonConfidence: snapshot.natalMoon && record(snapshot.natalMoon).confidence,
        packageTitle: snapshot.packageTitle,
        coverageDays: snapshot.coverageDays,
      },
    } : {}),
  }, 201, origin);
}
