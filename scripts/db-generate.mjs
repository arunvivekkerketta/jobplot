import { spawnSync } from "node:child_process";

// `prisma generate` never connects to a database, but the Prisma config insists on a URL.
// A throw-away value is used ONLY for this command. Migrate and seed still need the real URL.
const env = { ...process.env };
if (!env.DATABASE_URL) {
  env.DATABASE_URL = "postgresql://generate:generate@localhost:5432/generate";
}
const result = spawnSync("pnpm", ["--filter", "@jobpilot/db", "exec", "prisma", "generate"], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
