export class BoundedJsonBodyError extends Error {
  readonly code: 'too_large' | 'invalid_json';
  constructor(code: 'too_large' | 'invalid_json');
}

export function readBoundedJson(request: Request, maximumBytes?: number): Promise<unknown>;
