import { describe, expect, it, vi } from "vitest";
import {
  enqueueAutopilotRun,
  parseRunPayload,
  processAutopilotRun,
  type QueueClient,
  type RunHandlerDeps,
} from "../src/queue.js";

const payload = { runId: "run-1", userId: "user-1", limit: 1, jobIds: ["job-1"] };

function deps(overrides: Partial<RunHandlerDeps> = {}) {
  const calls = {
    start: [] as string[],
    finished: [] as Array<{ id: string; result: Record<string, unknown> }>,
    failed: [] as Array<{ id: string; error: string }>,
    audited: [] as string[],
  };
  const base: RunHandlerDeps = {
    startRun: async (id) => {
      calls.start.push(id);
      return true;
    },
    finishRun: async (input) => void calls.finished.push(input),
    failRun: async (input) => void calls.failed.push(input),
    run: async () => ({ queued: 1, submitted: 1, paused: 0, stopReason: null, skipped: [] }),
    audit: async (entry) => void calls.audited.push(entry.action),
  };
  return { calls, deps: { ...base, ...overrides } };
}

describe("gate 4.6: a queued run is executed once and its outcome is stored", () => {
  it("runs the batch and records the report", async () => {
    const { calls, deps: d } = deps();
    await expect(processAutopilotRun(payload, d)).resolves.toBe("DONE");

    expect(calls.start).toEqual(["run-1"]);
    expect(calls.finished).toHaveLength(1);
    expect(calls.finished[0]?.result).toMatchObject({ submitted: 1 });
    expect(calls.audited).toContain("autopilot.run.worker");
    expect(calls.failed).toHaveLength(0);
  });

  it("does not run a batch twice when the job is redelivered", async () => {
    const run = vi.fn();
    const { calls, deps: d } = deps({ startRun: async () => false, run });
    await expect(processAutopilotRun(payload, d)).resolves.toBe("SKIPPED");
    expect(run).not.toHaveBeenCalled();
    expect(calls.finished).toHaveLength(0);
  });

  it("records a failure instead of throwing, so the queue does not retry a spent batch", async () => {
    const { calls, deps: d } = deps({
      run: async () => {
        throw new Error("The browser runtime is not installed");
      },
    });
    await expect(processAutopilotRun(payload, d)).resolves.toBe("FAILED");
    expect(calls.failed[0]).toMatchObject({ id: "run-1" });
    expect(calls.failed[0]?.error).toContain("browser runtime");
    expect(calls.audited).toContain("autopilot.run.failed");
  });

  it("refuses a payload the API would never send", () => {
    expect(() => parseRunPayload({ runId: "r", userId: "u", limit: 9 })).toThrow(/limit/);
    expect(() =>
      parseRunPayload({ runId: "r", userId: "u", jobIds: Array(11).fill("j") }),
    ).toThrow(/jobIds/);
    expect(() => parseRunPayload({ userId: "u" })).toThrow(/runId/);
    expect(parseRunPayload(payload)).toEqual(payload);
  });
});

describe("gate 4.6: a queue that refuses the job is reported, not swallowed", () => {
  const client = (send: QueueClient["send"]): QueueClient => ({
    createQueue: async () => {},
    send,
  });

  it("throws when pg-boss does not return a job id", async () => {
    await expect(
      enqueueAutopilotRun({ runId: "run-1", userId: "user-1" }, { client: client(async () => null) }),
    ).rejects.toThrow(/refused the run job/);
  });

  it("sends the validated payload to the run queue once", async () => {
    const sent: Array<{ queue: string; data: unknown }> = [];
    await enqueueAutopilotRun(
      { runId: "run-1", userId: "user-1", limit: 2 },
      {
        client: client(async (queue, data) => {
          sent.push({ queue, data });
          return "job-1";
        }),
      },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.queue).toBe("autopilot-run");
    expect(sent[0]?.data).toMatchObject({ runId: "run-1", limit: 2 });
  });
});
