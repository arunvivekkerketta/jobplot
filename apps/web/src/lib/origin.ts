/**
 * Guards state-changing routes against cross-site form posts. Browsers send
 * `Origin` on every POST, so a mismatch between it and the request host is a
 * foreign site. A missing header is treated as same-origin, which covers
 * server-side callers and the test client.
 */
export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    // No Origin at all is normal for server-side callers and the test client, but
    // a browser that explicitly labels the request cross-site is not trusted (M1).
    const site = req.headers.get("sec-fetch-site");
    return site !== "cross-site";
  }

  const host = req.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}