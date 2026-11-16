import PgBoss from "pg-boss";
import {
  failAutopilotRun,
  finishAutopilotRun,
  startAutopilotRun,
  writeAudit,
} from "@jobpilot/db";

/**
 * 4.6: the Run button no longer drives a browser inside the HTTP request. It
 * creates an `AutopilotRun` row and sends this queue a job; the worker owns the
 * run from there. The payload is validated on both sides, so a hand-crafted job
 * cannot smuggle options the API refuses.
 */
export const AUTOPILOT_RUN_QUEUE = "autopilot-run";

export interface RunPayload {
  runId: string;
  userId: string;
  limit?: number;
  jobIds?: string[];
}

/**
 * Hand-written on purpose: this package has no schema library, and the payload is
 * four fields. The API validates the request; this guards the queue itself, so a
 * hand-crafted job cannot smuggle options the route would have refused.
 */
export function parseRunPayload(data: unknown): RunPayload {
  const invalid = (why: string): Error => new Error(`Invalid auto-pilot run payload: ${why}`);
  if (!data || typeof data !== "object") throw invalid("not an object");
  const input = data as Partial<RunPayload>;

  if (typeof input.runId !== "string" || input.runId.length === 0) throw invalid("runId");
  if (typeof input.userId !== "string" || input.userId.length === 0) throw invalid("userId");
  if (
    input.limit !== undefined &&
    (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 5)
  ) {
    throw invalid("limit");
  }
  if (
    input.jobIds !== undefined &&
    (!Array.isArray(input.jobIds) ||
      input.jobIds.length > 10 ||
      input.jobIds.some((id) => typeof id !== "string" || id.length === 0))
  ) {
    throw invalid("jobIds");
  }

  return {
    runId: input.runId,
    userId: input.userId,
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.jobIds !== undefined ? { jobIds: input.jobIds } : {}),
  };
}

/** The bits of a started pg-boss this module needs; tests pass a fake. */
export interface QueueClient {
  send: (queue: string, data: RunPayload) => Promise<string | null>;
  createQueue: (queue: string) => Promise<void>;
}

export function createQueueClient(connectionString: string): PgBoss {
  return new PgBoss({ connectionString });
}

/**
 * Sends one run. Without an injected client it opens its own short-lived
 * connection and closes it again, so a request never leaves a pool running.
 */
export async function enqueueAutopilotRun(
  payload: RunPayload,
  deps: { client?: QueueClient; connectionString?: string } = {},
): Promise<void> {
  const parsed = parseRunPayload(payload);
  const own = deps.client ? null : createQueueClient(requireConnection(deps));
  const client = deps.client ?? (own as QueueClient);

  if (own) await own.start();
  try {
    // pg-boss needs the queue to exist before a send; it is safe to repeat.
    await client.createQueue(AUTOPILOT_RUN_QUEUE);
    const jobId = await client.send(AUTOPILOT_RUN_QUEUE, parsed);
    if (!jobId) throw new Error("pg-boss refused the run job");
  } finally {
    if (own) await own.stop();
  }
}

function requireConnection(deps: { connectionString?: string }): string {
  const connectionString = deps.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  return connectionString;
}

/** Injected so the handler is unit-testable without a database or a queue. */
export interface RunHandlerDeps {
  startRun: (id: string) => Promise<boolean>;
  finishRun: (input: { id: string; result: Record<string, unknown> }) => Promise<void>;
  failRun: (input: { id: string; error: string }) => Promise<void>;
  run: (userId: string, options: { limit?: number; jobIds?: string[] }) => Promise<unknown>;
  audit: typeof writeAudit;
}

const defaults: RunHandlerDeps = {
  startRun: startAutopilotRun,
  finishRun: (input) => finishAutopilotRun(input),
  failRun: failAutopilotRun,
  // Imported here rather than at module load: `index.ts` re-exports this module,
  // and a static import would close the cycle.
  run: async (userId, options) => {
    const { runAutopilotNow } = await import("./index.js");
    return runAutopilotNow(userId, options);
  },
  audit: writeAudit,
};

/**
 * One queued run, start to finish. Never throws: a failed run is recorded on its
 * row and audited, so pg-boss does not retry a batch that already spent its
 * submissions, and the page can say what happened.
 */
export async function processAutopilotRun(
  data: unknown,
  deps: Partial<RunHandlerDeps> = {},
): Promise<"RUNNING" | "DONE" | "FAILED" | "SKIPPED"> {
  const merged = { ...defaults, ...deps };
  const payload = parseRunPayload(data);

  // A redelivered job must not run the same batch twice: the row decides.
  if (!(await merged.startRun(payload.runId))) return "SKIPPED";

  const options = {
    ...(payload.limit !== undefined ? { limit: payload.limit } : {}),
    ...(payload.jobIds !== undefined ? { jobIds: payload.jobIds } : {}),
  };

  try {
    const result = (await merged.run(payload.userId, options)) as Record<string, unknown>;
    await merged.finishRun({ id: payload.runId, result });
    await merged.audit({
      actor: "SYSTEM",
      action: "autopilot.run.worker",
      entityType: "AutopilotRun",
      entityId: payload.runId,
      payload: {
        submitted: typeof result.submitted === "number" ? result.submitted : null,
        queued: typeof result.queued === "number" ? result.queued : null,
        paused: typeof result.paused === "number" ? result.paused : null,
      },
    });
    return "DONE";
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await merged.failRun({ id: payload.runId, error: message });
    await merged.audit({
      actor: "SYSTEM",
      action: "autopilot.run.failed",
      entityType: "AutopilotRun",
      entityId: payload.runId,
      payload: { message },
    });
    return "FAILED";
  }
}

/** The worker's pg-boss handler: pg-boss hands over a batch of jobs. */
export function makeAutopilotRunHandler(deps: Partial<RunHandlerDeps> = {}) {
  return async (jobs: Array<{ data: unknown }>): Promise<void> => {
    for (const job of jobs) {
      await processAutopilotRun(job.data, deps);
    }
  };
}
