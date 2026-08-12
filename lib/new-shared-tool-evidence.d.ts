export const NEW_SHARED_TOOL_PAGE_TYPES: Readonly<Record<string, string>>;

export function newSharedToolPageForType(type: unknown): string;
export function isNewSharedToolPage(page: unknown): boolean;
export function validateNewSharedToolSnapshot(input: {
  page?: unknown;
  toolType?: unknown;
  snapshot?: Record<string, unknown> | null;
}): { applies: boolean; ok: boolean; reason: string };
