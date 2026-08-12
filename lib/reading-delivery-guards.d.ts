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
  actual: ReadingIntentProperties;
  expected: ReadingIntentProperties;
}>): boolean;

export function hasConfirmedReadingFulfillment(result: unknown): boolean;
