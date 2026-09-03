export type ReadingTier = 'standard' | 'medium' | 'premium';
export type StorefrontTier = 'essential' | 'deeper' | 'indepth';
export type YesNoCategory = 'love' | 'career' | 'money' | 'personal' | 'general';
export type ReadingProductKey = 'yes_no_love' | 'yes_no_general' | 'daily_tarot' | 'daily_horoscope' | 'birth_chart' | 'big_three' | 'angel_number' | 'zodiac_compatibility' | 'moon_lunar' | 'numerology_compatibility';

export const LOVE_TAROT_PAGE = '/pages/love-tarot-reading';
export const LOVE_TAROT_FUNNEL_VERSION = 'love-intent-funnel-2026-08-v1';
// The storefront's shipped love funnel (custom 93-card love oracle deck with
// slug card ids). The v1 numeric 26-card contract stays for backward
// compatibility; live pages submit this version.
export const LOVE_TAROT_FUNNEL_VERSION_I18N = 'love-intent-funnel-2026-08-v2-i18n';

export type LoveTarotIntent =
  | 'feelings'
  | 'intentions'
  | 'reconciliation'
  | 'contact_timing'
  | 'relationship_future'
  | 'commitment'
  | 'new_love'
  | 'stay_or_leave';

export type LoveRelationshipStatus =
  | 'crush'
  | 'dating'
  | 'relationship'
  | 'separated'
  | 'no_contact'
  | 'single';

export const LOVE_TAROT_CARD_TITLES = Object.freeze([
  'Reconciliation', 'True Love', 'Growing Apart', 'A New Beginning', 'Hidden Feelings',
  'Passion', 'Patience', 'Open Communication', 'Letting Go', 'Healing', 'Commitment',
  'Doubt', 'Soulmate Energy', 'Jealousy', 'Self-Love', 'Divine Timing',
  'Outside Influences', 'Forgiveness', 'Distance', 'Returning Joy', 'A Crossroads',
  'Trust', 'Unequal Footing', 'Rekindled Spark', 'Gentle Closure', 'Devotion',
] as const);

// Canonical 93-card love oracle deck shipped with the storefront love funnel
// (theme assets: love-card-<slug>.webp). Array order is the persisted numeric
// card id (offset +100 so it can never collide with the legacy 26-card ids).
export const LOVE_ORACLE_CARDS = Object.freeze([
  { slug: 'slow-burn', title: 'Slow Burn' },
  { slug: 'moving-on', title: 'Moving On' },
  { slug: 'choose-yourself', title: 'Choose Yourself' },
  { slug: 'the-door-closed', title: 'The Door Closed' },
  { slug: 'your-love-story', title: 'Your Love Story' },
  { slug: 'love-needs-respect', title: 'Love Needs Respect' },
  { slug: 'guarded-heart', title: 'Guarded Heart' },
  { slug: 'hidden-tenderness', title: 'Hidden Tenderness' },
  { slug: 'private-longing', title: 'Private Longing' },
  { slug: 'hot-and-cold', title: 'Hot and Cold' },
  { slug: 'safe-to-open', title: 'Safe to Open' },
  { slug: 'heart-on-pause', title: 'Heart on Pause' },
  { slug: 'truth-leaks-out', title: 'Truth Leaks Out' },
  { slug: 'future-faking', title: 'Future Faking' },
  { slug: 'triangle-energy', title: 'Triangle Energy' },
  { slug: 'mutual-choice', title: 'Mutual Choice' },
  { slug: 'change-of-heart', title: 'Change of Heart' },
  { slug: 'softer-this-time', title: 'Softer This Time' },
  { slug: 'deeper-than-shown', title: 'Deeper Than Shown' },
  { slug: 'curious-about-you', title: 'Curious About You' },
  { slug: 'unsent-words', title: 'Unsent Words' },
  { slug: 'the-silent-line', title: 'The Silent Line' },
  { slug: 'heal-before-return', title: 'Heal Before Return' },
  { slug: 'reciprocal-love', title: 'Reciprocal Love' },
  { slug: 'ask-the-question', title: 'Ask the Question' },
  { slug: 'familiar-soul', title: 'Familiar Soul' },
  { slug: 'match-the-energy', title: 'Match the Energy' },
  { slug: 'growing-attraction', title: 'Growing Attraction' },
  { slug: 'end-or-evolve', title: 'End or Evolve' },
  { slug: 'magnetic-night', title: 'Magnetic Night' },
  { slug: 'movement-at-last', title: 'Movement at Last' },
  { slug: 'avoidant-dance', title: 'Avoidant Dance' },
  { slug: 'repeating-pattern', title: 'Repeating Pattern' },
  { slug: 'undeniable-chemistry', title: 'Undeniable Chemistry' },
  { slug: 'different-paths', title: 'Different Paths' },
  { slug: 'intimacy-needs-truth', title: 'Intimacy Needs Truth' },
  { slug: 'an-honest-return', title: 'An Honest Return' },
  { slug: 'read-between', title: 'Read Between' },
  { slug: 'action-required', title: 'Action Required' },
  { slug: 'touch-without-fear', title: 'Touch Without Fear' },
  { slug: 'more-than-lust', title: 'More Than Lust' },
  { slug: 'returning-energy', title: 'Returning Energy' },
  { slug: 'emotional-tide', title: 'Emotional Tide' },
  { slug: 'old-wound-open', title: 'Old Wound Open' },
  { slug: 'trust-rebuilds-slowly', title: 'Trust Rebuilds Slowly' },
  { slug: 'watch-the-actions', title: 'Watch the Actions' },
  { slug: 'show-up-fully', title: 'Show Up Fully' },
  { slug: 'choose-clarity', title: 'Choose Clarity' },
  { slug: 'open-to-better', title: 'Open to Better' },
  { slug: 'half-a-story', title: 'Half a Story' },
  { slug: 'the-real-answer', title: 'The Real Answer' },
  { slug: 'electric-pull', title: 'Electric Pull' },
  { slug: 'mixed-signals', title: 'Mixed Signals' },
  { slug: 'take-the-leap', title: 'Take the Leap' },
  { slug: 'desire-rising', title: 'Desire Rising' },
  { slug: 'a-new-chapter', title: 'A New Chapter' },
  { slug: 'protect-your-peace', title: 'Protect Your Peace' },
  { slug: 'future-building', title: 'Future Building' },
  { slug: 'no-contact', title: 'No Contact' },
  { slug: 'a-different-love', title: 'A Different Love' },
  { slug: 'the-message-arrives', title: 'The Message Arrives' },
  { slug: 'the-long-gap', title: 'The Long Gap' },
  { slug: 'control-disguised', title: 'Control Disguised' },
  { slug: 'the-next-season', title: 'The Next Season' },
  { slug: 'closer-than-before', title: 'Closer Than Before' },
  { slug: 'second-chance', title: 'Second Chance' },
  { slug: 'cycle-complete', title: 'Cycle Complete' },
  { slug: 'no-more-crumbs', title: 'No More Crumbs' },
  { slug: 'jealous-eyes', title: 'Jealous Eyes' },
  { slug: 'missing-you', title: 'Missing You' },
  { slug: 'keep-your-center', title: 'Keep Your Center' },
  { slug: 'make-the-move', title: 'Make the Move' },
  { slug: 'ready-or-not', title: 'Ready or Not' },
  { slug: 'slow-repair', title: 'Slow Repair' },
  { slug: 'your-needs-count', title: 'Your Needs Count' },
  { slug: 'not-yet', title: 'Not Yet' },
  { slug: 'crossing-paths', title: 'Crossing Paths' },
  { slug: 'lesson-in-love', title: 'Lesson in Love' },
  { slug: 'wait-for-proof', title: 'Wait for Proof' },
  { slug: 'the-crossroads', title: 'The Crossroads' },
  { slug: 'still-connected', title: 'Still Connected' },
  { slug: 'afraid-to-feel', title: 'Afraid to Feel' },
  { slug: 'meet-halfway', title: 'Meet Halfway' },
  { slug: 'forgive-yourself', title: 'Forgive Yourself' },
  { slug: 'the-confession', title: 'The Confession' },
  { slug: 'secret-agenda', title: 'Secret Agenda' },
  { slug: 'the-body-remembers', title: 'The Body Remembers' },
  { slug: 'uneven-effort', title: 'Uneven Effort' },
  { slug: 'the-last-word', title: 'The Last Word' },
  { slug: 'distance-clarifies', title: 'Distance Clarifies' },
  { slug: 'space-is-speaking', title: 'Space Is Speaking' },
  { slug: 'charm-without-depth', title: 'Charm Without Depth' },
  { slug: 'divine-delay', title: 'Divine Delay' },
] as const);

const LOVE_ORACLE_BY_SLUG = new Map<string, { numericId: number; title: string }>(
  LOVE_ORACLE_CARDS.map((card, index) => [card.slug, { numericId: 100 + index + 1, title: card.title }]),
);

export function loveOracleCardBySlug(slug: unknown) {
  const normalized = String(slug ?? '').trim().toLowerCase();
  return LOVE_ORACLE_BY_SLUG.get(normalized) ?? null;
}

export const LOVE_TAROT_DIRECTIONS = Object.freeze([
  'Open and developing',
  'Genuine but guarded',
  'Emotionally conflicted',
  'Delayed, not closed',
  'Unstable without change',
  'Moving toward closure',
  'Potential exists, but conditions matter',
] as const);

export const LOVE_TAROT_INTENTS = Object.freeze({
  feelings: Object.freeze({
    label: 'Their Feelings',
    positions: Object.freeze(['What They Show', 'What They Feel', 'What They Are Likely to Do']),
  }),
  intentions: Object.freeze({
    label: 'Their Intentions',
    positions: Object.freeze(['Their Desire', 'Their Hesitation', 'Their Current Intention']),
  }),
  reconciliation: Object.freeze({
    label: 'Reconciliation',
    positions: Object.freeze(['What Still Connects You', 'What Blocks Reunion', 'The Current Direction']),
  }),
  contact_timing: Object.freeze({
    label: 'Contact & Timing',
    positions: Object.freeze(['The Silence', 'The Next Movement', 'Your Best Approach']),
  }),
  relationship_future: Object.freeze({
    label: 'Relationship Future',
    positions: Object.freeze(['Current Bond', 'Main Challenge', 'Where It Is Heading']),
  }),
  commitment: Object.freeze({
    label: 'Commitment',
    positions: Object.freeze(['What They Want', 'What They Fear', 'The Commitment Path']),
  }),
  new_love: Object.freeze({
    label: 'New Love',
    positions: Object.freeze(['Your Readiness', 'What Is Opening', 'Where Love May Find You']),
  }),
  stay_or_leave: Object.freeze({
    label: 'Stay or Leave',
    positions: Object.freeze(['Path of Staying', 'Path of Leaving', 'What Your Heart Needs']),
  }),
} as const);

export const YES_NO_FUNNEL_VERSION = 'yesno-clarity-checkout-2026-08-v2';
export const YES_NO_LEGACY_FUNNEL_VERSIONS = Object.freeze([
  'yesno-clarity-checkout-2026-08-v1',
] as const);

export function isSupportedYesNoFunnelVersion(value: unknown) {
  const version = String(value || '').trim();
  return version === YES_NO_FUNNEL_VERSION
    || YES_NO_LEGACY_FUNNEL_VERSIONS.includes(version as typeof YES_NO_LEGACY_FUNNEL_VERSIONS[number]);
}

export function isSupportedCheckoutFunnelVersion(value: unknown) {
  const version = String(value || '').trim();
  return version === LOVE_TAROT_FUNNEL_VERSION
    || version === 'daily-context-funnel-2026-08-v1'
    || version === 'daily-horoscope-transit-checkout-2026-08-v1'
    || version === 'birth-chart-evidence-checkout-2026-08-v2'
    || version === 'birth-chart-evidence-checkout-2026-08-v1'
    || version === 'big-three-synthesis-checkout-2026-08-v1'
    || version === 'angel-situational-funnel-2026-08-v1'
    || version === '777-personal-answer-2026-08-v1'
    || version === 'zodiac-context-checkout-2026-08-v1'
    || version === 'moon-lunar-intent-checkout-2026-09-v2'
    || version === 'moon-lunar-intent-checkout-2026-08-v1'
    || version === 'numerology-compatibility-v4-20260805'
    || isSupportedYesNoFunnelVersion(version);
}

export function isLoveTarotIntent(value: unknown): value is LoveTarotIntent {
  return Object.hasOwn(LOVE_TAROT_INTENTS, String(value || '').trim().toLowerCase());
}

export function isLoveRelationshipStatus(value: unknown): value is LoveRelationshipStatus {
  return ['crush', 'dating', 'relationship', 'separated', 'no_contact', 'single']
    .includes(String(value || '').trim().toLowerCase());
}

export function loveTarotCardTitle(cardId: unknown) {
  const normalized = Number.parseInt(String(cardId || ''), 10);
  return Number.isInteger(normalized) && normalized >= 1 && normalized <= LOVE_TAROT_CARD_TITLES.length
    ? LOVE_TAROT_CARD_TITLES[normalized - 1]
    : null;
}

export type ReadingPackage = Readonly<{
  productKey: ReadingProductKey;
  tier: ReadingTier;
  storefrontTier: StorefrontTier;
  variantId: string;
  sku: 'READING-DEEP' | 'READING-MEDIUM' | 'READING-PREMIUM';
  price: 5.99 | 9.99 | 16.99;
}>;

const packages = [
  { productKey: 'yes_no_love', tier: 'standard', storefrontTier: 'essential', variantId: '53782500409617', sku: 'READING-DEEP', price: 5.99 },
  { productKey: 'yes_no_love', tier: 'medium', storefrontTier: 'deeper', variantId: '53782500442385', sku: 'READING-MEDIUM', price: 9.99 },
  { productKey: 'yes_no_love', tier: 'premium', storefrontTier: 'indepth', variantId: '53782500475153', sku: 'READING-PREMIUM', price: 16.99 },
  { productKey: 'yes_no_general', tier: 'standard', storefrontTier: 'essential', variantId: '53675061838097', sku: 'READING-DEEP', price: 5.99 },
  { productKey: 'yes_no_general', tier: 'medium', storefrontTier: 'deeper', variantId: '53677128155409', sku: 'READING-MEDIUM', price: 9.99 },
  { productKey: 'yes_no_general', tier: 'premium', storefrontTier: 'indepth', variantId: '53705415098641', sku: 'READING-PREMIUM', price: 16.99 },
] as const satisfies readonly ReadingPackage[];

export const YES_NO_READING_PACKAGES = Object.freeze(packages);

export const DAILY_TAROT_READING_PACKAGES = Object.freeze([
  { productKey: 'daily_tarot', tier: 'standard', storefrontTier: 'essential', variantId: '53675061838097', sku: 'READING-DEEP', price: 5.99 },
  { productKey: 'daily_tarot', tier: 'medium', storefrontTier: 'deeper', variantId: '53677128155409', sku: 'READING-MEDIUM', price: 9.99 },
  { productKey: 'daily_tarot', tier: 'premium', storefrontTier: 'indepth', variantId: '53705415098641', sku: 'READING-PREMIUM', price: 16.99 },
] as const satisfies readonly ReadingPackage[]);

export const DAILY_HOROSCOPE_READING_PACKAGES = Object.freeze([
  { productKey: 'daily_horoscope', tier: 'standard', storefrontTier: 'essential', variantId: '53782499950865', sku: 'READING-DEEP', price: 5.99 },
  { productKey: 'daily_horoscope', tier: 'medium', storefrontTier: 'deeper', variantId: '53782499983633', sku: 'READING-MEDIUM', price: 9.99 },
  { productKey: 'daily_horoscope', tier: 'premium', storefrontTier: 'indepth', variantId: '53782500016401', sku: 'READING-PREMIUM', price: 16.99 },
] as const satisfies readonly ReadingPackage[]);

export const BIRTH_CHART_READING_PACKAGES = Object.freeze([
  { productKey: 'birth_chart', tier: 'standard', storefrontTier: 'essential', variantId: '53782498312465', sku: 'READING-DEEP', price: 5.99 },
  { productKey: 'birth_chart', tier: 'medium', storefrontTier: 'deeper', variantId: '53782498345233', sku: 'READING-MEDIUM', price: 9.99 },
  { productKey: 'birth_chart', tier: 'premium', storefrontTier: 'indepth', variantId: '53782498378001', sku: 'READING-PREMIUM', price: 16.99 },
] as const satisfies readonly ReadingPackage[]);

export const BIG_THREE_READING_PACKAGES = Object.freeze([
  { productKey: 'big_three', tier: 'standard', storefrontTier: 'essential', variantId: '53782498705681', sku: 'READING-DEEP', price: 5.99 },
  { productKey: 'big_three', tier: 'medium', storefrontTier: 'deeper', variantId: '53782498738449', sku: 'READING-MEDIUM', price: 9.99 },
  { productKey: 'big_three', tier: 'premium', storefrontTier: 'indepth', variantId: '53782498771217', sku: 'READING-PREMIUM', price: 16.99 },
] as const satisfies readonly ReadingPackage[]);

export const ANGEL_NUMBER_READING_PACKAGES = Object.freeze([
  { productKey: 'angel_number', tier: 'standard', storefrontTier: 'essential', variantId: '53782498607377', sku: 'READING-DEEP', price: 5.99 },
  { productKey: 'angel_number', tier: 'medium', storefrontTier: 'deeper', variantId: '53782498640145', sku: 'READING-MEDIUM', price: 9.99 },
  { productKey: 'angel_number', tier: 'premium', storefrontTier: 'indepth', variantId: '53782498672913', sku: 'READING-PREMIUM', price: 16.99 },
] as const satisfies readonly ReadingPackage[]);

export const ZODIAC_COMPATIBILITY_READING_PACKAGES = Object.freeze([
  { productKey: 'zodiac_compatibility', tier: 'standard', storefrontTier: 'essential', variantId: '53782499262737', sku: 'READING-DEEP', price: 5.99 },
  { productKey: 'zodiac_compatibility', tier: 'medium', storefrontTier: 'deeper', variantId: '53782499295505', sku: 'READING-MEDIUM', price: 9.99 },
  { productKey: 'zodiac_compatibility', tier: 'premium', storefrontTier: 'indepth', variantId: '53782499328273', sku: 'READING-PREMIUM', price: 16.99 },
] as const satisfies readonly ReadingPackage[]);

export const MOON_LUNAR_READING_PACKAGES = Object.freeze([
  { productKey: 'moon_lunar', tier: 'standard', storefrontTier: 'essential', variantId: '53782500081937', sku: 'READING-DEEP', price: 5.99 },
  { productKey: 'moon_lunar', tier: 'medium', storefrontTier: 'deeper', variantId: '53782500114705', sku: 'READING-MEDIUM', price: 9.99 },
  { productKey: 'moon_lunar', tier: 'premium', storefrontTier: 'indepth', variantId: '53782500147473', sku: 'READING-PREMIUM', price: 16.99 },
] as const satisfies readonly ReadingPackage[]);

export const NUMEROLOGY_COMPATIBILITY_READING_PACKAGES = Object.freeze([
  { productKey: 'numerology_compatibility', tier: 'standard', storefrontTier: 'essential', variantId: '53782498214161', sku: 'READING-DEEP', price: 5.99 },
  { productKey: 'numerology_compatibility', tier: 'medium', storefrontTier: 'deeper', variantId: '53782498246929', sku: 'READING-MEDIUM', price: 9.99 },
  { productKey: 'numerology_compatibility', tier: 'premium', storefrontTier: 'indepth', variantId: '53782498279697', sku: 'READING-PREMIUM', price: 16.99 },
] as const satisfies readonly ReadingPackage[]);

const allReadingPackages: readonly ReadingPackage[] = [
  ...YES_NO_READING_PACKAGES,
  ...DAILY_TAROT_READING_PACKAGES,
  ...DAILY_HOROSCOPE_READING_PACKAGES,
  ...BIRTH_CHART_READING_PACKAGES,
  ...BIG_THREE_READING_PACKAGES,
  ...ANGEL_NUMBER_READING_PACKAGES,
  ...ZODIAC_COMPATIBILITY_READING_PACKAGES,
  ...MOON_LUNAR_READING_PACKAGES,
  ...NUMEROLOGY_COMPATIBILITY_READING_PACKAGES,
];

export function productKeyForCategory(category: YesNoCategory): ReadingProductKey {
  return category === 'love' ? 'yes_no_love' : 'yes_no_general';
}

export function readingTypeForCategory(category: YesNoCategory) {
  return category === 'love' ? 'Yes or No Love Tarot' : 'Yes or No Tarot';
}

export function deckForCategory(category: YesNoCategory) {
  return category === 'love' ? 'love_oracle' as const : 'classic_tarot' as const;
}

export function normalizeStorefrontTier(value: unknown): StorefrontTier | null {
  const tier = String(value || '').trim().toLowerCase();
  return tier === 'essential' || tier === 'deeper' || tier === 'indepth' ? tier : null;
}

export function paidTierForStorefrontTier(tier: StorefrontTier): ReadingTier {
  if (tier === 'deeper') return 'medium';
  if (tier === 'indepth') return 'premium';
  return 'standard';
}

export function readingPackage(productKey: ReadingProductKey, tier: ReadingTier) {
  return allReadingPackages.find((entry) => entry.productKey === productKey && entry.tier === tier) || null;
}

export function readingPackageByVariant(variantId: unknown) {
  const normalized = String(variantId || '').trim();
  return allReadingPackages.find((entry) => entry.variantId === normalized) || null;
}

export function isValidShopifyLinePrice(value: unknown) {
  const price = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(price) && price > 0;
}

export function belongsToDedicatedReadingPipeline(item: unknown) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const properties = Array.isArray((item as { properties?: unknown }).properties)
    ? (item as { properties: unknown[] }).properties
    : [];
  return properties.some((property) => {
    if (!property || typeof property !== 'object' || Array.isArray(property)) return false;
    const record = property as { name?: unknown; value?: unknown };
    const key = String(record.name ?? '').trim().toLowerCase().replace(/^_/, '');
    const value = String(record.value ?? '').trim().toLowerCase();
    if (key === 'reading_kind' || key === 'reading kind') {
      return value === 'human_design' || value === 'psychic';
    }
    // Older psychic carts were created before `_reading_kind` was added. The
    // signed psychic session marker is still sufficient to keep those already
    // open carts in their dedicated delivery pipeline.
    return key === 'psychic_session' && value.length > 0;
  });
}

export function shopifyPayloadForLegacyReplay(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const record = payload as { line_items?: unknown; [key: string]: unknown };
  if (!Array.isArray(record.line_items)) return record;
  const lineItems = record.line_items.filter((item) => !belongsToDedicatedReadingPipeline(item));
  return lineItems.length === record.line_items.length
    ? record
    : { ...record, line_items: lineItems };
}

export function isYesNoCategory(value: unknown): value is YesNoCategory {
  return ['love', 'career', 'money', 'personal', 'general'].includes(String(value || '').trim().toLowerCase());
}
