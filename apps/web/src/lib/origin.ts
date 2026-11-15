/**
 * Guards state-changing routes against cross-site form posts. Browsers send
 * `Origin` on every POST, so a mismatch between it and the request host is a
 * foreign site. A missing header is treated as same-origin, which covers
 * server-side callers and the test client.
 */
export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;

  const host = req.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}