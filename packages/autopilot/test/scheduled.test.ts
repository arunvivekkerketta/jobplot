import { describe, expect, it, vi } from "vitest";
import {
  isScheduledCandidate,
  runScheduledAutopilot,
  SCHEDULED_MAX_PER_USER,
  type SchedulingSettings,
} from "../src/index.js";

const unlocked = {
  greenhouse: { mode: "AUTOPILOT", unlockedAt: "2026-11-15T09:00:00.000Z" },
};

function scheduling(overrides: Partial<SchedulingSettings> = {}): SchedulingSettings {
  return {
    userId: "user-1",
    mode: "AUTOPILOT",
    allowSubmit: true,
    killSwitch: false,
    perPortalMode: unlocked,
    ...overrides,
  };
}

describe("gate 8.2: only opted-in users are due at a tick", () => {
  it("accepts Auto-Pilot mode with submissions on and a portal unlocked", () => {
    expect(isScheduledCandidate(scheduling())).toBe(true);
  });

  it("ignores COPILOT users, disabled submissions and the kill switch", () => {
    expect(isScheduledCandidate(scheduling({ mode: "COPILOT" }))).toBe(false);
    expect(isScheduledCandidate(scheduling({ allowSubmit: false }))).toBe(false);
    expect(isScheduledCandidate(scheduling({ killSwitch: true }))).toBe(false);
  });

  it("ignores a user with no unlocked portal", () => {
    expect(isScheduledCandidate(scheduling({ perPortalMode: {} }))).toBe(false);
    expect(isScheduledCandidate(scheduling({ perPortalMode: null }))).toBe(false);
    expect(
      isScheduledCandidate(
        scheduling({ perPortalMode: { greenhouse: { mode: "COPILOT" } } }),
      ),
    ).toBe(false);
  });
});

describe("gate 8.3: one tick runs the due users and audits the summary", () => {
  it("runs every due user with the per-user limit and reports totals", async () => {
    const runForUser = vi.fn(async () => ({
      queued: 1,
      submitted: 1,
      paused: 0,
      stopReason: null,
    }));
    const audit = vi.fn(async (_payload: Record<string, unknown>) => undefined);

    const report = await runScheduledAutopilot({
      listSettings: async () => [
        scheduling({ userId: "a" }),
        scheduling({ userId: "b" }),
        scheduling({ userId: "c", mode: "COPILOT" }),
      ],
      runForUser,
      audit,
    });

    expect(runForUser).toHaveBeenCalledTimes(2);
    expect(runForUser).toHaveBeenCalledWith("a", SCHEDULED_MAX_PER_USER);
    expect(runForUser).toHaveBeenCalledWith("b", SCHEDULED_MAX_PER_USER);
    expect(report).toMatchObject({ considered: 3, due: 2, submitted: 2 });
    expect(report.users.map((user) => user.userId)).toEqual(["a", "b"]);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]?.[0]).toMatchObject({ considered: 3, due: 2, submitted: 2 });
  });

  it("keeps going when one user fails, and records the error", async () => {
    const audit = vi.fn(async (_payload: Record<string, unknown>) => undefined);
    const report = await runScheduledAutopilot({
      listSettings: async () => [scheduling({ userId: "broken" }), scheduling({ userId: "ok" })],
      runForUser: async (userId) => {
        if (userId === "broken") throw new Error("browser crashed");
        return { queued: 0, submitted: 0, paused: 0, stopReason: "NO_ELIGIBLE_CANDIDATES" };
      },
      audit,
    });

    expect(report.users[0]).toMatchObject({ userId: "broken", error: "browser crashed" });
    expect(report.users[1]).toMatchObject({ userId: "ok", submitted: 0 });
    expect(report.submitted).toBe(0);
    expect(audit.mock.calls[0]?.[0]).toMatchObject({ errors: 1 });
  });

  it("audits a tick that found nobody due", async () => {
    const audit = vi.fn(async (_payload: Record<string, unknown>) => undefined);
    const report = await runScheduledAutopilot({
      listSettings: async () => [scheduling({ killSwitch: true })],
      runForUser: async () => ({ queued: 0, submitted: 0, paused: 0, stopReason: null }),
      audit,
    });

    expect(report).toMatchObject({ considered: 1, due: 0, submitted: 0, users: [] });
    expect(audit).toHaveBeenCalledTimes(1);
  });
});