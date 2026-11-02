import path from "node:path";
import type { NextConfig } from "next";

// The pnpm workspace keeps a single .env at the repository root, while Next
// runs from apps/web. Load it here so `pnpm dev`, `next build` and `next start`
// see DATABASE_URL and the auth secrets without extra shell exports.
try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  // No root .env (CI or hosted): rely on the process environment.
}

// NextAuth v5 reads AUTH_SECRET; the project's .env.example uses the v4 name.
if (!process.env.AUTH_SECRET && process.env.NEXTAUTH_SECRET) {
  process.env.AUTH_SECRET = process.env.NEXTAUTH_SECRET;
}

const nextConfig: NextConfig = {
  transpilePackages: ["@jobpilot/core", "@jobpilot/db", "@jobpilot/llm"],
  // Argon2 ships a prebuilt .node binary; webpack cannot parse it.
  serverExternalPackages: ["@node-rs/argon2"],
  webpack: (config) => {
    // serverExternalPackages alone does not cover imports that flow through
    // the transpiled @jobpilot/db package, so mark the binary external here.
    config.externals = [
      ...(Array.isArray(config.externals) ? config.externals : []),
      { "@node-rs/argon2": "commonjs @node-rs/argon2" },
    ];
    // The workspace packages use NodeNext-style "./x.js" specifiers for
    // TypeScript sources; teach webpack to resolve them to ./x.ts.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
