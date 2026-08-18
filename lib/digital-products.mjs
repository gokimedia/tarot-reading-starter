export const DIGITAL_DOWNLOAD_PATH = "/api/digital/download";

// Static digital goods delivered as secure downloads. Storage objects live in a
// private Supabase bucket; the repository must never contain the paid files
// because it is publicly mirrored.
export const DIGITAL_PRODUCTS = Object.freeze({
  "PDF-TAROT-MASTERY": Object.freeze({
    sku: "PDF-TAROT-MASTERY",
    slug: "tarot-mastery-course",
    title: "The Complete Tarot Mastery Course",
    bucket: "digital-products",
    storagePath: "tarot-mastery-course/v1/Deckaura-Complete-Tarot-Mastery-Course.pdf",
    downloadFilename: "Deckaura-Complete-Tarot-Mastery-Course.pdf",
    linkValidityDays: 30,
    maxDownloads: 25
  })
});

export function digitalProductForSku(sku) {
  const normalized = String(sku || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(DIGITAL_PRODUCTS, normalized)
    ? DIGITAL_PRODUCTS[normalized]
    : null;
}

export function legacyShopifyId(value) {
  const raw = String(value || "").trim();
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/\/(\d+)(?:[?#].*)?$/);
  return match ? match[1] : "";
}

// Accepts GraphQL (gid ids) or REST (numeric ids) line item shapes and keeps
// only lines that map to a configured digital product.
export function digitalOrderLines(lineItems) {
  const lines = Array.isArray(lineItems) ? lineItems : [];
  const output = [];
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const product = digitalProductForSku(line.sku);
    if (!product) continue;
    const lineItemId = legacyShopifyId(line.id);
    if (!lineItemId) continue;
    const quantity = Math.max(1, Math.floor(Number(line.quantity) || 1));
    output.push({ product, lineItemId, quantity });
  }
  return output;
}

export function digitalDownloadOrigin(env = process.env) {
  const raw = String(
    (env && (env.DIGITAL_DOWNLOAD_ORIGIN || env.READING_SERVICE_ORIGIN)) || ""
  ).trim().replace(/\/+$/, "");
  if (/^https:\/\/[a-z0-9.-]+$/i.test(raw)) return raw;
  return "https://reading.deckaura.com";
}

export function digitalDownloadUrl(origin, token) {
  const base = String(origin || "").trim().replace(/\/+$/, "");
  return `${base}${DIGITAL_DOWNLOAD_PATH}?token=${encodeURIComponent(String(token || ""))}`;
}

export function digitalTrackingLabel() {
  return "Your course is ready";
}
