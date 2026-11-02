import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, env } from "prisma/config";

/**
 * The workspace keeps a single .env at the repository root, while Prisma runs
 * from packages/db. Load that file before the config resolves DATABASE_URL so
 * `pnpm db:migrate` and `pnpm db:seed` work from a fresh checkout.
 */
const packageDir = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(packageDir, "../../.env"));
} catch {
  // No root .env (CI or hosted): DATABASE_URL must come from the environment.
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx src/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
