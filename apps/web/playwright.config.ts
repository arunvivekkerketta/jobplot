import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function loadRootEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../../.env");
  const out: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && m[1] && !out[m[1]]) out[m[1]] = m[2] ?? "";
    }
  }
  return out;
}

const env = loadRootEnv();

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
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    port: 3000,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...env,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        env.DATABASE_URL ??
        "postgresql://jobpilot:jobpilot@localhost:5432/jobpilot",
      NEXTAUTH_URL: "http://localhost:3000",
      AUTH_SECRET:
        process.env.AUTH_SECRET ??
        env.NEXTAUTH_SECRET ??
        "e2e-secret-not-for-production",
      NEXTAUTH_SECRET:
        process.env.NEXTAUTH_SECRET ??
        env.NEXTAUTH_SECRET ??
        "e2e-secret-not-for-production",
      APP_ENCRYPTION_KEY:
        env.APP_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
    },
  },
});
