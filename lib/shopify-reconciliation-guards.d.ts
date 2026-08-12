export type ValidatedOrdersConnection<T = Record<string, unknown>> = {
  nodes: T[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
};

export function validatedOrdersConnection<T = Record<string, unknown>>(body: unknown): ValidatedOrdersConnection<T>;
export function assertReconciliationPageFetched(pages: number): void;
