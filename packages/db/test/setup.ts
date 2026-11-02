import path from "node:path";
import { fileURLToPath } from "node:url";

// The workspace keeps one .env at the repo root; vitest runs from packages/db.
try {
  process.loadEnvFile(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  );
} catch {
  // No root .env (CI): DATABASE_URL must come from the process environment.
}
