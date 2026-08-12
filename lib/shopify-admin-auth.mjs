const TOKEN_EXPIRY_SAFETY_MS = 5 * 60 * 1000;
const tokenCache = new Map();
const tokenRefreshes = new Map();

function boundedSecret(value, maximum = 2048) {
  const result = String(value || "").trim();
  return result && result.length <= maximum ? result : "";
}

export function shopifyStoreDomain(env = {}) {
  const raw = boundedSecret(env.SHOPIFY_STORE || env.SHOPIFY_STORE_DOMAIN, 255).toLowerCase();
  if (!raw) throw new Error("SHOPIFY_STORE_MISSING");
  let domain = raw;
  if (/^https?:\/\//.test(domain)) {
    let parsed;
    try {
      parsed = new URL(domain);
    } catch {
      throw new Error("SHOPIFY_STORE_INVALID");
    }
    if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
      throw new Error("SHOPIFY_STORE_INVALID");
    }
    domain = parsed.hostname;
  }
  domain = domain.replace(/\/+$/, "");
  if (/^[a-z0-9][a-z0-9-]*$/.test(domain)) domain += ".myshopify.com";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new Error("SHOPIFY_STORE_INVALID");
  }
  return domain;
}

function clientCredentials(env = {}) {
  const clientId = boundedSecret(env.SHOPIFY_CLIENT_ID, 512);
  const clientSecret = boundedSecret(env.SHOPIFY_CLIENT_SECRET, 2048);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function cacheKey(env, credentials) {
  return `${shopifyStoreDomain(env)}\n${credentials.clientId}`;
}

function tokenError(code, status = 0) {
  const error = new Error(code);
  error.code = code;
  if (status) error.upstreamStatus = status;
  return error;
}

async function exchangeClientCredentials(env, credentials) {
  const store = shopifyStoreDomain(env);
  const response = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret
    })
  });
  if (!response.ok) throw tokenError(`SHOPIFY_TOKEN_HTTP_${response.status}`, response.status);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw tokenError("SHOPIFY_TOKEN_RESPONSE_INVALID");
  }
  const accessToken = boundedSecret(payload && payload.access_token);
  const expiresIn = Number(payload && payload.expires_in);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw tokenError("SHOPIFY_TOKEN_RESPONSE_INVALID");
  }
  const ttlMs = expiresIn * 1000;
  return {
    accessToken,
    expiresAt: Date.now() + Math.max(0, ttlMs - Math.min(TOKEN_EXPIRY_SAFETY_MS, ttlMs * 0.1))
  };
}

export async function getShopifyAdminAccessToken(env = {}, options = {}) {
  const credentials = clientCredentials(env);
  if (!credentials) {
    const fallbackToken = boundedSecret(env.SHOPIFY_ADMIN_TOKEN);
    if (!fallbackToken) throw tokenError("SHOPIFY_ADMIN_CREDENTIALS_MISSING");
    return fallbackToken;
  }

  const key = cacheKey(env, credentials);
  if (!options.forceRefresh) {
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
  } else {
    tokenCache.delete(key);
  }
  if (tokenRefreshes.has(key)) return tokenRefreshes.get(key);

  const refresh = exchangeClientCredentials(env, credentials).then((entry) => {
    tokenCache.set(key, entry);
    return entry.accessToken;
  });
  tokenRefreshes.set(key, refresh);
  try {
    return await refresh;
  } finally {
    if (tokenRefreshes.get(key) === refresh) tokenRefreshes.delete(key);
  }
}

export function invalidateShopifyAdminAccessToken(env = {}) {
  const credentials = clientCredentials(env);
  if (credentials) tokenCache.delete(cacheKey(env, credentials));
}

export async function shopifyAdminFetch(input, init = {}, env = {}) {
  const token = await getShopifyAdminAccessToken(env);
  const headers = new Headers(init.headers || {});
  headers.set("X-Shopify-Access-Token", token);
  let response = await fetch(input, { ...init, headers });
  if (response.status !== 401 || !clientCredentials(env)) return response;

  try {
    await response.body?.cancel();
  } catch {
    // The failed response is intentionally discarded before the one allowed retry.
  }
  invalidateShopifyAdminAccessToken(env);
  const refreshedToken = await getShopifyAdminAccessToken(env, { forceRefresh: true });
  const retryHeaders = new Headers(init.headers || {});
  retryHeaders.set("X-Shopify-Access-Token", refreshedToken);
  response = await fetch(input, { ...init, headers: retryHeaders });
  return response;
}

export function resetShopifyAdminTokenCacheForTests() {
  tokenCache.clear();
  tokenRefreshes.clear();
}
