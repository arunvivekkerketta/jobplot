import { createHash } from "node:crypto";

/**
 * Query parameters that identify a click, not a posting. Dropping them is what
 * lets the same role arrive from a board, an email and a manual paste and still
 * collapse onto one Job row (gate 3.10).
 */
const TRACKING_EXACT = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
  "source",
  "src",
  "lever-source",
  "gh_src",
  "ashby_source",
  "trackingid",
]);

function isTracking(name: string): boolean {
  const key = name.toLowerCase();
  return key.startsWith("utm_") || TRACKING_EXACT.has(key);
}

/**
 * Canonicalizes a posting URL so dedupe is stable: lowercases the host, drops
 * `www.`, strips default ports, tracking params, empty params and the fragment,
 * sorts the remaining params, and removes trailing slashes (gate 3.2).
 */
export function canonicalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  for (const key of [...url.searchParams.keys()]) {
    if (isTracking(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path === "" ? "/" : path;
  return url.toString();
}

/** Case- and whitespace-insensitive text used only for hashing. */
export function normalizeForHash(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Content hash of the parts that make a posting the same posting. Formatting
 * churn on a board must not look like new content; a real edit must (gate 3.3).
 */
export function contentHashOf(input: {
  title: string;
  company: string;
  descriptionText: string;
}): string {
  return createHash("sha256")
    .update(
      [
        normalizeForHash(input.title),
        normalizeForHash(input.company),
        normalizeForHash(input.descriptionText),
      ].join("\u0000"),
    )
    .digest("hex");
}
