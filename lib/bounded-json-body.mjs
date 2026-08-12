export class BoundedJsonBodyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'BoundedJsonBodyError';
    this.code = code;
  }
}

export async function readBoundedJson(request, maximumBytes = 12_000) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new BoundedJsonBodyError('too_large');
  }
  if (!request.body) throw new BoundedJsonBodyError('invalid_json');

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new BoundedJsonBodyError('invalid_json');
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel('body_too_large').catch(() => undefined);
        throw new BoundedJsonBodyError('too_large');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof BoundedJsonBodyError) throw error;
    throw new BoundedJsonBodyError('invalid_json');
  } finally {
    reader.releaseLock();
  }
}
