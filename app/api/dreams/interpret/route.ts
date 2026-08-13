import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { aiUsage, freeReadingBudgets } from '@/lib/worker-env';
import { BoundedJsonBodyError, readBoundedJson } from '@/lib/bounded-json-body.mjs';
import { buildDreamProviderRequest, parseDreamProviderEnvelope } from '@/lib/dream-provider-request.mjs';
import {
  dreamEvidence,
  dreamModelSignals,
  immediateSafetyOutput,
  needsImmediateSafetyResponse,
  safeDreamAiOutput,
  safeDreamInput,
} from '@/lib/dream-interpretation.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MODEL = 'deepseek-v4-flash';
const FALLBACK_MODEL = 'deepseek-v4-pro';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const MAX_PROVIDER_RESPONSE_BYTES = 80_000;
const ALLOWED_ORIGINS = new Set([
  'https://deckaura.com',
  'https://www.deckaura.com',
  'http://127.0.0.1:9292',
  'http://localhost:9292',
]);

type ModelSignals = NonNullable<ReturnType<typeof dreamModelSignals>>;
type Completion = {
  output: NonNullable<ReturnType<typeof safeDreamAiOutput>>;
  model: string;
  inputTokens: number;
  outputTokens: number;
  retryCount: number;
  fallbackFrom?: string;
};

function headers(origin: string) {
  const value = new Headers({
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Type': 'application/json; charset=utf-8',
    Expires: '0',
    Pragma: 'no-cache',
    Vary: 'Origin',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  if (ALLOWED_ORIGINS.has(origin)) value.set('Access-Control-Allow-Origin', origin);
  value.set('Access-Control-Allow-Headers', 'Content-Type');
  value.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return value;
}

function json(body: unknown, status: number, origin: string, retryAfter?: number) {
  const responseHeaders = headers(origin);
  if (retryAfter) responseHeaders.set('Retry-After', String(Math.max(1, Math.ceil(retryAfter))));
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function requestIp(request: Request) {
  const forwarded = String(request.headers.get('x-vercel-forwarded-for') || '').split(',')[0].trim();
  if (isIP(forwarded)) return forwarded;
  return process.env.VERCEL === '1' ? '' : '127.0.0.1';
}

function networkIdentity(ip: string) {
  const secret = String(process.env.ENTITLEMENT_PEPPER || '').trim();
  if (!secret || !ip) return '';
  return createHmac('sha256', secret).update(`dream-rate:v1\0${ip}`).digest('hex').slice(0, 48);
}

function providerError(status: number, code: string) {
  const error = new Error(code);
  error.name = 'DreamProviderError';
  Object.assign(error, { upstreamStatus: status, safeCode: code });
  return error;
}

function safeUpstreamStatus(error: unknown) {
  const value = error && typeof error === 'object'
    ? Number((error as Record<string, unknown>).upstreamStatus)
    : 0;
  return Number.isInteger(value) && value >= 400 && value <= 599 ? value : 0;
}

async function readBoundedResponse(response: Response, maximum: number) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maximum) {
    await response.body?.cancel().catch(() => undefined);
    throw providerError(502, 'response_too_large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel().catch(() => undefined);
      throw providerError(502, 'response_too_large');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function parseProviderOutput(payload: unknown) {
  let envelope;
  try {
    envelope = parseDreamProviderEnvelope(payload);
  } catch {
    throw providerError(502, 'invalid_envelope');
  }
  let source: unknown;
  try {
    source = JSON.parse(envelope.content);
  } catch {
    throw providerError(502, 'invalid_json');
  }
  const output = safeDreamAiOutput(source);
  if (!output) throw providerError(502, 'invalid_output');
  return { output, inputTokens: envelope.inputTokens, outputTokens: envelope.outputTokens };
}

function validateThemes(output: Completion['output'], signals: ModelSignals) {
  return output.themes.length === signals.themes.length
    && output.themes.every((theme: { name: string }, index: number) => theme.name === signals.themes[index]);
}

async function callDeepSeek(model: string, signals: ModelSignals, timeoutMs: number) {
  const key = String(process.env.DEEPSEEK_DIRECT_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim();
  if (!key) throw providerError(503, 'credentials_missing');
  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildDreamProviderRequest(model, signals)),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((error) => {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw providerError(408, 'timeout');
    }
    throw providerError(503, 'network_error');
  });
  const body = await readBoundedResponse(response, MAX_PROVIDER_RESPONSE_BYTES);
  if (!response.ok) throw providerError(response.status, `http_${response.status}`);
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw providerError(502, 'invalid_envelope');
  }
  const parsed = parseProviderOutput(payload);
  if (!validateThemes(parsed.output, signals)) throw providerError(502, 'theme_mismatch');
  return parsed;
}

async function completeDream(signals: ModelSignals): Promise<Completion> {
  try {
    const result = await callDeepSeek(MODEL, signals, 24_000);
    return { ...result, model: MODEL, retryCount: 0 };
  } catch (firstError) {
    const status = safeUpstreamStatus(firstError);
    if (![0, 408, 429, 500, 502, 503, 504].includes(status)) throw firstError;
    const result = await callDeepSeek(FALLBACK_MODEL, signals, 24_000);
    return { ...result, model: FALLBACK_MODEL, retryCount: 1, fallbackFrom: MODEL };
  }
}

export async function OPTIONS(request: Request) {
  const origin = String(request.headers.get('origin') || '');
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'origin_not_allowed' }, 403, origin);
  return new Response(null, { status: 204, headers: headers(origin) });
}

export async function POST(request: Request) {
  const origin = String(request.headers.get('origin') || '');
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'origin_not_allowed' }, 403, origin);
  const networkHash = networkIdentity(requestIp(request));
  if (!networkHash) return json({ error: 'service_unavailable' }, 503, origin);

  let source: unknown;
  try {
    source = await readBoundedJson(request, 12_000);
  } catch (error) {
    if (error instanceof BoundedJsonBodyError && error.code === 'too_large') return json({ error: 'invalid_request' }, 413, origin);
    return json({ error: 'invalid_request' }, 400, origin);
  }
  const input = safeDreamInput(source);
  if (!input) return json({ error: 'invalid_request' }, 422, origin);
  if (needsImmediateSafetyResponse(input.dream)) {
    return json({ ok: true, output: immediateSafetyOutput(), urgentSafety: true }, 200, origin);
  }
  const signals = dreamModelSignals(input);
  if (!signals) return json({ error: 'invalid_request' }, 422, origin);

  const requestId = randomUUID();
  let claim;
  try {
    claim = await freeReadingBudgets.claim(requestId, [
      { name: `network:${networkHash}`, kind: 'network', cap: 12 },
      { name: 'global:dream_ai_v1', kind: 'global', cap: 500 },
    ]);
  } catch {
    console.warn(JSON.stringify({ event: 'dream_ai_limiter_error', status: 503 }));
    return json({ error: 'service_unavailable' }, 503, origin);
  }
  if (claim.allowed !== true) {
    const nextAt = Number(claim.nextAt || 0);
    const retry = nextAt > Date.now() ? Math.ceil((nextAt - Date.now()) / 1000) : 3600;
    return json({ error: claim.reason === 'global_daily_limit' ? 'capacity_reached' : 'rate_limited' }, 429, origin, retry);
  }

  const started = Date.now();
  try {
    const completion = await completeDream(signals);
    const settled = await freeReadingBudgets.settle(requestId, true);
    if (settled.allowed !== true) throw providerError(503, 'quota_commit_failed');
    await aiUsage.record({
      idempotencyKey: `dream:${requestId}`,
      requestId,
      feature: 'dream_interpreter',
      route: '/api/dreams/interpret',
      provider: 'deepseek-direct',
      model: completion.model,
      status: completion.fallbackFrom ? 'fallback' : 'success',
      locale: 'en',
      page: '/pages/ai-dream-interpreter',
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
      cachedInputTokens: 0,
      latencyMs: Date.now() - started,
      retryCount: completion.retryCount,
      fallbackFrom: completion.fallbackFrom,
      metadata: { schema: 'dream-reflection-v2-coarse-signals', themeCount: completion.output.themes.length },
    }).catch(() => console.warn(JSON.stringify({ event: 'dream_ai_usage_record_error', status: 503 })));
    return json({ ok: true, output: completion.output, evidence: dreamEvidence(input, completion.output) }, 200, origin);
  } catch (error) {
    await freeReadingBudgets.settle(requestId, false).catch(() => undefined);
    const upstreamStatus = safeUpstreamStatus(error);
    const status = upstreamStatus === 429 ? 429 : 503;
    console.warn(JSON.stringify({ event: 'dream_ai_generation_error', status, upstreamStatus: upstreamStatus || undefined }));
    return json({ error: status === 429 ? 'temporarily_rate_limited' : 'generation_unavailable' }, status, origin, status === 429 ? 60 : undefined);
  }
}
