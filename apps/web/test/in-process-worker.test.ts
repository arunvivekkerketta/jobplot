import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The in-process consumer is what makes a queued run execute without a second
 * process (4.6), so these cases pin when it starts, that it starts once, and that
 * a failed start is survivable and retryable.
 */

const state = vi.hoisted(() => ({
  started: 0,
  queues: [] as string[],
  worked: [] as string[],
  failStart: false,
  handler: null as null | ((jobs: Array<{ data: unknown }>) => Promise<void>),
  errors: [] as string[],
}));

vi.mock("pg-boss", () => {
  class FakeBoss {
    on(): void {}
    async start(): Promise<void> {
      if (state.failStart) throw new Error("connection refused");
      state.started += 1;
    }
    async createQueue(name: string): Promise<void> {
      state.queues.push(name);
    }
    async work(
      name: string,
      handler: (jobs: Array<{ data: unknown }>) => Promise<void>,
    ): Promise<void> {
      state.worked.push(name);
      state.handler = handler;
    }
  }
  return { default: FakeBoss };
});

vi.mock("@jobpilot/autopilot/queue", () => ({
  AUTOPILOT_RUN_QUEUE: "autopilot-run",
  makeAutopilotRunHandler: () => async (jobs: Array<{ data: unknown }>) => {
    state.errors.push(`handled ${jobs.length}`);
  },
}));

const ENV = { DATABASE_URL: "postgresql://jobpilot:jobpilot@localhost:5432/jobpilot_e2e" };

/** A `ProcessEnv` the tests own, so no case can see the real environment. */
function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...ENV, ...overrides } as unknown as NodeJS.ProcessEnv;
}

/** Fresh module per case: the singleton lives on globalThis and is reset here. */
async function load() {
  vi.resetModules();
  delete (globalThis as { __jobpilotRunWorker?: unknown }).__jobpilotRunWorker;
  return import("@/lib/in-process-worker");
}

beforeEach(() => {
  state.started = 0;
  state.queues = [];
  state.worked = [];
  state.failStart = false;
  state.handler = null;
  state.errors = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startInProcessRunWorker", () => {
  it("consumes the run queue on the app's own connection", async () => {
    const { startInProcessRunWorker } = await load();

    const boss = await startInProcessRunWorker(env());

    expect(boss).not.toBeNull();
    expect(state.started).toBe(1);
    expect(state.queues).toEqual(["autopilot-run"]);
    expect(state.worked).toEqual(["autopilot-run"]);
  });

  it("registers the shared handler, so the stop checks and audits are the worker's", async () => {
    const { startInProcessRunWorker } = await load();
    await startInProcessRunWorker(env());

    await state.handler?.([{ data: { runId: "run_1" } }]);

    expect(state.errors).toEqual(["handled 1"]);
  });

  it("starts exactly one consumer however often it is asked", async () => {
    const { startInProcessRunWorker } = await load();

    const first = await startInProcessRunWorker(env());
    const second = await startInProcessRunWorker(env());

    expect(second).toBe(first);
    expect(state.started).toBe(1);
    expect(state.worked).toEqual(["autopilot-run"]);
  });

  it("does nothing when JOBPILOT_IN_PROCESS_WORKER=0", async () => {
    const { startInProcessRunWorker, inProcessWorkerEnabled } = await load();

    expect(inProcessWorkerEnabled(env({ JOBPILOT_IN_PROCESS_WORKER: "0" }))).toBe(false);
    await expect(
      startInProcessRunWorker(env({ JOBPILOT_IN_PROCESS_WORKER: "0" })),
    ).resolves.toBeNull();
    expect(state.started).toBe(0);
  });

  it("does not open a connection during next build", async () => {
    const { startInProcessRunWorker } = await load();

    await expect(
      startInProcessRunWorker(env({ NEXT_PHASE: "phase-production-build" })),
    ).resolves.toBeNull();
    expect(state.started).toBe(0);
  });

  it("stays out of the way when DATABASE_URL is missing", async () => {
    const { startInProcessRunWorker } = await load();

    await expect(
      startInProcessRunWorker(env({ DATABASE_URL: "" })),
    ).resolves.toBeNull();
    expect(state.started).toBe(0);
  });

  it("survives a failed start and retries on the next call", async () => {
    const { startInProcessRunWorker } = await load();
    state.failStart = true;

    await expect(startInProcessRunWorker(env())).resolves.toBeNull();
    expect(state.started).toBe(0);

    state.failStart = false;
    const retried = await startInProcessRunWorker(env());

    expect(retried).not.toBeNull();
    expect(state.started).toBe(1);
  });
});
