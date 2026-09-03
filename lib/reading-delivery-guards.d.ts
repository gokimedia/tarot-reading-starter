export type ReadingIntentProperties = Readonly<{
  funnelVersion: string;
  readingId: string;
  readingType: string;
  category: string;
  answer: string;
  cardName: string;
  question: string;
  tier: string;
}>;

export function readingIntentPropertiesMatch(input: Readonly<{
  knownIntentKind: boolean;
  allowMissingQuestion?: boolean;
  actual: ReadingIntentProperties;
  expected: ReadingIntentProperties;
}>): boolean;

export function hasConfirmedReadingFulfillment(result: unknown): boolean;

export function hasAuthoritativeDeliveredOrderEvidence(input: Readonly<{
  queuedOrderId: unknown;
  payloadOrderId: unknown;
  readingSkus: readonly unknown[];
  paidOrder: Readonly<{
    order_id?: unknown;
    financial_status?: unknown;
    status?: unknown;
    delivered_at?: unknown;
    fulfillment_id?: unknown;
    sku?: unknown;
  }> | null;
  deliveryJob: Readonly<{
    order_id?: unknown;
    job_type?: unknown;
    status?: unknown;
    completed_at?: unknown;
    idempotency_key?: unknown;
  }> | null;
}>): boolean;
