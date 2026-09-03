// Release pins for storefront code that lives in Shopify rather than this
// Vercel project. Local release verification reads the authoritative asset and
// proves its complete digest; isolated Vercel builds verify this descriptor and
// the matching backend/queue/database contract without reaching another deploy.
export const RUNE_V2_STOREFRONT_CONTRACT = Object.freeze({
  sourceSha256: 'b86539f967c51df2e7d15a7f0cc7c04b1d6c7216d6e11fc6aacb7797ef8c38cc',
  contractVersion: 'rune-checkout-v2',
  readingType: 'Rune Reading',
  requiredFunctions: Object.freeze(['checkoutContractIsValid', 'castInputContract']),
  castLengthGuard: 's.cast.length !== slots.length',
  castStateGuard: 's.castContract !== castInputContract()',
});
