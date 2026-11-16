import PgBoss from "pg-boss";
import {
  AUTOPILOT_RUN_QUEUE,
  makeAutopilotRunHandler,
} from "@jobpilot/autopilot/queue";

/**
 * 4.6: the Run button only queues a run. Something has to consume that queue in
 * the same deployment, and the web app is the one process that is always running,
 * so it starts the consumer itself instead of requiring a second process to be up.
 *
 * The consumer is the very same `makeAutopilotRunHandler` the worker container
 * uses — same stop checks (kill switch, caps, rate limits), same audits, same
 * `AutopilotRun` row — so the two paths cannot drift. When both the web app and
 * the worker container are running they compete for jobs, which is safe: pg-boss
 * hands each job to exactly one consumer, and `startAutopilotRun` is a conditional
 * update on `status = 'QUEUED'`, so a redelivered job is skipped rather than run
 * twice.
 *
 * Disable with `JOBPILOT_IN_PROCESS_WORKER=0` when runs must only be consumed by
 * the dedicated worker container.
 *
 * It is started at server boot from `instrumentation.node.ts`, which Next only
 * compiles for the Node runtime — Next also compiles `instrumentation.ts` for the
 * middleware's edge bundle, where pg's `node:crypto` import cannot resolve. The
 * Run route calls `ensureInProcessRunWorker` again as a backstop (it is a no-op
 * once the consumer is up), so a request can never queue into an undrained queue.
 */
type WorkerGlobal = { __jobpilotRunWorker?: Promise<PgBoss | null> };

/**
 * Survives module re-evaluation: `next dev` re-runs this module on every edit, and
 * a second consumer per edit would multiply the pool without ever being stopped.
 */
const globals = globalThis as WorkerGlobal;

export function inProcessWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.JOBPILOT_IN_PROCESS_WORKER === "0") return false;
  // `next build` authenticates server modules to collect page data; a build must
  // never open a queue connection.
  if (env.NEXT_PHASE === "phase-production-build") return false;
  return true;
}

export async function ensureInProcessRunWorker(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PgBoss | null> {
  try {
    return await startInProcessRunWorker(env);
  } catch (error) {
    // Never let a queue problem turn a run request into an unhandled rejection:
    // the enqueue below is what decides the status the caller sees.
    console.error(
      "[in-process-worker] ensure failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}

export async function startInProcessRunWorker(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PgBoss | null> {
  if (!inProcessWorkerEnabled(env)) {
    console.log("[in-process-worker] disabled by JOBPILOT_IN_PROCESS_WORKER=0");
    return null;
  }

  const existing = globals.__jobpilotRunWorker;
  if (existing) return existing;

  const started = (async (): Promise<PgBoss | null> => {
    const connectionString = env.DATABASE_URL;
    if (!connectionString) {
      // Without a database there is no queue to consume; the Run button will fail
      // its enqueue loudly rather than the app refusing to boot.
      console.error("[in-process-worker] DATABASE_URL is not set; not starting");
      return null;
    }

    const boss = new PgBoss({ connectionString });
    boss.on("error", (error: Error) => {
      console.error("[in-process-worker] queue error:", error.message);
    });

    await boss.start();
    await boss.createQueue(AUTOPILOT_RUN_QUEUE);
    await boss.work(AUTOPILOT_RUN_QUEUE, makeAutopilotRunHandler());
    console.log(`[in-process-worker] consuming ${AUTOPILOT_RUN_QUEUE}`);
    return boss;
  })();

  globals.__jobpilotRunWorker = started;
  try {
    return await started;
  } catch (error) {
    // A failed start must not wedge the app: requests still work, and the next
    // call retries instead of returning the rejected promise for ever.
    globals.__jobpilotRunWorker = undefined;
    console.error(
      "[in-process-worker] could not start:",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}
