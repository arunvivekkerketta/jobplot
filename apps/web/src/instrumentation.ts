/**
 * Next.js calls this once per server start, before any request is served. It is
 * compiled for both the Node and the Edge runtime, so the check lives in a
 * separate Node-only module: `@jobpilot/core` uses `node:crypto`, which the Edge
 * bundle cannot contain.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
