import path from "node:path";
import { fileURLToPath } from "node:url";
import PgBoss from "pg-boss";

// The workspace keeps one .env at the repo root; turbo runs this app from apps/worker.
try {
  process.loadEnvFile(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  );
} catch {
  // No root .env: DATABASE_URL must come from the process environment.
}

/**
 * Worker entrypoint. Phase 1 proves the pg-boss stack boots against Postgres;
 * fetch-sources, score-jobs, tailor and apply consumers arrive in Phases 3 and 4.
 */

const HEARTBEAT_QUEUE = "system-heartbeat";

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
