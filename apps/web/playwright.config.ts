import { defineConfig } from "@playwright/test";

import { e2eDatabaseUrl, loadRootEnv, redact } from "./scripts/e2e-env.mjs";

const env = loadRootEnv() as Record<string, string>;

const databaseUrl =
  process.env.DATABASE_URL ?? env.DATABASE_URL ?? "postgresql://jobpilot:jobpilot@localhost:5432/jobpilot";

// The suite never touches the developer database: it owns `<db>_e2e`, which
// scripts/e2e-db.mjs drops and re-seeds before the server starts. That keeps the
// daily submission cap (and every other counter) at zero for each run.
const e2eDatabase = e2eDatabaseUrl(databaseUrl);
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const MOCK_ATS_URL = process.env.MOCK_ATS_URL ?? "http://localhost:4600";

console.log(`[e2e] database ${redact(e2eDatabase)} on ${BASE_URL}`);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  // Every spec signs in as the one seeded admin and rewrites that user's
  // profile row, so parallel workers contend for the same row lock and the
  // same Fact rebuild. Serial execution makes each gate's proof deterministic.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // The mock ATS is shared by several specs; reuse it when it is already up.
      command: "pnpm --filter @jobpilot/mock-ats start",
      url: MOCK_ATS_URL,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // Reset the e2e database, then serve the app on its own port so a running
      // `pnpm dev` (developer database, :3000) is never involved.
      // 4.6: the Run button only queues, so the suite needs a live consumer or
      // the click could never end in a submission.
      command: "node scripts/e2e-db.mjs && pnpm exec next dev -p 3100",
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        ...env,
        DATABASE_URL: e2eDatabase,
        NEXTAUTH_URL: BASE_URL,
        AUTH_URL: BASE_URL,
        NEXTAUTH_SECRET:
          process.env.NEXTAUTH_SECRET ?? env.NEXTAUTH_SECRET ?? "e2e-secret-not-for-production",
        AUTH_SECRET: process.env.AUTH_SECRET ?? env.NEXTAUTH_SECRET ?? "e2e-secret-not-for-production",
        APP_ENCRYPTION_KEY: env.APP_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
        MOCK_ATS_URL,
      },
    },
    {
      // 4.6: the queue consumer, on its own readiness endpoint. It shares the e2e
      // database with the app, and the cron is pushed out of the run so scheduled
      // ticks cannot race the runs each spec requests.
      command: "pnpm --filter @jobpilot/worker start",
      url: "http://localhost:3101/healthz",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...env,
        DATABASE_URL: e2eDatabase,
        WORKER_HEALTH_PORT: "3101",
        AUTOPILOT_CRON: "0 0 1 1 *",
        JOB_BOARDS: "",
      },
    },
  ],
});
