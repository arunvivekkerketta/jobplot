/**
 * Environment helpers shared by the Playwright config and the e2e database
 * bootstrap. The e2e suite runs against its own database so no test can read or
 * spend the developer's data or daily submission budget.
 *
 * This module is imported by playwright.config.ts, which Playwright bundles as
 * CommonJS, so it must not use `import.meta`.
 */
import fs from "node:fs";
import path from "node:path";

/** Walks up from the working directory to the pnpm workspace root. */
export function findRepoRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find the workspace root from ${start}`);
}

export const repoRoot = findRepoRoot();

/** Reads the workspace .env without letting it override real process env. */
export function loadRootEnv() {
  const envPath = path.join(repoRoot, ".env");
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && match[1] && out[match[1]] === undefined) out[match[1]] = match[2] ?? "";
  }
  return out;
}

/** `postgresql://…/jobpilot` -> `postgresql://…/jobpilot_e2e`. */
export function e2eDatabaseUrl(baseUrl) {
  const override = process.env.E2E_DATABASE_URL;
  if (override) return override;
  const url = new URL(baseUrl);
  const name = url.pathname.replace(/^\//, "") || "jobpilot";
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Cannot derive an e2e database name from "${url.pathname}"`);
  }
  url.pathname = `/${name}_e2e`;
  return url.toString();
}

/** The maintenance database used only to DROP/CREATE the e2e database. */
export function maintenanceDatabaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

export function databaseName(url) {
  return new URL(url).pathname.replace(/^\//, "");
}

export function redact(url) {
  return url.replace(/(:\/\/[^:/@]+):[^@]*@/, "$1:***@");
}
