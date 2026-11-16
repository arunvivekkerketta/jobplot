import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The web app has no build-time test surface of its own: the routes and their
 * helpers run under Node, not a browser, so a plain node environment with the
 * `@/*` alias is all `src/lib` needs.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
