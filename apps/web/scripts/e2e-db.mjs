#!/usr/bin/env node
/**
 * Prepares the database the e2e suite runs against and is executed by the
 * Playwright webServer command before Next dev boots, so every `pnpm e2e` run
 * starts from a freshly migrated, freshly seeded database:
 *
 *   1. the e2e database (`<DATABASE_URL database>_e2e`) is created if missing;
 *   2. it is reset with `prisma migrate reset --force`, which drops every table;
 *   3. the seed (admin user + default Settings) is applied.
 *
 * Step 2 is what keeps the daily submission budget fresh: caps count stored
 * submissions for the current day, so a retained database would eventually
 * refuse the unattended-submission gates no matter how many times they run.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  databaseName,
  e2eDatabaseUrl,
  loadRootEnv,
  maintenanceDatabaseUrl,
  redact,
  repoRoot,
} from "./e2e-env.mjs";

const env = { ...process.env };
const rootEnv = loadRootEnv();
for (const [key, value] of Object.entries(rootEnv)) {
  if (env[key] === undefined || env[key] === "") env[key] = value;
}

const base = env.DATABASE_URL;
if (!base) {
  console.error("[e2e-db] DATABASE_URL is not set (add it to .env or the environment)");
  process.exit(1);
}

const target = e2eDatabaseUrl(base);
const name = databaseName(target);
if (!/^[A-Za-z0-9_]+$/.test(name) || !name.endsWith("_e2e")) {
  console.error(`[e2e-db] refusing to reset "${name}": e2e database names must end with _e2e`);
  process.exit(1);
}

const dbDir = path.join(repoRoot, "packages/db");
const dbEnv = { ...env, DATABASE_URL: target };

function run(args, { input = "", quiet = false } = {}) {
  // `pnpm` is a .cmd shim on Windows, so the runner has to go through a shell.
  return execFileSync("pnpm", args, {
    cwd: dbDir,
    env: dbEnv,
    input,
    encoding: "utf8",
    shell: true,
    stdio: [input ? "pipe" : "ignore", quiet ? "pipe" : "inherit", quiet ? "pipe" : "inherit"],
  });
}

function executeOnMaintenance(sql) {
  try {
    run(["exec", "prisma", "db", "execute", "--url", maintenanceDatabaseUrl(base), "--stdin"], {
      input: `${sql}\n`,
      quiet: true,
    });
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    console.error(`[e2e-db] failed: ${sql}\n${output || (error.message ?? "")}`);
    process.exit(1);
  }
}

function recreateDatabase() {
  // Dropping first makes the run idempotent: a half-finished previous run, a
  // leftover connection or a manually edited table cannot leak into this suite.
  executeOnMaintenance(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`);
  executeOnMaintenance(`CREATE DATABASE "${name}";`);
  console.log(`[e2e-db] recreated database ${name}`);
}

function step(label, fn) {
  process.stdout.write(`[e2e-db] ${label} … `);
  fn();
  process.stdout.write("ok\n");
}

recreateDatabase();

step("migrating", () => {
  run(["exec", "prisma", "migrate", "reset", "--force", "--skip-generate", "--skip-seed"]);
});

step("seeding", () => {
  run(["exec", "tsx", "src/seed.ts"], { quiet: true });
});

console.log(`[e2e-db] ready: ${redact(target)}`);
