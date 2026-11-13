import path from "node:path";
import { fileURLToPath } from "node:url";
import PgBoss from "pg-boss";
import { saveJobs, writeAudit } from "@jobpilot/db";
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
/** Boards change slowly; six-hourly is plenty and stays polite to public APIs. */
const FETCH_SCHEDULE = "0 */6 * * *";

const handleFetchSources = makeFetchSourcesHandler({
  fetchSourceJobs,
  saveJobs,
  writeAudit,
});

async function main(): Promise<void> {
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

  const shutdown = async (): Promise<void> => {
    console.log("[worker] shutting down");
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
