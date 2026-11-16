import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PgBoss from "pg-boss";
import { assertProductionConfig } from "@jobpilot/core";
import { failStaleAutopilotRuns, saveJobs, writeAudit } from "@jobpilot/db";
import { runScheduledTick } from "@jobpilot/autopilot";
import { AUTOPILOT_RUN_QUEUE, makeAutopilotRunHandler } from "@jobpilot/autopilot/queue";
import {
  JOB_BOARDS_ENV,
  fetchSourceJobs,
  makeFetchSourcesHandler,
  parseBoardsEnv,
  type FetchSourcesPayload,
} from "@jobpilot/sources";

// The workspace keeps one .env at the repo root; turbo runs this app from apps/worker.
try {
  process.loadEnvFile(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  );
} catch {
  // No root .env: DATABASE_URL must come from the process environment.
}

/**
 * Worker entrypoint. The queue consumers are thin wrappers around logic that
 * lives in the packages, so the same code paths are unit-tested without a
 * running worker.
 */

const HEARTBEAT_QUEUE = "system-heartbeat";
const FETCH_SOURCES_QUEUE = "fetch-sources";
const AUTOPILOT_QUEUE = "autopilot-tick";
/**
 * Every tick spends at most one submission per opted-in user, so fifteen minutes
 * is comfortably inside the per-host interval (30s) and the daily cap.
 */
const AUTOPILOT_CRON = process.env.AUTOPILOT_CRON ?? "*/15 * * * *";
/**
 * A run older than this was queued but never finished, so no worker can still be
 * working on it: the row is failed so the page cannot wait for ever (4.6).
 */
const STALE_RUN_MS = 30 * 60_000;
/** Boards change slowly; six-hourly is plenty and stays polite to public APIs. */
const FETCH_SCHEDULE = "0 */6 * * *";

const handleFetchSources = makeFetchSourcesHandler({
  fetchSourceJobs,
  saveJobs,
  writeAudit,
});

async function main(): Promise<void> {
  // The worker holds the same secrets as the web app, so it refuses to start in
  // production with a publicly known value (H4).
  assertProductionConfig(process.env);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  const boss = new PgBoss({ connectionString });
  boss.on("error", (err) => console.error("[worker] boss error:", err.message));

  await boss.start();
  console.log("[worker] pg-boss started");

  await boss.createQueue(HEARTBEAT_QUEUE);
  await boss.schedule(HEARTBEAT_QUEUE, "*/10 * * * *");
  await boss.work(HEARTBEAT_QUEUE, async () => {
    console.log(`[worker] heartbeat ${new Date().toISOString()}`);
  });
  console.log(`[worker] queue ${HEARTBEAT_QUEUE} scheduled every 10 minutes`);

  await boss.createQueue(FETCH_SOURCES_QUEUE);
  await boss.work<FetchSourcesPayload>(
    FETCH_SOURCES_QUEUE,
    async (jobs) => {
      for (const job of jobs) {
        const result = await handleFetchSources(job.data);
        // The handler already wrote its audit row; this is operator visibility.
        if (result.ok) {
          console.log(
            `[worker] fetch-sources ${result.provider}/${job.data.token}: ${result.created} new, ${result.updated} updated`,
          );
        } else {
          console.error(
            `[worker] fetch-sources ${result.provider}/${job.data.token} failed: ${result.error}`,
          );
        }
      }
    },
  );

  const boards = parseBoardsEnv(process.env[JOB_BOARDS_ENV]);
  for (const board of boards) {
    await boss.schedule(FETCH_SOURCES_QUEUE, FETCH_SCHEDULE, board, {
      singletonKey: `fetch:${board.provider}:${board.token}`,
    });
  }
  console.log(
    boards.length === 0
      ? `[worker] ${JOB_BOARDS_ENV} is empty; no boards scheduled (fetch on demand from /jobs)`
      : `[worker] ${boards.length} board(s) scheduled every 6 hours from ${JOB_BOARDS_ENV}`,
  );

  // Auto-Pilot cadence: the worker runs the same `runScheduledTick` service the
  // authenticated tick endpoint uses, so the schedule cannot drift from the
  // on-demand path (gate 8.3).
  await boss.createQueue(AUTOPILOT_QUEUE);
  await boss.work(AUTOPILOT_QUEUE, async () => {
    const report = await runScheduledTick();
    console.log(
      `[worker] autopilot-tick considered=${report.considered} due=${report.due} submitted=${report.submitted}`,
    );
    for (const user of report.users) {
      console.log(
        `[worker] autopilot-tick user=${user.userId} queued=${user.queued} submitted=${user.submitted} paused=${user.paused} stop=${user.stopReason ?? "none"}${user.error ? ` error=${user.error}` : ""}`,
      );
    }
  });
  await boss.schedule(AUTOPILOT_QUEUE, AUTOPILOT_CRON, {}, { singletonKey: "autopilot-tick" });
  console.log(`[worker] ${AUTOPILOT_QUEUE} scheduled (${AUTOPILOT_CRON})`);

  // 4.6: the on-demand Run the page queues. Same service the scheduler drives, so
  // the two paths cannot diverge.
  await boss.createQueue(AUTOPILOT_RUN_QUEUE);
  await boss.work(AUTOPILOT_RUN_QUEUE, makeAutopilotRunHandler());
  console.log(`[worker] queue ${AUTOPILOT_RUN_QUEUE} consuming on demand`);

  const stale = await failStaleAutopilotRuns(new Date(Date.now() - STALE_RUN_MS));
  if (stale > 0) console.log(`[worker] failed ${stale} stale run(s) older than 30 minutes`);

  // A queue consumer has no port, so the container healthcheck (and the e2e
  // suite's readiness wait) needs one small endpoint that only answers once the
  // consumers above are registered.
  const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 3101);
  const health = createServer((req, res) => {
    const ready = req.url === "/healthz";
    res.writeHead(ready ? 200 : 404, { "content-type": "text/plain" });
    res.end(ready ? "ok" : "not found");
  });
  health.listen(healthPort, "127.0.0.1", () => {
    console.log(`[worker] health on http://127.0.0.1:${healthPort}/healthz`);
  });

  const shutdown = async (): Promise<void> => {
    console.log("[worker] shutting down");
    health.close();
    await boss.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
