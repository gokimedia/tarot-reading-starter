import { db } from '@/lib/db';
import { Buffer } from 'node:buffer';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLAIM_MS = 2 * 60 * 1000;
const PAID_CLAIM_MS = 10 * 60 * 1000;

type KvPutOptions = {
  expiration?: number;
  expirationTtl?: number;
};

type LimiterState = Record<string, unknown>;

type JsonObject = Record<string, unknown>;

export type AiBudgetClaimInput = {
  claimId: string;
  budgetKey: string;
  feature: string;
  model: string;
  reserveMicros: number;
  dailyCapMicros: number;
  ttlSeconds?: number;
};

export type FreeReadingBudgetInput = {
  name: string;
  kind: 'visitor' | 'device' | 'network' | 'global';
  cap: number;
};

export type AiUsageEventInput = {
  idempotencyKey: string;
  claimId?: string | null;
  requestId: string;
  feature: string;
  route?: string;
  provider: string;
  model: string;
  status: 'success' | 'error' | 'fallback' | 'cancelled';
  locale?: string;
  page?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  costMicros?: number;
  latencyMs?: number;
  retryCount?: number;
  fallbackFrom?: string;
  metadata?: JsonObject;
};

export type ShopifyWebhookEnvelope = {
  webhookId: string;
  eventId?: string;
  topic: string;
  orderId?: string;
  payloadSha256: string;
  payload: JsonObject;
};

export type WebhookQueueRow = {
  webhook_id: string;
  event_id: string | null;
  topic: string;
  order_id: string | null;
  payload_sha256: string;
  payload: JsonObject;
  status: 'received' | 'processing' | 'processed' | 'failed';
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
  lease_expires_at: Date | null;
};

export type DeliveryJobRow = {
  id: string;
  order_id: string;
  job_type: 'paid_reading' | 'post_purchase_followup';
  due_at: Date;
  next_attempt_at: Date;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
  lease_expires_at: Date | null;
  idempotency_key: string;
};

export type FunnelEventInput = {
  eventId: string;
  eventName: string;
  conversationId?: string | null;
  readingId?: string | null;
  page: string;
  readingMode?: string | null;
  funnelVersion: string;
  experimentKey?: string | null;
  experimentVariant?: string | null;
  recommendedTier?: string | null;
  selectedTier?: string | null;
  shopifyVariantId?: string | null;
  orderId?: string | null;
  revenue?: number | null;
  currency?: string | null;
  metadata?: JsonObject;
  occurredAt?: string | null;
};

export type ReadingLeadInput = {
  email: string;
  emailHash: string;
  visitorHash: string;
  conversationId: string;
  readingId?: string | null;
  previewTokenHash: string;
  readingMode?: string | null;
  page: string;
  funnelVersion: string;
  experimentKey?: string | null;
  experimentVariant?: string | null;
  marketingConsent: boolean;
  consentVersion?: string | null;
  contentPayload: JsonObject;
};

export type LifecycleEmailJobRow = {
  id: number;
  lead_id: number | null;
  order_id: string | null;
  recipient_email: string;
  email_kind: 'reading_copy' | 'pre_purchase_20h' | 'pre_purchase_day3'
    | 'post_purchase_day2' | 'post_purchase_day5' | 'post_purchase_day8';
  due_at: Date;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
  lease_expires_at: Date | null;
  idempotency_key: string;
  payload: JsonObject;
  content_payload: JsonObject | null;
  unsubscribe_token: string | null;
};

const TELEMETRY_SENSITIVE_KEY = /(?:question|customer|visitor|device|network|email|phone|address|name|birth|dob|context|detail|focus|answer|teaser|prompt|html|message|raw|body|payload)/i;

function boundedText(value: unknown, maximum: number, field: string, minimum = 1) {
  const result = String(value ?? '').trim();
  if (result.length < minimum || result.length > maximum) {
    throw new Error(`Invalid ${field}`);
  }
  return result;
}

function optionalText(value: unknown, maximum: number) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, maximum) : null;
}

function nonnegativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  const result = Math.floor(finiteNumber(value));
  return Math.max(0, Math.min(result, maximum));
}

function validUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function validSha256(value: unknown) {
  return /^[a-f0-9]{64}$/.test(String(value || ''));
}

function validEmail(value: unknown) {
  const result = String(value || '').trim().toLowerCase();
  return result.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result);
}

function validTier(value: unknown) {
  const result = String(value || '').trim().toLowerCase();
  return ['standard', 'medium', 'premium'].includes(result) ? result : null;
}

function sanitizeTelemetry(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (depth >= 3) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeTelemetry(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonObject).slice(0, 30).map(([key, child]) => [
        key.slice(0, 80),
        TELEMETRY_SENSITIVE_KEY.test(key) ? '[redacted]' : sanitizeTelemetry(child, depth + 1),
      ]),
    );
  }
  return String(value).slice(0, 180);
}

function finiteNumber(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function positiveInteger(value: unknown, fallback: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function stringMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const number = finiteNumber(raw);
    if (number > 0) output[key] = number;
  }
  return output;
}

function validClaimId(value: unknown) {
  return /^[a-zA-Z0-9_-]{16,96}$/.test(String(value || ''));
}

function escapeLikePrefix(value: string) {
  return value.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_');
}

function decodeKvCursor(value: unknown) {
  const cursor = String(value || '');
  if (!cursor || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return '';
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8').slice(0, 1024);
  } catch {
    return '';
  }
}

function encodeKvCursor(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function failureSummary(error: unknown, fallback: string) {
  if (!error || typeof error !== 'object') return fallback;
  const name = optionalText((error as { name?: unknown }).name, 80) || 'Error';
  const code = optionalText((error as { code?: unknown }).code, 80);
  return code ? `${name}:${code}` : name;
}

export class PostgresKv {
  async get(key: string, type?: 'text' | 'json') {
    const sql = db();
    const rows = await sql<{ value: string }[]>`
      select value
        from deckaura.kv_store
       where key = ${String(key)}
         and (expires_at is null or expires_at > clock_timestamp())
       limit 1
    `;
    if (!rows.length) return null;
    if (type === 'json') {
      try {
        return JSON.parse(rows[0].value);
      } catch {
        return null;
      }
    }
    return rows[0].value;
  }

  async put(key: string, value: string, options: KvPutOptions = {}) {
    const sql = db();
    const now = Date.now();
    const expiresAt = options.expirationTtl
      ? new Date(now + Math.max(1, options.expirationTtl) * 1000)
      : options.expiration
        ? new Date(options.expiration * 1000)
        : null;
    await sql`
      insert into deckaura.kv_store(key, value, expires_at)
      values (${String(key)}, ${String(value)}, ${expiresAt})
      on conflict (key) do update
        set value = excluded.value,
            expires_at = excluded.expires_at,
            updated_at = clock_timestamp()
    `;
  }

  async delete(key: string) {
    const sql = db();
    await sql`delete from deckaura.kv_store where key = ${String(key)}`;
  }

  async getWithMetadata(key: string, type: 'arrayBuffer') {
    if (type !== 'arrayBuffer') return { value: null, metadata: null, cacheStatus: null };
    const stored = await this.get(key);
    if (typeof stored !== 'string' || !stored.startsWith('base64:')) {
      return { value: null, metadata: null, cacheStatus: null };
    }
    const encoded = stored.slice('base64:'.length).replace(/\s+/g, '');
    if (!encoded || encoded.length > 24 * 1024 * 1024 || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      return { value: null, metadata: null, cacheStatus: null };
    }
    try {
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length) return { value: null, metadata: null, cacheStatus: null };
      const value = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return {
        value,
        metadata: { contentType: 'image/jpeg' },
        cacheStatus: null,
      };
    } catch {
      return { value: null, metadata: null, cacheStatus: null };
    }
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const sql = db();
    const prefix = String(options.prefix || '');
    const limit = Math.max(1, Math.min(1000, options.limit || 1000));
    const afterKey = decodeKvCursor(options.cursor);
    const pattern = `${escapeLikePrefix(prefix)}%`;
    const rows = await sql<{ key: string; expires_at: Date | null }[]>`
      select key, expires_at
        from deckaura.kv_store
       where key like ${pattern} escape '!'
         and key > ${afterKey}
         and (expires_at is null or expires_at > clock_timestamp())
       order by key
       limit ${limit + 1}
    `;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      keys: page.map((row) => ({
        name: row.key,
        expiration: row.expires_at ? Math.floor(row.expires_at.getTime() / 1000) : undefined,
      })),
      list_complete: !hasMore,
      cursor: hasMore && page.length ? encodeKvCursor(page[page.length - 1].key) : undefined,
      cacheStatus: null,
    };
  }
}

async function entitlementAction(name: string, body: Record<string, unknown>) {
  const sql = db();
  return sql.begin(async (transaction) => {
    const now = Date.now();
    await transaction`
      insert into deckaura.limiter_states(name, state, expires_at)
      values (${name}, '{}'::jsonb, ${new Date(now + DAY_MS)})
      on conflict (name) do nothing
    `;
    const rows = await transaction<{ state: LimiterState; expires_at: Date | null }[]>`
      select state, expires_at
        from deckaura.limiter_states
       where name = ${name}
       for update
    `;
    let state: LimiterState = rows[0]?.state && typeof rows[0].state === 'object' ? { ...rows[0].state } : {};
    if (rows[0]?.expires_at && rows[0].expires_at.getTime() <= now) state = {};

    const action = String(body.action || '').trim().toLowerCase();
    const claimId = String(body.claimId || '').trim();
    let expiresAt = new Date(now + DAY_MS);
    let result: Record<string, unknown>;

    if (['claim-paid-generation', 'release-paid-generation', 'commit-paid-generation'].includes(action)) {
      if (!validClaimId(claimId)) return { error: 'invalid claimId', status: 400 };
      const completedAt = finiteNumber(state.paidGenerationCompletedAt);
      let activeClaimId = String(state.paidGenerationClaimId || '');
      let activeClaimedAt = finiteNumber(state.paidGenerationClaimedAt);
      if (activeClaimId && (!activeClaimedAt || now - activeClaimedAt >= PAID_CLAIM_MS)) {
        delete state.paidGenerationClaimId;
        delete state.paidGenerationClaimedAt;
        activeClaimId = '';
        activeClaimedAt = 0;
      }
      if (action === 'claim-paid-generation') {
        if (completedAt) result = { allowed: false, reason: 'generation_complete', completedAt };
        else if (activeClaimId === claimId) result = { allowed: true, idempotent: true };
        else if (activeClaimId) result = { allowed: false, reason: 'generation_in_progress' };
        else {
          state.paidGenerationClaimId = claimId;
          state.paidGenerationClaimedAt = now;
          result = { allowed: true };
        }
      } else if (action === 'commit-paid-generation' && completedAt) {
        result = { allowed: true, completedAt, idempotent: true };
      } else if (activeClaimId !== claimId) {
        result = { allowed: false, reason: completedAt ? 'generation_complete' : 'claim_mismatch' };
      } else if (action === 'release-paid-generation') {
        delete state.paidGenerationClaimId;
        delete state.paidGenerationClaimedAt;
        result = { allowed: true };
      } else {
        state.paidGenerationCompletedAt = now;
        delete state.paidGenerationClaimId;
        delete state.paidGenerationClaimedAt;
        result = { allowed: true, completedAt: now };
      }
    } else if (['claim-usage', 'release-usage', 'commit-usage'].includes(action)) {
      if (!validClaimId(claimId)) return { error: 'invalid claimId', status: 400 };
      const cap = positiveInteger(body.cap, 1, 1000);
      const initialUsed = Math.max(0, Math.min(cap, finiteNumber(body.initialUsed)));
      let used = Math.max(finiteNumber(state.usageUsed), initialUsed);
      let activeClaimId = String(state.usageClaimId || '');
      let activeClaimedAt = finiteNumber(state.usageClaimedAt);
      const committedClaims = stringMap(state.usageCommittedClaims);
      expiresAt = new Date(now + 45 * DAY_MS);
      if (activeClaimId && (!activeClaimedAt || now - activeClaimedAt >= PAID_CLAIM_MS)) {
        delete state.usageClaimId;
        delete state.usageClaimedAt;
        activeClaimId = '';
        activeClaimedAt = 0;
      }
      if (action === 'claim-usage') {
        if (Object.hasOwn(committedClaims, claimId)) result = { allowed: true, used, cap, remaining: Math.max(0, cap - used), idempotent: true, committed: true };
        else if (activeClaimId === claimId) result = { allowed: true, used, cap, remaining: Math.max(0, cap - used), idempotent: true, inProgress: true };
        else if (activeClaimId) result = { allowed: false, reason: 'usage_in_progress', used, cap, remaining: Math.max(0, cap - used) };
        else if (used >= cap) result = { allowed: false, reason: 'usage_limit', used, cap, remaining: 0 };
        else {
          state.usageUsed = used;
          state.usageClaimId = claimId;
          state.usageClaimedAt = now;
          result = { allowed: true, used, cap, remaining: Math.max(0, cap - used) };
        }
      } else if (action === 'commit-usage' && Object.hasOwn(committedClaims, claimId)) {
        result = { allowed: true, used, cap, remaining: Math.max(0, cap - used), idempotent: true };
      } else if (activeClaimId !== claimId) {
        result = { allowed: false, reason: 'claim_mismatch', used, cap, remaining: Math.max(0, cap - used) };
      } else if (action === 'release-usage') {
        delete state.usageClaimId;
        delete state.usageClaimedAt;
        result = { allowed: true, used, cap, remaining: Math.max(0, cap - used) };
      } else {
        used += 1;
        committedClaims[claimId] = now;
        const committedIds = Object.keys(committedClaims).sort((a, b) => committedClaims[b] - committedClaims[a]);
        for (let index = 64; index < committedIds.length; index += 1) delete committedClaims[committedIds[index]];
        state.usageUsed = used;
        state.usageCommittedClaims = committedClaims;
        delete state.usageClaimId;
        delete state.usageClaimedAt;
        result = { allowed: true, used, cap, remaining: Math.max(0, cap - used) };
      }
    } else if (['claim-budget', 'release-budget', 'commit-budget', 'status-budget'].includes(action)) {
      if (action !== 'status-budget' && !validClaimId(claimId)) return { error: 'invalid claimId', status: 400 };
      const cap = positiveInteger(body.cap, 1, 100000);
      const requestedKind = String(body.budgetKind || '').trim().toLowerCase();
      const budgetKind = ['global', 'device', 'visitor', 'network'].includes(requestedKind) ? requestedKind : 'network';
      const claims = stringMap(state.budgetClaims);
      const committedClaims = stringMap(state.budgetCommittedClaims);
      for (const [activeId, claimedAt] of Object.entries(claims)) {
        if (!claimedAt || now - claimedAt >= CLAIM_MS) delete claims[activeId];
      }
      for (const [committedId, committedAt] of Object.entries(committedClaims)) {
        if (!committedAt || now - committedAt >= DAY_MS) delete committedClaims[committedId];
      }
      let used = Object.keys(committedClaims).length;
      const nextAt = Math.min(
        ...Object.values(committedClaims).map((committedAt) => committedAt + DAY_MS),
        ...Object.values(claims).map((claimedAt) => claimedAt + CLAIM_MS),
        now + DAY_MS,
      );
      if (action === 'status-budget') {
        result = {
          allowed: used + Object.keys(claims).length < cap,
          used,
          cap,
          remaining: Math.max(0, cap - used - Object.keys(claims).length),
          nextAt,
        };
      } else if (action === 'claim-budget') {
        if (Object.hasOwn(claims, claimId)) result = { allowed: true, used, cap, nextAt };
        else if (used + Object.keys(claims).length >= cap) result = {
          allowed: false,
          reason: budgetKind === 'global' ? 'global_daily_limit' : budgetKind === 'device' ? 'device_rate_limit' : budgetKind === 'visitor' ? 'visitor_rate_limit' : 'network_rate_limit',
          used,
          cap,
          nextAt,
        };
        else {
          claims[claimId] = now;
          result = { allowed: true, used, cap, nextAt, remaining: Math.max(0, cap - used - Object.keys(claims).length) };
        }
      } else if (action === 'commit-budget' && Object.hasOwn(committedClaims, claimId)) {
        result = { allowed: true, used, cap, nextAt, idempotent: true };
      } else if (!Object.hasOwn(claims, claimId)) {
        result = { allowed: false, reason: 'claim_mismatch', used, cap, nextAt };
      } else {
        delete claims[claimId];
        if (action === 'commit-budget') {
          committedClaims[claimId] = now;
          used = Object.keys(committedClaims).length;
        }
        result = { allowed: true, used, cap, nextAt: action === 'commit-budget' ? now + DAY_MS : nextAt, remaining: Math.max(0, cap - used - Object.keys(claims).length) };
      }
      state.budgetUsed = used;
      state.budgetClaims = claims;
      state.budgetCommittedClaims = committedClaims;
      delete state.budgetWindowAt;
      expiresAt = new Date(now + DAY_MS);
    } else {
      let consumedAt = finiteNumber(state.consumedAt);
      if (consumedAt && now - consumedAt >= DAY_MS) {
        state = {};
        consumedAt = 0;
      }
      let previewUsedAt = finiteNumber(state.previewUsedAt);
      let previewGrantedAt = finiteNumber(state.previewGrantedAt);
      let previewClaimId = String(state.previewClaimId || '');
      let previewClaimedAt = finiteNumber(state.previewClaimedAt);
      const committedClaimId = String(state.previewCommittedClaimId || '');
      if (previewClaimId && (!previewClaimedAt || now - previewClaimedAt >= CLAIM_MS)) {
        delete state.previewClaimId;
        delete state.previewClaimedAt;
        previewClaimId = '';
        previewClaimedAt = 0;
      }
      if (action === 'consume' && !consumedAt) {
        consumedAt = now;
        state.consumedAt = now;
        state.previewGrantedAt = now;
        delete state.previewUsedAt;
        delete state.previewClaimId;
        delete state.previewClaimedAt;
        delete state.previewCommittedClaimId;
        result = { allowed: true, consumedAt, nextAt: consumedAt + DAY_MS, previewAvailable: true };
      } else if (['claim-preview', 'release-preview', 'commit-preview'].includes(action)) {
        if (!validClaimId(claimId)) return { error: 'invalid claimId', status: 400 };
        if (action === 'claim-preview') {
          if (!consumedAt) {
            consumedAt = now;
            previewGrantedAt = now;
            state.consumedAt = now;
            state.previewGrantedAt = now;
            delete state.previewUsedAt;
            delete state.previewClaimId;
            delete state.previewClaimedAt;
            delete state.previewCommittedClaimId;
          }
          if (previewGrantedAt !== consumedAt || previewUsedAt) result = { allowed: false, reason: 'preview_used', consumedAt, nextAt: consumedAt + DAY_MS };
          else if (previewClaimId && previewClaimId !== claimId) result = { allowed: false, reason: 'preview_in_progress', consumedAt, nextAt: consumedAt + DAY_MS };
          else {
            state.previewClaimId = claimId;
            state.previewClaimedAt = now;
            result = { allowed: true, consumedAt, nextAt: consumedAt + DAY_MS };
          }
        } else if (action === 'commit-preview' && committedClaimId === claimId && previewUsedAt) {
          result = { allowed: true, consumedAt, previewUsedAt, nextAt: consumedAt + DAY_MS, idempotent: true };
        } else if (previewClaimId !== claimId) {
          result = { allowed: false, reason: previewUsedAt ? 'preview_used' : 'claim_mismatch', consumedAt: consumedAt || undefined, nextAt: consumedAt ? consumedAt + DAY_MS : undefined };
        } else if (action === 'release-preview') {
          delete state.previewClaimId;
          delete state.previewClaimedAt;
          result = { allowed: true, consumedAt, nextAt: consumedAt + DAY_MS };
        } else if (!consumedAt) {
          delete state.previewClaimId;
          delete state.previewClaimedAt;
          result = { allowed: false, reason: 'entitlement_required' };
        } else {
          previewUsedAt = now;
          state.previewUsedAt = now;
          state.previewCommittedClaimId = claimId;
          delete state.previewClaimId;
          delete state.previewClaimedAt;
          result = { allowed: true, consumedAt, previewUsedAt, nextAt: consumedAt + DAY_MS };
        }
      } else if (action === 'status' || action === 'consume') {
        result = {
          allowed: !consumedAt,
          consumedAt: consumedAt || undefined,
          nextAt: consumedAt ? consumedAt + DAY_MS : undefined,
          previewAvailable: Boolean(consumedAt && previewGrantedAt === consumedAt && !previewUsedAt && !previewClaimId),
        };
      } else {
        return { error: 'invalid action', status: 400 };
      }
      expiresAt = new Date((consumedAt || now) + DAY_MS);
    }

    await transaction`
      update deckaura.limiter_states
         set state = ${transaction.json(state as never)},
             expires_at = ${expiresAt},
             updated_at = clock_timestamp()
       where name = ${name}
    `;
    return { ...result, status: 200 };
  });
}

class PostgresLimiterNamespace {
  getByName(name: string) {
    return {
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        } catch {
          return Response.json({ error: 'invalid json' }, { status: 400 });
        }
        try {
          const result = await entitlementAction(String(name), body);
          const { status: rawStatus, ...payload } = result;
          const status = finiteNumber(rawStatus, 200);
          return Response.json(payload, { status });
        } catch (error) {
          console.error({ event: 'limiter_database_error', errorCode: error instanceof Error ? error.name : 'DATABASE_ERROR' });
          return Response.json({ error: 'limiter unavailable' }, { status: 503 });
        }
      },
    };
  }
}

export class PostgresAiBudgets {
  async claim(input: AiBudgetClaimInput) {
    if (!validUuid(input.claimId)) throw new Error('Invalid AI budget claim ID');
    const sql = db();
    const rows = await sql<{ result: JsonObject }[]>`
      select deckaura.claim_ai_budget(
        ${input.claimId}::uuid,
        ${boundedText(input.budgetKey, 96, 'AI budget key')},
        ${boundedText(input.feature, 96, 'AI feature')},
        ${boundedText(input.model, 128, 'AI model')},
        ${nonnegativeInteger(input.reserveMicros)},
        ${Math.max(1, nonnegativeInteger(input.dailyCapMicros))},
        ${Math.max(30, Math.min(nonnegativeInteger(input.ttlSeconds ?? 600), 900))}
      ) as result
    `;
    return rows[0]?.result || { allowed: false, reason: 'budget_unavailable' };
  }

  async settle(claimId: string, commit: boolean, actualCostMicros = 0) {
    if (!validUuid(claimId)) throw new Error('Invalid AI budget claim ID');
    const sql = db();
    const rows = await sql<{ result: JsonObject }[]>`
      select deckaura.settle_ai_budget(
        ${claimId}::uuid,
        ${Boolean(commit)},
        ${nonnegativeInteger(actualCostMicros)}
      ) as result
    `;
    return rows[0]?.result || { allowed: false, reason: 'budget_unavailable' };
  }
}

function validatedFreeReadingBudgets(input: FreeReadingBudgetInput[]) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) {
    throw new Error('Invalid free-reading budgets');
  }
  const seen = new Set<string>();
  return input.map((budget) => {
    const name = String(budget?.name || '').trim();
    const kind = String(budget?.kind || '').trim().toLowerCase();
    const cap = positiveInteger(budget?.cap, 0, 100_000);
    if (
      !/^(visitor|device|network|global):[a-zA-Z0-9_-]{8,80}$/.test(name)
      || !['visitor', 'device', 'network', 'global'].includes(kind)
      || name.split(':', 1)[0] !== kind
      || cap < 1
      || seen.has(name)
    ) {
      throw new Error('Invalid free-reading budget');
    }
    seen.add(name);
    return { name, kind, cap };
  });
}

export class PostgresFreeReadingBudgets {
  async claim(claimId: string, input: FreeReadingBudgetInput[]) {
    if (!validUuid(claimId)) throw new Error('Invalid free-reading claim ID');
    const budgets = validatedFreeReadingBudgets(input);
    const sql = db();
    const rows = await sql<Array<{ result: JsonObject }>>`
      select deckaura.claim_free_reading_budgets(
        ${claimId}::uuid,
        ${sql.json(budgets as never)},
        120
      ) as result
    `;
    return rows[0]?.result || { allowed: false, reason: 'limiter_unavailable' };
  }

  async settle(claimId: string, commit: boolean) {
    if (!validUuid(claimId)) throw new Error('Invalid free-reading claim ID');
    const sql = db();
    const rows = await sql<Array<{ result: JsonObject }>>`
      select deckaura.settle_free_reading_budgets(
        ${claimId}::uuid,
        ${Boolean(commit)}
      ) as result
    `;
    return rows[0]?.result || { allowed: false, reason: 'limiter_unavailable' };
  }

  async status(input: FreeReadingBudgetInput[]) {
    const budgets = validatedFreeReadingBudgets(input);
    const sql = db();
    const rows = await sql<Array<{ result: JsonObject }>>`
      select deckaura.status_free_reading_budgets(
        ${sql.json(budgets as never)}
      ) as result
    `;
    return rows[0]?.result || { allowed: false, reason: 'limiter_unavailable' };
  }
}

export class PostgresAiUsage {
  async record(input: AiUsageEventInput) {
    const claimId = input.claimId == null ? null : String(input.claimId);
    if (claimId && !validUuid(claimId)) throw new Error('Invalid AI usage claim ID');
    const metadata = sanitizeTelemetry(input.metadata || {}) as JsonObject;
    const sql = db();
    const rows = await sql<{ id: string }[]>`
      select deckaura.record_ai_usage(
        ${boundedText(input.idempotencyKey, 192, 'AI usage idempotency key', 8)},
        ${claimId}::uuid,
        ${boundedText(input.requestId, 192, 'AI request ID', 8)},
        ${boundedText(input.feature, 96, 'AI feature')},
        ${optionalText(input.route, 160)},
        ${boundedText(input.provider, 64, 'AI provider')},
        ${boundedText(input.model, 128, 'AI model')},
        ${input.status},
        ${optionalText(input.locale, 24)},
        ${optionalText(input.page, 240)},
        ${nonnegativeInteger(input.inputTokens, 2_000_000)},
        ${nonnegativeInteger(input.outputTokens, 2_000_000)},
        ${nonnegativeInteger(input.cachedInputTokens, 2_000_000)},
        ${nonnegativeInteger(input.costMicros)},
        ${nonnegativeInteger(input.latencyMs, 3_600_000)},
        ${nonnegativeInteger(input.retryCount, 10)},
        ${optionalText(input.fallbackFrom, 128)},
        ${sql.json(metadata as never)}
      ) as id
    `;
    return rows[0]?.id || null;
  }
}

export class PostgresDeliveryRetry {
  async claimDispatcherLease(name: string, leaseSeconds = 840) {
    const sql = db();
    const rows = await sql<{ result: JsonObject }[]>`
      select deckaura.claim_worker_dispatch_lease(
        ${boundedText(name, 80, 'dispatcher lease name')},
        ${Math.max(60, Math.min(nonnegativeInteger(leaseSeconds), 900))}
      ) as result
    `;
    return rows[0]?.result || { allowed: false, reason: 'queue_unavailable' };
  }

  async releaseDispatcherLease(name: string, leaseToken: string) {
    if (!validUuid(leaseToken)) throw new Error('Invalid dispatcher lease token');
    const sql = db();
    const rows = await sql<{ released: boolean }[]>`
      select deckaura.release_worker_dispatch_lease(
        ${boundedText(name, 80, 'dispatcher lease name')},
        ${leaseToken}::uuid
      ) as released
    `;
    return rows[0]?.released === true;
  }

  async enqueueShopifyWebhook(input: ShopifyWebhookEnvelope) {
    const serialized = JSON.stringify(input.payload);
    if (new TextEncoder().encode(serialized).byteLength > 1_048_576) {
      throw new Error('Shopify webhook payload is too large');
    }
    const sql = db();
    const rows = await sql<{ result: JsonObject }[]>`
      select deckaura.enqueue_shopify_webhook_event(
        ${boundedText(input.webhookId, 192, 'Shopify webhook ID', 8)},
        ${optionalText(input.eventId, 192)},
        ${boundedText(input.topic, 128, 'Shopify webhook topic')},
        ${optionalText(input.orderId, 96)},
        ${boundedText(input.payloadSha256, 128, 'Shopify payload hash', 32)},
        ${sql.json(input.payload as never)}
      ) as result
    `;
    return rows[0]?.result || { accepted: false, reason: 'queue_unavailable' };
  }

  async claimShopifyWebhooks(workerId: string, batchSize = 10, leaseSeconds = 60) {
    const sql = db();
    return sql<WebhookQueueRow[]>`
      select * from deckaura.claim_shopify_webhook_events(
        ${boundedText(workerId, 128, 'webhook worker ID')},
        ${Math.max(1, Math.min(nonnegativeInteger(batchSize), 50))},
        ${Math.max(30, Math.min(nonnegativeInteger(leaseSeconds), 900))}
      )
    `;
  }

  async completeShopifyWebhook(webhookId: string, leaseToken: string) {
    if (!validUuid(leaseToken)) throw new Error('Invalid webhook lease token');
    const sql = db();
    const rows = await sql<{ result: JsonObject }[]>`
      select deckaura.complete_shopify_webhook_event(
        ${boundedText(webhookId, 192, 'Shopify webhook ID', 8)},
        ${leaseToken}::uuid
      ) as result
    `;
    return rows[0]?.result || { allowed: false, reason: 'queue_unavailable' };
  }

  async failShopifyWebhook(webhookId: string, leaseToken: string, error: unknown) {
    if (!validUuid(leaseToken)) throw new Error('Invalid webhook lease token');
    const sql = db();
    const rows = await sql<{ result: JsonObject }[]>`
      select deckaura.fail_shopify_webhook_event(
        ${boundedText(webhookId, 192, 'Shopify webhook ID', 8)},
        ${leaseToken}::uuid,
        ${failureSummary(error, 'webhook processing failed')}
      ) as result
    `;
    return rows[0]?.result || { allowed: false, reason: 'queue_unavailable' };
  }

  async enqueueDelivery(input: {
    orderId: string;
    jobType: DeliveryJobRow['job_type'];
    dueAt: Date;
    idempotencyKey: string;
    maxRetries?: number;
  }) {
    if (!(input.dueAt instanceof Date) || !Number.isFinite(input.dueAt.getTime())) throw new Error('Invalid delivery due date');
    const sql = db();
    const rows = await sql<DeliveryJobRow[]>`
      select * from deckaura.enqueue_delivery_job(
        ${boundedText(input.orderId, 96, 'delivery order ID')},
        ${input.jobType},
        ${input.dueAt},
        ${boundedText(input.idempotencyKey, 192, 'delivery idempotency key', 8)},
        ${Math.max(0, Math.min(nonnegativeInteger(input.maxRetries ?? 3), 3))}
      )
    `;
    return rows[0] || null;
  }

  async claimDeliveries(workerId: string, batchSize = 5, leaseSeconds = 300) {
    const sql = db();
    return sql<DeliveryJobRow[]>`
      select * from deckaura.claim_delivery_jobs(
        ${boundedText(workerId, 128, 'delivery worker ID')},
        ${Math.max(1, Math.min(nonnegativeInteger(batchSize), 20))},
        ${Math.max(30, Math.min(nonnegativeInteger(leaseSeconds), 900))}
      )
    `;
  }

  async extendDeliveryLease(jobId: string, leaseToken: string, leaseSeconds = 90) {
    if (!validUuid(jobId) || !validUuid(leaseToken)) throw new Error('Invalid delivery lease');
    const sql = db();
    const rows = await sql<{ result: JsonObject }[]>`
      select deckaura.extend_delivery_job_lease(
        ${jobId}::uuid,
        ${leaseToken}::uuid,
        ${Math.max(30, Math.min(nonnegativeInteger(leaseSeconds), 180))}
      ) as result
    `;
    return rows[0]?.result || { allowed: false, reason: 'queue_unavailable' };
  }

  async completeDelivery(jobId: string, leaseToken: string, providerMessageId?: string, resultMetadata: JsonObject = {}) {
    if (!validUuid(jobId) || !validUuid(leaseToken)) throw new Error('Invalid delivery lease');
    const sql = db();
    const rows = await sql<{ result: JsonObject }[]>`
      select deckaura.complete_delivery_job(
        ${jobId}::uuid,
        ${leaseToken}::uuid,
        ${optionalText(providerMessageId, 256)},
        ${sql.json(sanitizeTelemetry(resultMetadata) as never)}
      ) as result
    `;
    return rows[0]?.result || { allowed: false, reason: 'queue_unavailable' };
  }

  async failDelivery(jobId: string, leaseToken: string, error: unknown) {
    if (!validUuid(jobId) || !validUuid(leaseToken)) throw new Error('Invalid delivery lease');
    const sql = db();
    const rows = await sql<{ result: JsonObject }[]>`
      select deckaura.fail_delivery_job(
        ${jobId}::uuid,
        ${leaseToken}::uuid,
        ${failureSummary(error, 'delivery failed')}
      ) as result
    `;
    return rows[0]?.result || { allowed: false, reason: 'queue_unavailable' };
  }
}

export class PostgresFunnelStore {
  async recordEvents(visitorHash: string | null, inputEvents: FunnelEventInput[]) {
    if (visitorHash != null && !validSha256(visitorHash)) throw new Error('Invalid funnel visitor hash');
    const events = Array.isArray(inputEvents) ? inputEvents.slice(0, 20) : [];
    if (!events.length) return { accepted: 0, duplicate: 0, limited: false };
    const sql = db();
    return sql.begin(async (transaction) => {
      if (visitorHash) {
        const rows = await transaction<Array<{ count: number }>>`
          select count(*)::integer as count
            from deckaura.funnel_events
           where visitor_hash = ${visitorHash}
             and created_at >= clock_timestamp() - interval '24 hours'
        `;
        if (Number(rows[0]?.count) >= 250) return { accepted: 0, duplicate: 0, limited: true };
      }

      let accepted = 0;
      for (const event of events) {
        if (!validUuid(event.eventId)) throw new Error('Invalid funnel event ID');
        const conversationId = validUuid(event.conversationId) ? String(event.conversationId) : null;
        const occurredAtMs = Date.parse(String(event.occurredAt || ''));
        const occurredAt = Number.isFinite(occurredAtMs)
          && Math.abs(Date.now() - occurredAtMs) <= 7 * DAY_MS
          ? new Date(occurredAtMs)
          : null;
        const revenue = event.revenue == null ? null : Math.max(0, Math.min(finiteNumber(event.revenue), 9_999_999_999));
        const metadata = sanitizeTelemetry(event.metadata || {}) as JsonObject;
        const rows = await transaction<Array<{ id: number }>>`
          insert into deckaura.funnel_events(
            event_id, visitor_hash, conversation_id, reading_id, event_name,
            page, reading_mode, funnel_version, experiment_key,
            experiment_variant, recommended_tier, selected_tier,
            shopify_variant_id, order_id, revenue, currency, metadata,
            occurred_at
          ) values (
            ${event.eventId}::uuid, ${visitorHash}, ${conversationId}::uuid,
            ${optionalText(event.readingId, 128)},
            ${boundedText(event.eventName, 96, 'funnel event name')},
            ${boundedText(event.page, 160, 'funnel page')},
            ${optionalText(event.readingMode, 64)},
            ${boundedText(event.funnelVersion, 128, 'funnel version')},
            ${optionalText(event.experimentKey, 96)},
            ${optionalText(event.experimentVariant, 48)},
            ${validTier(event.recommendedTier)}, ${validTier(event.selectedTier)},
            ${optionalText(event.shopifyVariantId, 64)}, ${optionalText(event.orderId, 96)},
            ${revenue}, ${optionalText(String(event.currency || '').toUpperCase(), 3)},
            ${transaction.json(metadata as never)}, ${occurredAt}
          )
          on conflict (event_id) do nothing
          returning id
        `;
        accepted += rows.length;
      }
      return { accepted, duplicate: events.length - accepted, limited: false };
    });
  }

  async captureReadingLead(input: ReadingLeadInput) {
    if (!validEmail(input.email)) throw new Error('Invalid lead email');
    if (!validSha256(input.emailHash) || !validSha256(input.visitorHash) || !validSha256(input.previewTokenHash)) {
      throw new Error('Invalid lead identity hash');
    }
    if (!validUuid(input.conversationId)) throw new Error('Invalid lead conversation ID');
    const serialized = JSON.stringify(input.contentPayload || {});
    if (new TextEncoder().encode(serialized).byteLength > 20_000) throw new Error('Lead content is too large');
    const sql = db();
    const rows = await sql<Array<{ result: JsonObject }>>`
      select deckaura.capture_reading_lead(
        ${String(input.email).trim().toLowerCase()}, ${input.emailHash}, ${input.visitorHash},
        ${input.conversationId}::uuid, ${optionalText(input.readingId, 128)},
        ${input.previewTokenHash}, ${optionalText(input.readingMode, 64)},
        ${boundedText(input.page, 160, 'lead page')},
        ${boundedText(input.funnelVersion, 128, 'lead funnel version')},
        ${optionalText(input.experimentKey, 96)},
        ${optionalText(input.experimentVariant, 48)}, ${Boolean(input.marketingConsent)},
        ${input.marketingConsent ? boundedText(input.consentVersion, 64, 'consent version') : null},
        ${sql.json(input.contentPayload as never)}
      ) as result
    `;
    return rows[0]?.result || { leadId: null };
  }

  async unsubscribeReadingLead(token: string) {
    if (!validUuid(token)) return { ok: true, found: false };
    const sql = db();
    const rows = await sql<Array<{ result: JsonObject }>>`
      select deckaura.unsubscribe_reading_lead(${token}::uuid) as result
    `;
    return rows[0]?.result || { ok: true, found: false };
  }

  async enqueuePostPurchase(input: {
    orderId: string;
    email: string;
    emailHash: string;
    name?: string | null;
    accessToken?: string | null;
    orderCreatedAt: Date;
    payload?: JsonObject;
  }) {
    if (!validEmail(input.email) || !validSha256(input.emailHash)) throw new Error('Invalid post-purchase recipient');
    if (!(input.orderCreatedAt instanceof Date) || !Number.isFinite(input.orderCreatedAt.getTime())) {
      throw new Error('Invalid post-purchase timestamp');
    }
    const payload = sanitizeTelemetry(input.payload || {}) as JsonObject;
    const sql = db();
    const rows = await sql<Array<{ count: number }>>`
      select deckaura.enqueue_post_purchase_lifecycle(
        ${boundedText(input.orderId, 96, 'post-purchase order ID')},
        ${String(input.email).trim().toLowerCase()}, ${input.emailHash},
        ${optionalText(input.name, 80)}, ${optionalText(input.accessToken, 96)},
        ${input.orderCreatedAt}, ${sql.json(payload as never)}
      )::integer as count
    `;
    return Number(rows[0]?.count) || 0;
  }

  async claimLifecycleEmails(workerId: string, batchSize = 10, leaseSeconds = 90) {
    const sql = db();
    return sql<LifecycleEmailJobRow[]>`
      select jobs.*, leads.content_payload
        from deckaura.claim_lifecycle_email_jobs(
          ${boundedText(workerId, 128, 'lifecycle worker ID')},
          ${Math.max(1, Math.min(nonnegativeInteger(batchSize), 25))},
          ${Math.max(30, Math.min(nonnegativeInteger(leaseSeconds), 300))}
        ) as jobs
        left join deckaura.reading_leads as leads on leads.id = jobs.lead_id
       order by jobs.due_at, jobs.id
    `;
  }

  async completeLifecycleEmail(jobId: number, leaseToken: string, providerMessageId?: string | null) {
    if (!validUuid(leaseToken)) throw new Error('Invalid lifecycle email lease');
    const sql = db();
    const rows = await sql<Array<{ result: JsonObject }>>`
      select deckaura.complete_lifecycle_email_job(
        ${nonnegativeInteger(jobId)}::bigint, ${leaseToken}::uuid,
        ${optionalText(providerMessageId, 256)}
      ) as result
    `;
    return rows[0]?.result || { allowed: false, reason: 'queue_unavailable' };
  }

  async failLifecycleEmail(jobId: number, leaseToken: string, error: unknown) {
    if (!validUuid(leaseToken)) throw new Error('Invalid lifecycle email lease');
    const sql = db();
    const rows = await sql<Array<{ result: JsonObject }>>`
      select deckaura.fail_lifecycle_email_job(
        ${nonnegativeInteger(jobId)}::bigint, ${leaseToken}::uuid,
        ${failureSummary(error, 'lifecycle email failed')}
      ) as result
    `;
    return rows[0]?.result || { allowed: false, reason: 'queue_unavailable' };
  }

  async cleanup(limit = 5000) {
    const sql = db();
    const rows = await sql<Array<{ result: JsonObject }>>`
      select deckaura.cleanup_funnel_state(${Math.max(1, Math.min(nonnegativeInteger(limit), 20_000))}) as result
    `;
    return rows[0]?.result || {};
  }
}

const readingsCache = new PostgresKv();
const freeEntitlements = new PostgresLimiterNamespace();
export const freeReadingBudgets = new PostgresFreeReadingBudgets();
export const aiBudgets = new PostgresAiBudgets();
export const aiUsage = new PostgresAiUsage();
export const deliveryRetry = new PostgresDeliveryRetry();
export const funnelStore = new PostgresFunnelStore();

export function workerEnvironment() {
  return {
    ...process.env,
    // Keep security-sensitive runtime variables explicit. Next.js/Vercel can
    // statically optimize process.env access, while a dynamic spread alone is
    // not a reliable way to carry system-provided OIDC credentials.
    VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    DEEPSEEK_DIRECT_API_KEY: process.env.DEEPSEEK_DIRECT_API_KEY || process.env.DEEPSEEK_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    FREE_AI_DAILY_BUDGET_USD: process.env.FREE_AI_DAILY_BUDGET_USD,
    SHOPIFY_STORE: process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
    SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
    SHOPIFY_ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN,
    SHOPIFY_WEBHOOK_SECRET: process.env.SHOPIFY_WEBHOOK_SECRET,
    ENTITLEMENT_PEPPER: process.env.ENTITLEMENT_PEPPER,
    MEMBER_SIGNING_SECRET: process.env.MEMBER_SIGNING_SECRET,
    NL_SECRET: process.env.NL_SECRET,
    NL_SENDONE_URL: process.env.NL_SENDONE_URL,
    READING_SERVICE_ORIGIN: process.env.READING_SERVICE_ORIGIN,
    READING_DELAY_MIN: process.env.READING_DELAY_MIN,
    READING_DELAY_MAX: process.env.READING_DELAY_MAX,
    READINGS_CACHE: readingsCache,
    FREE_ENTITLEMENTS: freeEntitlements,
    FREE_READING_BUDGETS: freeReadingBudgets,
    AI_BUDGETS: aiBudgets,
    AI_USAGE: aiUsage,
    DELIVERY_RETRY: deliveryRetry,
    FUNNEL_STORE: funnelStore,
  };
}
