#!/usr/bin/env node
/**
 * Runs gate 2.4's real-database test — the one that mocks only `playwright`, so
 * the claim, resume staging, release and audit paths are the real ones.
 *
 * That test skips itself unless `DATABASE_URL` names the e2e database, which is
 * the right default for `pnpm test` (it must never write rows into a developer's
 * data) but meant nothing ran it. This script is the documented way to exercise
 * it:
 *
 *   1. derives `<database>_e2e` from DATABASE_URL (the same rule Playwright uses);
 *   2. creates that database when it is missing — it is never dropped here, so a
 *      concurrent `pnpm e2e` run is not disturbed;
 *   3. applies the committed migrations to it;
 *   4. runs the test against it and **fails if the suite reported a skip**, so a
 *      silently skipped proof cannot pass as a green step.
 *
 * Usage: `pnpm test:integration`
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  databaseName,
  e2eDatabaseUrl,
  loadRootEnv,
  maintenanceDatabaseUrl,
  redact,
  repoRoot,
} from "../apps/web/scripts/e2e-env.mjs";

const env = { ...process.env };
for (const [key, value] of Object.entries(loadRootEnv())) {
  if (env[key] === undefined || env[key] === "") env[key] = value;
}

const base = env.DATABASE_URL;
if (!base) {
  console.error("[gate24] DATABASE_URL is not set (add it to .env or the environment)");
  process.exit(1);
}

const target = e2eDatabaseUrl(base);
const name = databaseName(target);
if (!/^[A-Za-z0-9_]+$/.test(name) || !name.endsWith("_e2e")) {
  console.error(`[gate24] refusing to use "${name}": e2e database names must end with _e2e`);
  process.exit(1);
}

const dbDir = path.join(repoRoot, "packages/db");
const dbEnv = { ...env, DATABASE_URL: target };

/** Every child process runs through pnpm, which is a shell shim on Windows. */
function run(args, { cwd, input, quiet = false }) {
  return execFileSync("pnpm", args, {
    cwd,
    env: dbEnv,
    input,
    encoding: "utf8",
    shell: true,
    stdio: [input ? "pipe" : "ignore", quiet ? "pipe" : "inherit", quiet ? "pipe" : "inherit"],
  });
}

function outputOf(error) {
  return `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || (error.message ?? "");
}

function executeOnMaintenance(sql) {
  return run(
    ["exec", "prisma", "db", "execute", "--url", maintenanceDatabaseUrl(base), "--stdin"],
    { cwd: dbDir, input: `${sql}\n`, quiet: true },
  );
}

function step(label, fn) {
  process.stdout.write(`[gate24] ${label} … `);
  const result = fn();
  process.stdout.write("ok\n");
  return result;
}

// CREATE DATABASE has no IF NOT EXISTS: an existing database is the normal case on
// a machine that has already run `pnpm e2e`, so that one error is tolerated and
// every other failure is not.
step(`creating ${name} if missing`, () => {
  try {
    executeOnMaintenance(`CREATE DATABASE "${name}";`);
  } catch (error) {
    const output = outputOf(error);
    if (!/already exists/i.test(output)) {
      console.error(`\n[gate24] could not create "${name}"\n${output}`);
      process.exit(1);
    }
  }
});

step("applying migrations", () => {
  try {
    run(["exec", "prisma", "migrate", "deploy"], { cwd: dbDir, quiet: true });
  } catch (error) {
    console.error(`\n[gate24] migrations failed\n${outputOf(error)}`);
    process.exit(1);
  }
});

const reportPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "gate24-")),
  "report.json",
);

console.log(`[gate24] running the real-database test against ${redact(target)}`);
let exitCode = 0;
try {
  run(
    [
      "--filter",
      "@jobpilot/autopilot",
      "exec",
      "vitest",
      "run",
      "test/tempdir.integration.test.ts",
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${reportPath}`,
    ],
    { cwd: repoRoot },
  );
} catch (error) {
  exitCode = 1;
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (error) {
  console.error(`[gate24] could not read the vitest report at ${reportPath}: ${error.message}`);
  process.exit(1);
}

const total = Number(report.numTotalTests ?? 0);
const passed = Number(report.numPassedTests ?? 0);
const failed = Number(report.numFailedTests ?? 0);
const pending = Number(report.numPendingTests ?? 0) + Number(report.numTodoTests ?? 0);

// The whole point of this script: a skipped suite is not a proof, so it is an
// error here even though vitest would exit 0.
if (total === 0 || pending > 0) {
  console.error(
    `[gate24] FAILED: the suite did not run (total ${total}, skipped ${pending}). ` +
      "Gate 2.4 is unproven; the test's e2e-database guard is what skipped it.",
  );
  process.exit(1);
}
if (failed > 0 || exitCode !== 0) {
  console.error(`[gate24] FAILED: ${failed} of ${total} tests failed.`);
  process.exit(1);
}

console.log(`[gate24] gate 2.4 exercised against the e2e database: ${passed}/${total} passed`);
