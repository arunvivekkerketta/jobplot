import type { PreflightDecision, PreflightInput } from "./types.js";

/** Default spacing between action batches on one host. */
export const DEFAULT_DOMAIN_INTERVAL_MS = 30_000;

/**
 * The single stop gate every browser action batch passes through (I4).
 *
 * Order is fixed and checked before any navigation: kill switch, daily cap,
 * portal cap, per-domain rate limit, then the master submit switch. The earlier
 * a check sits, the cheaper it is to abort, and a stopped run explains itself in
 * exactly one reason code.
 */
export function evaluatePreflight(input: PreflightInput): PreflightDecision {
  const { settings } = input;

  if (settings.killSwitch) {
    return {
      allowed: false,
      reason: "KILL_SWITCH",
      message: "Kill switch is on; no browser action may run.",
    };
  }

  if (input.submissionsToday >= settings.dailyCap) {
    return {
      allowed: false,
      reason: "DAILY_CAP",
      message: `Daily cap reached (${input.submissionsToday}/${settings.dailyCap}).`,
    };
  }

  const portalCap = input.perPortalCap;
  if (
    typeof portalCap === "number" &&
    (input.perPortalSubmissionsToday ?? 0) >= portalCap
  ) {
    return {
      allowed: false,
      reason: "PORTAL_CAP",
      message: `Per-portal cap reached (${input.perPortalSubmissionsToday ?? 0}/${portalCap}).`,
    };
  }

  const interval = input.domainMinIntervalMs ?? DEFAULT_DOMAIN_INTERVAL_MS;
  if (input.lastActionAt) {
    const elapsed = input.now.getTime() - input.lastActionAt.getTime();
    if (elapsed < interval) {
      return {
        allowed: false,
        reason: "RATE_LIMIT",
        message: `Too soon after the last action on this host (${Math.max(0, elapsed)}ms of ${interval}ms).`,
        retryAfterMs: interval - elapsed,
      };
    }
  }

  if (!settings.allowSubmit) {
    return {
      allowed: false,
      reason: "SUBMIT_DISABLED",
      message: "allowSubmit is off; the application can be prepared but not submitted.",
    };
  }

  return { allowed: true };
}