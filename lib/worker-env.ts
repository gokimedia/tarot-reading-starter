import { db } from '@/lib/db';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLAIM_MS = 2 * 60 * 1000;
const PAID_CLAIM_MS = 10 * 60 * 1000;

type KvPutOptions = {
  expiration?: number;
  expirationTtl?: number;
};

type LimiterState = Record<string, unknown>;

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

  async list(options: { prefix?: string; limit?: number } = {}) {
    const sql = db();
    const prefix = String(options.prefix || '');
    const limit = Math.max(1, Math.min(1000, options.limit || 1000));
    const rows = await sql<{ key: string; expires_at: Date | null }[]>`
      select key, expires_at
        from deckaura.kv_store
       where key like ${`${prefix}%`}
         and (expires_at is null or expires_at > clock_timestamp())
       order by key
       limit ${limit}
    `;
    return {
      keys: rows.map((row) => ({
        name: row.key,
        expiration: row.expires_at ? Math.floor(row.expires_at.getTime() / 1000) : undefined,
      })),
      list_complete: rows.length < limit,
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
    } else if (['claim-budget', 'release-budget', 'commit-budget'].includes(action)) {
      if (!validClaimId(claimId)) return { error: 'invalid claimId', status: 400 };
      const cap = positiveInteger(body.cap, 1, 100000);
      const requestedKind = String(body.budgetKind || '').trim().toLowerCase();
      const budgetKind = requestedKind === 'global' || requestedKind === 'device' ? requestedKind : 'network';
      let windowAt = finiteNumber(state.budgetWindowAt);
      let used = finiteNumber(state.budgetUsed);
      const claims = stringMap(state.budgetClaims);
      const committedClaims = stringMap(state.budgetCommittedClaims);
      if (!windowAt || now - windowAt >= DAY_MS) {
        windowAt = now;
        used = 0;
        for (const key of Object.keys(claims)) delete claims[key];
        for (const key of Object.keys(committedClaims)) delete committedClaims[key];
      }
      for (const [activeId, claimedAt] of Object.entries(claims)) {
        if (!claimedAt || now - claimedAt >= CLAIM_MS) delete claims[activeId];
      }
      if (action === 'claim-budget') {
        if (Object.hasOwn(claims, claimId)) result = { allowed: true, used, cap, nextAt: windowAt + DAY_MS };
        else if (used + Object.keys(claims).length >= cap) result = {
          allowed: false,
          reason: budgetKind === 'global' ? 'global_daily_limit' : budgetKind === 'device' ? 'device_rate_limit' : 'network_rate_limit',
          used,
          cap,
          nextAt: windowAt + DAY_MS,
        };
        else {
          claims[claimId] = now;
          result = { allowed: true, used, cap, nextAt: windowAt + DAY_MS };
        }
      } else if (action === 'commit-budget' && Object.hasOwn(committedClaims, claimId)) {
        result = { allowed: true, used, cap, nextAt: windowAt + DAY_MS, idempotent: true };
      } else if (!Object.hasOwn(claims, claimId)) {
        result = { allowed: false, reason: 'claim_mismatch', used, cap, nextAt: windowAt + DAY_MS };
      } else {
        delete claims[claimId];
        if (action === 'commit-budget') {
          used += 1;
          committedClaims[claimId] = now;
        }
        result = { allowed: true, used, cap, nextAt: windowAt + DAY_MS };
      }
      state.budgetWindowAt = windowAt;
      state.budgetUsed = used;
      state.budgetClaims = claims;
      state.budgetCommittedClaims = committedClaims;
      expiresAt = new Date(windowAt + DAY_MS);
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

const readingsCache = new PostgresKv();
const freeEntitlements = new PostgresLimiterNamespace();

export function workerEnvironment() {
  return {
    ...process.env,
    READINGS_CACHE: readingsCache,
    FREE_ENTITLEMENTS: freeEntitlements,
  };
}
