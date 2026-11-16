import { describe, expect, it, vi } from "vitest";
import {
  canUnlockPortal,
  readPortalPolicy,
  runAutopilot,
  selectAutopilotQueue,
  type AutopilotCandidate,
  type AutopilotPage,
} from "../src/autopilot.js";
import type { RawControl } from "../src/runner.js";

const now = new Date("2026-11-15T10:00:00.000Z");

const policies = {
  greenhouse: { mode: "AUTOPILOT", unlockedAt: "2026-11-15T09:00:00.000Z" },
};

const settings = {
  killSwitch: false,
  allowSubmit: true,
  dailyCap: 5,
  mode: "AUTOPILOT",
};

function candidate(overrides: Partial<AutopilotCandidate> = {}): AutopilotCandidate {
  return {
    jobId: "job-1",
    portal: "greenhouse",
    title: "Backend Engineer",
    url: "http://localhost:4600/greenhouse/sample",
    score: 90,
    resumeVersionId: "version-1",
    ...overrides,
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    policies,
    settings,
    threshold: 75,
    candidates: [candidate()],
    submissionsToday: 0,
    now,
    ...overrides,
  };
}

describe("gate 7.1: a portal runs unattended only when it is unlocked", () => {
  it("reads a policy only when the stored mode is AUTOPILOT", () => {
    expect(readPortalPolicy(policies, "greenhouse")?.mode).toBe("AUTOPILOT");
    expect(readPortalPolicy(policies, "lever")).toBeNull();
    expect(readPortalPolicy({ lever: { mode: "AUTOPILOT" } }, "lever")).toBeNull();
    expect(readPortalPolicy("garbage", "greenhouse")).toBeNull();
  });

  it("refuses to unlock while submissions are off or the kill switch is on", () => {
    expect(canUnlockPortal({ allowSubmit: false, killSwitch: false })).toMatchObject({
      ok: false,
      reason: "SUBMIT_DISABLED",
    });
    expect(canUnlockPortal({ allowSubmit: true, killSwitch: true })).toMatchObject({
      ok: false,
      reason: "KILL_SWITCH",
    });
    expect(canUnlockPortal({ allowSubmit: true, killSwitch: false })).toEqual({ ok: true });
  });
});

describe("gate 7.2: the queue carries one reason per skipped posting", () => {
  it("accepts the qualifying posting", () => {
    const result = selectAutopilotQueue(baseInput());
    expect(result.eligible).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("skips a low score, a locked portal and a missing approval", () => {
    const result = selectAutopilotQueue(
      baseInput({
        candidates: [
          candidate({ jobId: "low", score: 40 }),
          candidate({ jobId: "locked", portal: "lever" }),
          candidate({ jobId: "unapproved", resumeVersionId: null }),
        ],
      }),
    );
    expect(result.eligible).toHaveLength(0);
    expect(result.skipped.map((entry) => [entry.jobId, entry.reason])).toEqual([
      ["low", "BELOW_THRESHOLD"],
      ["locked", "PORTAL_LOCKED"],
      ["unapproved", "NO_APPROVED_RESUME"],
    ]);
  });

  it("skips everything when the kill switch is on", () => {
    const result = selectAutopilotQueue(
      baseInput({
        settings: { ...settings, killSwitch: true },
        candidates: [candidate({ jobId: "a" }), candidate({ jobId: "b" })],
      }),
    );
    expect(result.eligible).toHaveLength(0);
    expect(result.skipped.map((entry) => entry.reason)).toEqual(["KILL_SWITCH", "KILL_SWITCH"]);
  });
});

describe("gate 7.3: caps count what a run has already planned", () => {
  it("stops at the daily cap using today's submissions", () => {
    const result = selectAutopilotQueue(
      baseInput({ submissionsToday: 4, settings: { ...settings, dailyCap: 5 } }),
    );
    expect(result.eligible).toHaveLength(1);

    const full = selectAutopilotQueue(
      baseInput({ submissionsToday: 5, settings: { ...settings, dailyCap: 5 } }),
    );
    expect(full.eligible).toHaveLength(0);
    expect(full.skipped[0]?.reason).toBe("DAILY_CAP");
  });

  it("honours the per-portal cap and the run limit", () => {
    const portalCapped = selectAutopilotQueue(
      baseInput({ perPortalToday: { greenhouse: 2 }, perPortalCap: 2 }),
    );
    expect(portalCapped.skipped[0]?.reason).toBe("PORTAL_CAP");

    const limited = selectAutopilotQueue(
      baseInput({
        limit: 1,
        candidates: [candidate({ jobId: "a" }), candidate({ jobId: "b" })],
      }),
    );
    expect(limited.eligible).toHaveLength(1);
    expect(limited.skipped[0]?.reason).toBe("RUN_LIMIT");
  });

  it("counts a planned posting against the daily cap immediately", () => {
    const result = selectAutopilotQueue(
      baseInput({
        submissionsToday: 4,
        settings: { ...settings, dailyCap: 5 },
        candidates: [candidate({ jobId: "a" }), candidate({ jobId: "b" })],
        limit: 5,
      }),
    );
    expect(result.eligible.map((entry) => entry.jobId)).toEqual(["a"]);
    expect(result.skipped[0]?.reason).toBe("DAILY_CAP");
  });

  it("respects the per-host interval", () => {
    const result = selectAutopilotQueue(
      baseInput({ lastActionAt: { greenhouse: new Date(now.getTime() - 5_000) } }),
    );
    expect(result.skipped[0]?.reason).toBe("RATE_LIMIT");
  });
});

function fakePage(counter: { submits: number }): AutopilotPage {
  const controls: RawControl[] = [
    { index: 0, label: "Email", name: "email", id: "email", autocomplete: "email", type: "email" },
  ];
  let submitted = false;
  const closed: { value: boolean } = { value: false };
  void closed;

  return {
    async goto() {},
    async controls() {
      return submitted ? [] : controls;
    },
    async buttonIndices(pattern) {
      if (submitted) return [];
      return /submit/i.test(pattern) ? [0] : [];
    },
    async fill() {},
    async attach() {},
    async clickButton() {
      submitted = true;
      counter.submits += 1;
    },
    async bodyText() {
      return submitted ? "Application received. Thank you." : "Greenhouse fixture";
    },
    async challengePresent() {
      return false;
    },
    async close() {
      closed.value = true;
    },
  };
}

describe("gate 7.4: the loop submits without a click and re-checks the gate each time", () => {
  it("runs every eligible posting and records each outcome", async () => {
    const counter = { submits: 0 };
    const outcomes: string[] = [];
    const report = await runAutopilot({
      targets: [
        { jobId: "a", portal: "greenhouse", url: "http://localhost:4600/greenhouse/sample" },
        { jobId: "b", portal: "greenhouse", url: "http://localhost:4600/greenhouse/sample" },
      ],
      openPage: async () => fakePage(counter),
      profile: { basics: { name: "Priya Sharma", email: "priya@example.com" } },
      preflightFor: () => ({ settings, submissionsToday: 0, now }),
      onOutcome: async (outcome) => {
        outcomes.push(`${outcome.jobId}:${outcome.status}`);
      },
    });

    expect(counter.submits).toBe(2);
    expect(outcomes).toEqual(["a:SUBMITTED", "b:SUBMITTED"]);
    expect(report.stopReason).toBeUndefined();
  });

  it("stops the whole run when the gate blocks mid-queue", async () => {
    const counter = { submits: 0 };
    const report = await runAutopilot({
      targets: [
        { jobId: "a", portal: "greenhouse", url: "http://localhost:4600/greenhouse/sample" },
        { jobId: "b", portal: "greenhouse", url: "http://localhost:4600/greenhouse/sample" },
      ],
      openPage: async () => fakePage(counter),
      profile: { basics: { name: "Priya Sharma", email: "priya@example.com" } },
      preflightFor: (_target, index) => ({
        settings: { ...settings, killSwitch: index > 0 },
        submissionsToday: 0,
        now,
      }),
    });

    expect(counter.submits).toBe(1);
    expect(report.outcomes).toHaveLength(1);
    expect(report.stopReason).toBe("KILL_SWITCH");
  });

  it("never opens a page for a blocked first target", async () => {
    const openPage = vi.fn(async () => fakePage({ submits: 0 }));
    const report = await runAutopilot({
      targets: [{ jobId: "a", portal: "greenhouse", url: "http://localhost:4600/greenhouse/sample" }],
      openPage,
      profile: { basics: { name: "Priya Sharma", email: "priya@example.com" } },
      preflightFor: () => ({ settings: { ...settings, allowSubmit: false }, submissionsToday: 0, now }),
    });

    expect(openPage).not.toHaveBeenCalled();
    expect(report.stopReason).toBe("SUBMIT_DISABLED");
  });
});
describe("gate 1.1: the kill switch and the per-host interval act on the run in progress", () => {
  it("stops before the next posting when the kill switch is flipped mid-run", async () => {
    const counter = { submits: 0 };
    let kill = false;

    const report = await runAutopilot({
      targets: [
        { jobId: "a", portal: "greenhouse", url: "http://localhost:4600/greenhouse/sample" },
        { jobId: "b", portal: "greenhouse", url: "http://localhost:4600/greenhouse/sample" },
      ],
      openPage: async () => fakePage(counter),
      profile: { basics: { name: "Priya Sharma", email: "priya@example.com" } },
      preflightFor: () => ({
        settings: { ...settings, killSwitch: kill },
        submissionsToday: 0,
        now,
      }),
      onOutcome: async () => {
        // The user reaches the Stop button while the first submission is ending.
        kill = true;
      },
    });

    expect(counter.submits).toBe(1);
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(["SUBMITTED"]);
    expect(report.stopReason).toBe("KILL_SWITCH");
  });

  it("waits out a short per-host interval instead of stopping the run", async () => {
    const waits: number[] = [];
    let attempts = 0;

    const report = await runAutopilot({
      targets: [
        { jobId: "a", portal: "greenhouse", url: "http://localhost:4600/greenhouse/sample" },
      ],
      openPage: async () => fakePage({ submits: 0 }),
      profile: { basics: { name: "Priya Sharma", email: "priya@example.com" } },
      preflightFor: () => {
        attempts += 1;
        return attempts === 1
          ? {
              settings,
              submissionsToday: 0,
              now,
              lastActionAt: new Date(now.getTime() - 29_000),
            }
          : { settings, submissionsToday: 0, now };
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([1_000]);
    expect(attempts).toBe(2);
    expect(report.outcomes[0]?.status).toBe("SUBMITTED");
  });

  it("blocks instead of clicking submit when beforeSubmit refuses", async () => {
    const report = await runAutopilot({
      targets: [
        { jobId: "a", portal: "greenhouse", url: "http://localhost:4600/greenhouse/sample" },
      ],
      openPage: async () => fakePage({ submits: 0 }),
      profile: { basics: { name: "Priya Sharma", email: "priya@example.com" } },
      preflightFor: () => ({ settings, submissionsToday: 0, now }),
      beforeSubmit: async () => false,
    });

    const outcome = report.outcomes[0];
    expect(outcome?.status).toBe("BLOCKED");
    expect(outcome?.reason).toBe("KILL_SWITCH");
    expect(outcome?.actions.some((action) => action.kind === "SUBMIT")).toBe(false);
    expect(outcome?.actions.some((action) => action.kind === "BLOCK")).toBe(true);
  });
});

describe("gate 2.3: the same host is spaced, not stopped", () => {
  it("waits one interval for the second posting on the same portal", async () => {
    const waits: number[] = [];
    const counter = { submits: 0 };
    const clock = { now: new Date(now.getTime()), last: null as Date | null };

    const report = await runAutopilot({
      targets: [
        { jobId: "a", portal: "greenhouse", url: "http://localhost:4600/greenhouse/sample" },
        { jobId: "b", portal: "greenhouse", url: "http://localhost:4600/greenhouse/sample" },
      ],
      openPage: async () => fakePage(counter),
      profile: { basics: { name: "Priya Sharma", email: "priya@example.com" } },
      preflightFor: () => ({
        settings,
        submissionsToday: 0,
        now: new Date(clock.now),
        ...(clock.last ? { lastActionAt: clock.last } : {}),
      }),
      onOutcome: async () => {
        clock.last = new Date(clock.now);
      },
      sleep: async (ms) => {
        waits.push(ms);
        clock.now = new Date(clock.now.getTime() + ms);
      },
    });

    expect(waits).toEqual([30_000]);
    expect(counter.submits).toBe(2);
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(["SUBMITTED", "SUBMITTED"]);
    expect(report.stopReason).toBeUndefined();
  });
});
