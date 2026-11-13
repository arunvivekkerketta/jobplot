import { describe, expect, it } from "vitest";
import { DEFAULT_DOMAIN_INTERVAL_MS, evaluatePreflight } from "../src/preflight.js";
import type { StopSettings } from "../src/types.js";

const settings: StopSettings = {
  killSwitch: false,
  allowSubmit: true,
  dailyCap: 10,
  mode: "COPILOT",
};

const now = new Date("2026-01-01T12:00:00.000Z");

describe("gate 4.5: the stop gate (I4)", () => {
  it("allows the batch when every check passes", () => {
    const decision = evaluatePreflight({ settings, submissionsToday: 3, now });
    expect(decision).toEqual({ allowed: true });
  });

  it("lets the kill switch win over every other failure", () => {
    const decision = evaluatePreflight({
      settings: { ...settings, killSwitch: true },
      submissionsToday: 99,
      now,
      lastActionAt: new Date(now.getTime() - 1_000),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("KILL_SWITCH");
  });

  it("stops at the daily cap counted from submitted applications", () => {
    const decision = evaluatePreflight({ settings, submissionsToday: 10, now });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("DAILY_CAP");
      expect(decision.message).toContain("10/10");
    }
  });

  it("stops at a per-portal cap", () => {
    const decision = evaluatePreflight({
      settings,
      submissionsToday: 3,
      now,
      perPortalCap: 2,
      perPortalSubmissionsToday: 2,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("PORTAL_CAP");
  });

  it("enforces the per-domain interval and reports the remaining wait", () => {
    const decision = evaluatePreflight({
      settings,
      submissionsToday: 0,
      now,
      lastActionAt: new Date(now.getTime() - 10_000),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("RATE_LIMIT");
      expect(decision.retryAfterMs).toBe(DEFAULT_DOMAIN_INTERVAL_MS - 10_000);
    }
  });

  it("lets the batch through once the interval has elapsed", () => {
    const decision = evaluatePreflight({
      settings,
      submissionsToday: 0,
      now,
      lastActionAt: new Date(now.getTime() - DEFAULT_DOMAIN_INTERVAL_MS - 1_000),
    });
    expect(decision).toEqual({ allowed: true });
  });

  it("checks the master submit switch last", () => {
    const decision = evaluatePreflight({
      settings: { ...settings, allowSubmit: false },
      submissionsToday: 0,
      now,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("SUBMIT_DISABLED");
      expect(decision.message).toContain("allowSubmit");
    }
  });

  it("honours a caller-supplied interval", () => {
    const decision = evaluatePreflight({
      settings,
      submissionsToday: 0,
      now,
      lastActionAt: new Date(now.getTime() - 5_000),
      domainMinIntervalMs: 4_000,
    });
    expect(decision).toEqual({ allowed: true });
  });
});